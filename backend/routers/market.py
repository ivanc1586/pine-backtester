"""
market.py - Binance.US (primary) + Kraken (fallback) with SQLite caching
- Binance.com returns HTTP 451 on US-hosted servers (Railway)
- Binance.US uses api.binance.us / stream.binance.us:9443 (same payload format)
- Kraken is fallback: api.kraken.com/0/public/OHLC (no auth, no geo-block)
"""

import asyncio
import json
import sqlite3
import time
import logging
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx
import websockets
from apscheduler.schedulers.asyncio import AsyncIOScheduler
from fastapi import APIRouter, HTTPException, Query

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/market", tags=["market"])

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
DB_PATH = Path("/tmp/market_cache.db")
SYNC_INTERVAL_SEC = 60

# Binance.US endpoints (same payload format as Binance.com)
BINANCE_US_REST = "https://api.binance.us/api/v3/klines"
BINANCE_US_WS   = "wss://stream.binance.us:9443/ws"

# Kraken fallback
KRAKEN_REST = "https://api.kraken.com/0/public/OHLC"

# Interval mapping: UI label -> (Binance interval str, Kraken interval minutes)
INTERVAL_MAP: dict[str, tuple[str, int]] = {
    "1m":  ("1m",  1),
    "5m":  ("5m",  5),
    "15m": ("15m", 15),
    "30m": ("30m", 30),
    "1h":  ("1h",  60),
    "4h":  ("4h",  240),
    "1d":  ("1d",  1440),
    "1w":  ("1w",  10080),
}

# Kraken pair translation
KRAKEN_PAIR: dict[str, str] = {
    "BTCUSDT": "XBTUSD",
    "ETHUSDT": "ETHUSD",
    "SOLUSDT": "SOLUSD",
    "BNBUSDT": "BNBUSD",
    "XRPUSDT": "XRPUSD",
    "DOGEUSDT": "XDGUSD",
}

WARMUP_PAIRS     = ["BTCUSDT", "ETHUSDT"]
WARMUP_INTERVALS = ["1h", "4h", "1d"]

_scheduler: Optional[AsyncIOScheduler] = None
_ws_tasks:  list[asyncio.Task] = []
_use_kraken = False   # flipped to True if Binance.US is also geo-blocked

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------

def init_db() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS klines (
                symbol   TEXT NOT NULL,
                interval TEXT NOT NULL,
                ts       INTEGER NOT NULL,   -- open-time in SECONDS
                open     REAL NOT NULL,
                high     REAL NOT NULL,
                low      REAL NOT NULL,
                close    REAL NOT NULL,
                volume   REAL NOT NULL,
                PRIMARY KEY (symbol, interval, ts)
            )
        """)
        conn.execute("CREATE INDEX IF NOT EXISTS idx_klines_lookup ON klines(symbol, interval, ts)")
        conn.commit()
    logger.info("DB initialised at %s", DB_PATH)


def upsert_candles(symbol: str, interval: str, rows: list[tuple]) -> None:
    """rows: list of (ts_sec, open, high, low, close, volume)"""
    with sqlite3.connect(DB_PATH) as conn:
        conn.executemany(
            "INSERT OR REPLACE INTO klines VALUES (?,?,?,?,?,?,?,?)",
            [(symbol, interval, *r) for r in rows]
        )
        conn.commit()


def query_candles(symbol: str, interval: str, limit: int) -> list[dict]:
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            "SELECT ts, open, high, low, close, volume FROM klines "
            "WHERE symbol=? AND interval=? ORDER BY ts DESC LIMIT ?",
            (symbol, interval, limit)
        )
        rows = cur.fetchall()
    return [
        {"time": r[0], "open": r[1], "high": r[2], "low": r[3], "close": r[4], "volume": r[5]}
        for r in reversed(rows)
    ]

# ---------------------------------------------------------------------------
# Binance.US REST
# ---------------------------------------------------------------------------

async def fetch_binance_us(symbol: str, interval: str, limit: int = 500) -> list[tuple]:
    """Returns list of (ts_sec, open, high, low, close, volume). Raises on geo-block."""
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(BINANCE_US_REST, params=params)
    if r.status_code == 451:
        raise RuntimeError(f"Binance.US geo-blocked: {r.status_code}")
    if r.status_code != 200:
        raise RuntimeError(f"Binance.US error {r.status_code}: {r.text[:200]}")
    data = r.json()
    # Binance kline: [open_time_ms, open, high, low, close, volume, ...]
    return [(int(k[0]) // 1000, float(k[1]), float(k[2]), float(k[3]), float(k[4]), float(k[5])) for k in data]

# ---------------------------------------------------------------------------
# Kraken REST fallback
# ---------------------------------------------------------------------------

async def fetch_kraken(symbol: str, interval_label: str, limit: int = 500) -> list[tuple]:
    """Returns list of (ts_sec, open, high, low, close, volume)."""
    kraken_pair = KRAKEN_PAIR.get(symbol)
    if not kraken_pair:
        raise RuntimeError(f"No Kraken pair for {symbol}")
    _, kraken_interval = INTERVAL_MAP[interval_label]
    params = {"pair": kraken_pair, "interval": kraken_interval}
    async with httpx.AsyncClient(timeout=10) as client:
        r = await client.get(KRAKEN_REST, params=params)
    if r.status_code != 200:
        raise RuntimeError(f"Kraken error {r.status_code}: {r.text[:200]}")
    data = r.json()
    if data.get("error"):
        raise RuntimeError(f"Kraken API error: {data['error']}")
    pair_key = list(data["result"].keys())[0]
    candles = data["result"][pair_key]
    # Kraken OHLC: [time, open, high, low, close, vwap, volume, count]
    rows = [(int(c[0]), float(c[1]), float(c[2]), float(c[3]), float(c[4]), float(c[6])) for c in candles]
    return rows[-limit:]

# ---------------------------------------------------------------------------
# Unified fetch (try Binance.US first, then Kraken)
# ---------------------------------------------------------------------------

async def fetch_candles(symbol: str, interval_label: str, limit: int = 500) -> list[tuple]:
    global _use_kraken
    binance_interval, _ = INTERVAL_MAP.get(interval_label, ("1h", 60))

    if not _use_kraken:
        try:
            rows = await fetch_binance_us(symbol, binance_interval, limit)
            logger.info("[REST] Binance.US OK %s %s (%d candles)", symbol, interval_label, len(rows))
            return rows
        except RuntimeError as e:
            if "geo-blocked" in str(e):
                logger.warning("[REST] Binance.US geo-blocked, switching to Kraken permanently")
                _use_kraken = True
            else:
                logger.warning("[REST] Binance.US failed: %s — trying Kraken", e)

    # Kraken fallback
    rows = await fetch_kraken(symbol, interval_label, limit)
    logger.info("[REST] Kraken OK %s %s (%d candles)", symbol, interval_label, len(rows))
    return rows

# ---------------------------------------------------------------------------
# Binance.US WebSocket
# ---------------------------------------------------------------------------

async def _ws_stream(symbol: str, interval_label: str) -> None:
    global _use_kraken
    binance_interval, _ = INTERVAL_MAP.get(interval_label, ("1h", 60))
    stream = f"{symbol.lower()}@kline_{binance_interval}"
    url = f"{BINANCE_US_WS}/{stream}"
    retry_delay = 1

    while True:
        try:
            logger.info("[WS] Connecting %s", url)
            async with websockets.connect(url, ping_interval=180, ping_timeout=600) as ws:
                retry_delay = 1
                async for raw in ws:
                    msg = json.loads(raw)
                    k = msg.get("k", {})
                    if not k:
                        continue
                    ts_sec = int(k["t"]) // 1000
                    row = (ts_sec, float(k["o"]), float(k["h"]), float(k["l"]), float(k["c"]), float(k["v"]))
                    upsert_candles(symbol, interval_label, [row])
        except Exception as e:
            err_str = str(e)
            if "451" in err_str or "geo" in err_str.lower():
                logger.warning("[WS] Binance.US geo-blocked for %s %s — WS disabled, relying on REST poll", symbol, interval_label)
                _use_kraken = True
                return  # stop retrying WS for this stream; REST polling takes over
            logger.warning("[WS] Error %s %s: %s — retry in %ds", symbol, interval_label, e, retry_delay)
            await asyncio.sleep(retry_delay)
            retry_delay = min(retry_delay * 2, 60)

# ---------------------------------------------------------------------------
# Periodic REST sync (runs every 60s regardless of WS state)
# ---------------------------------------------------------------------------

async def _sync_all() -> None:
    for symbol in WARMUP_PAIRS:
        for interval_label in WARMUP_INTERVALS:
            try:
                rows = await fetch_candles(symbol, interval_label, limit=10)
                upsert_candles(symbol, interval_label, rows)
            except Exception as e:
                logger.warning("[SYNC] Error %s %s: %s", symbol, interval_label, e)

# ---------------------------------------------------------------------------
# Startup / Shutdown
# ---------------------------------------------------------------------------

async def startup() -> None:
    global _scheduler, _ws_tasks

    init_db()

    # Warmup: fetch historical data
    warmup_tasks = []
    for symbol in WARMUP_PAIRS:
        for interval_label in WARMUP_INTERVALS:
            warmup_tasks.append(_warmup_one(symbol, interval_label))
    await asyncio.gather(*warmup_tasks, return_exceptions=True)

    # Start WS streams (only if not already geo-blocked)
    if not _use_kraken:
        for symbol in WARMUP_PAIRS:
            for interval_label in WARMUP_INTERVALS:
                task = asyncio.create_task(_ws_stream(symbol, interval_label))
                _ws_tasks.append(task)

    # Scheduler: REST sync every 60s (ensures freshness even if WS drops)
    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(_sync_all, "interval", seconds=SYNC_INTERVAL_SEC, id="sync_all")
    _scheduler.start()
    logger.info("Market startup complete (Kraken fallback=%s)", _use_kraken)


async def _warmup_one(symbol: str, interval_label: str) -> None:
    try:
        rows = await fetch_candles(symbol, interval_label, limit=500)
        upsert_candles(symbol, interval_label, rows)
        logger.info("[STARTUP] Warmed up %s %s (%d candles)", symbol, interval_label, len(rows))
    except Exception as e:
        logger.warning("[STARTUP] Failed %s %s: %s", symbol, interval_label, e)


async def shutdown() -> None:
    if _scheduler:
        _scheduler.shutdown(wait=False)
    for t in _ws_tasks:
        t.cancel()
    await asyncio.gather(*_ws_tasks, return_exceptions=True)
    logger.info("Market shutdown complete")

# ---------------------------------------------------------------------------
# API Routes
# ---------------------------------------------------------------------------

@router.get("/klines")
async def get_klines(
    symbol:   str = Query("BTCUSDT"),
    interval: str = Query("1h"),
    limit:    int = Query(500, ge=1, le=1000),
):
    if interval not in INTERVAL_MAP:
        raise HTTPException(400, f"interval must be one of {list(INTERVAL_MAP)}")

    # Try DB first
    cached = query_candles(symbol, interval, limit)
    if cached:
        last_ts = cached[-1]["time"]
        return {
            "symbol":   symbol,
            "interval": interval,
            "source":   "kraken" if _use_kraken else "binance.us",
            "cached":   True,
            "lastSync": last_ts,
            "candles":  cached,
        }

    # Cache miss — fetch live
    try:
        rows = await fetch_candles(symbol, interval, limit)
        upsert_candles(symbol, interval, rows)
        cached = query_candles(symbol, interval, limit)
        last_ts = cached[-1]["time"] if cached else int(time.time())
        return {
            "symbol":   symbol,
            "interval": interval,
            "source":   "kraken" if _use_kraken else "binance.us",
            "cached":   False,
            "lastSync": last_ts,
            "candles":  cached,
        }
    except Exception as e:
        logger.error("[API] Failed to fetch %s %s: %s", symbol, interval, e)
        raise HTTPException(503, f"Data unavailable: {e}")


@router.get("/symbols")
async def get_symbols():
    return {
        "symbols": list(KRAKEN_PAIR.keys()),
        "source": "kraken" if _use_kraken else "binance.us",
    }


@router.get("/status")
async def get_status():
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute("SELECT symbol, interval, COUNT(*), MAX(ts) FROM klines GROUP BY symbol, interval")
        rows = cur.fetchall()
    return {
        "source":    "kraken" if _use_kraken else "binance.us",
        "db_path":   str(DB_PATH),
        "intervals": INTERVAL_MAP,
        "cache":     [
            {"symbol": r[0], "interval": r[1], "candles": r[2], "latest": r[3]}
            for r in rows
        ],
    }
