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

router = APIRouter(tags=["market"])

# ------------------------------------------------------------------------------
# Config
# ------------------------------------------------------------------------------
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
    "BTCUSDT": "XBTUSDT",
    "ETHUSDT": "ETHUSDT",
    "SOLUSDT": "SOLUSDT",
    "BNBUSDT": "BNBUSDT",
    "XRPUSDT": "XRPUSDT",
    "DOGEUSDT": "XDGUSDT",
}

WARMUP_PAIRS     = ["BTCUSDT", "ETHUSDT"]
WARMUP_INTERVALS = ["1h", "4h", "1d"]

_scheduler: Optional[AsyncIOScheduler] = None
_ws_tasks:  list[asyncio.Task] = []
_use_kraken = False   # flipped to True if Binance.US is also geo-blocked

# ------------------------------------------------------------------------------
# Database
# ------------------------------------------------------------------------------

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
    """rows: list of (ts, o, h, l, c, v)"""
    with sqlite3.connect(DB_PATH) as conn:
        conn.executemany(
            "INSERT OR REPLACE INTO klines (symbol, interval, ts, open, high, low, close, volume) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [(symbol, interval, *r) for r in rows]
        )
        conn.commit()


def read_candles(symbol: str, interval: str, start_ts: int, end_ts: int, limit: int) -> list[dict]:
    """Return candles in [start_ts, end_ts], newest first, up to limit."""
    with sqlite3.connect(DB_PATH) as conn:
        cur = conn.execute(
            """
            SELECT ts, open, high, low, close, volume
            FROM klines
            WHERE symbol = ? AND interval = ? AND ts >= ? AND ts <= ?
            ORDER BY ts DESC
            LIMIT ?
            """,
            (symbol, interval, start_ts, end_ts, limit)
        )
        return [
            {
                "time": row[0],
                "open": row[1],
                "high": row[2],
                "low": row[3],
                "close": row[4],
                "volume": row[5],
            }
            for row in cur.fetchall()
        ]

# ------------------------------------------------------------------------------
# Binance.US REST
# ------------------------------------------------------------------------------

async def fetch_binance_klines(symbol: str, interval: str, limit: int = 1500) -> list[tuple]:
    """Returns list of (ts_sec, o, h, l, c, v). Raises if fail."""
    binance_interval, _ = INTERVAL_MAP[interval]
    url = BINANCE_US_REST
    params = {"symbol": symbol, "interval": binance_interval, "limit": limit}
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, params=params)
        if resp.status_code == 451:
            raise HTTPException(status_code=451, detail="Binance.US geo-blocked")
        resp.raise_for_status()
        data = resp.json()
    
    # Binance returns: [open_time_ms, o, h, l, c, v, close_time_ms, quote_vol, ...]
    return [(int(row[0]) // 1000, float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[5])) for row in data]


# ------------------------------------------------------------------------------
# Kraken REST fallback
# ------------------------------------------------------------------------------

async def fetch_kraken_klines(symbol: str, interval: str, limit: int = 720) -> list[tuple]:
    """Returns list of (ts_sec, o, h, l, c, v). Raises if fail."""
    pair = KRAKEN_PAIR.get(symbol)
    if not pair:
        raise HTTPException(status_code=400, detail=f"Kraken does not support {symbol}")
    
    _, kraken_interval_min = INTERVAL_MAP[interval]
    url = KRAKEN_REST
    params = {"pair": pair, "interval": kraken_interval_min}
    
    async with httpx.AsyncClient(timeout=10.0) as client:
        resp = await client.get(url, params=params)
        resp.raise_for_status()
        body = resp.json()
    
    if body.get("error"):
        raise HTTPException(status_code=500, detail=f"Kraken error: {body['error']}")
    
    # Kraken returns: { "result": { "PAIR": [[ts, o, h, l, c, vwap, vol, count], ...] } }
    result_key = list(body["result"].keys())[0]
    candles = body["result"][result_key]
    
    # Return newest `limit` candles
    return [(int(row[0]), float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[6])) for row in candles[-limit:]]


# ------------------------------------------------------------------------------
# Unified fetch with fallback
# ------------------------------------------------------------------------------

async def fetch_klines(symbol: str, interval: str, limit: int = 1500) -> list[tuple]:
    """Try Binance.US first, fallback to Kraken if geo-blocked."""
    global _use_kraken
    
    if _use_kraken:
        return await fetch_kraken_klines(symbol, interval, limit)
    
    try:
        return await fetch_binance_klines(symbol, interval, limit)
    except HTTPException as e:
        if e.status_code == 451:
            logger.warning("Binance.US blocked, switching to Kraken for %s/%s", symbol, interval)
            _use_kraken = True
            return await fetch_kraken_klines(symbol, interval, limit)
        raise


# ------------------------------------------------------------------------------
# Background sync (60s interval)
# ------------------------------------------------------------------------------

async def sync_warmup_data() -> None:
    """Fetch & cache WARMUP_PAIRS x WARMUP_INTERVALS every 60s."""
    for symbol in WARMUP_PAIRS:
        for interval in WARMUP_INTERVALS:
            try:
                rows = await fetch_klines(symbol, interval, limit=1500)
                upsert_candles(symbol, interval, rows)
                logger.info("Synced %s/%s: %d candles", symbol, interval, len(rows))
            except Exception as e:
                logger.error("Failed to sync %s/%s: %s", symbol, interval, e)


# ------------------------------------------------------------------------------
# WebSocket live updates (Binance.US)
# ------------------------------------------------------------------------------

async def ws_subscribe(symbol: str, interval: str) -> None:
    """Subscribe to live kline updates for symbol/interval."""
    binance_interval, _ = INTERVAL_MAP[interval]
    stream = f"{symbol.lower()}@kline_{binance_interval}"
    uri = f"{BINANCE_US_WS}/{stream}"
    
    while True:
        try:
            async with websockets.connect(uri) as ws:
                logger.info("WS connected: %s", stream)
                async for msg in ws:
                    data = json.loads(msg)
                    k = data["k"]
                    if k["x"]:  # candle closed
                        ts = int(k["t"]) // 1000
                        row = (ts, float(k["o"]), float(k["h"]), float(k["l"]), float(k["c"]), float(k["v"]))
                        upsert_candles(symbol, interval, [row])
                        logger.debug("WS update: %s/%s ts=%d", symbol, interval, ts)
        except Exception as e:
            logger.error("WS error %s: %s", stream, e)
            await asyncio.sleep(5)


# ------------------------------------------------------------------------------
# Lifecycle
# ------------------------------------------------------------------------------

async def startup() -> None:
    """Called by FastAPI lifespan on startup."""
    global _scheduler, _ws_tasks
    
    init_db()
    
    # Initial warmup
    await sync_warmup_data()
    
    # Start 60s sync scheduler
    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(sync_warmup_data, "interval", seconds=SYNC_INTERVAL_SEC)
    _scheduler.start()
    logger.info("Scheduler started (60s interval)")
    
    # Start WS streams for warmup pairs
    if not _use_kraken:
        for symbol in WARMUP_PAIRS:
            for interval in WARMUP_INTERVALS:
                task = asyncio.create_task(ws_subscribe(symbol, interval))
                _ws_tasks.append(task)
        logger.info("Started %d WS streams", len(_ws_tasks))


async def shutdown() -> None:
    """Called by FastAPI lifespan on shutdown."""
    global _scheduler, _ws_tasks
    
    if _scheduler:
        _scheduler.shutdown(wait=False)
        logger.info("Scheduler stopped")
    
    for task in _ws_tasks:
        task.cancel()
    await asyncio.gather(*_ws_tasks, return_exceptions=True)
    logger.info("WS tasks cancelled")


# ------------------------------------------------------------------------------
# REST API
# ------------------------------------------------------------------------------

@router.get("/klines")
async def get_klines(
    symbol: str = Query(..., description="Trading pair, e.g. BTCUSDT"),
    interval: str = Query(..., description="1m, 5m, 15m, 30m, 1h, 4h, 1d, 1w"),
    limit: int = Query(1500, ge=1, le=1500),
) -> dict:
    """
    Get historical klines (candlesticks).
    - Tries cache first (newest candles up to NOW)
    - If cache empty or stale, fetches from exchange
    - Returns newest `limit` candles, descending by time
    """
    if interval not in INTERVAL_MAP:
        raise HTTPException(status_code=400, detail=f"Invalid interval: {interval}")
    
    now = int(time.time())
    
    # Try cache
    cached = read_candles(symbol, interval, 0, now, limit)
    if cached:
        logger.info("Cache hit: %s/%s (%d candles)", symbol, interval, len(cached))
        return {"symbol": symbol, "interval": interval, "data": cached}
    
    # Fetch fresh data
    logger.info("Cache miss: fetching %s/%s from exchange", symbol, interval)
    rows = await fetch_klines(symbol, interval, limit)
    upsert_candles(symbol, interval, rows)
    
    # Re-read from DB to return consistent format
    cached = read_candles(symbol, interval, 0, now, limit)
    return {"symbol": symbol, "interval": interval, "data": cached}


@router.get("/health")
async def health() -> dict:
    """Health check endpoint."""
    return {
        "status": "ok",
        "db_path": str(DB_PATH),
        "db_exists": DB_PATH.exists(),
        "using_kraken": _use_kraken,
        "warmup_pairs": WARMUP_PAIRS,
        "warmup_intervals": WARMUP_INTERVALS,
    }
