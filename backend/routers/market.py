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
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter(tags=["market"])

# -----------------------------------------------------------------------------
# Config
# -----------------------------------------------------------------------------
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
WARMUP_INTERVALS = ["1m", "5m", "15m", "30m", "1h", "4h", "1d"]

_scheduler: Optional[AsyncIOScheduler] = None
_ws_tasks:  list[asyncio.Task] = []
_use_kraken = False   # flipped to True if Binance.US is also geo-blocked

# -----------------------------------------------------------------------------
# Database
# -----------------------------------------------------------------------------

def init_db() -> None:
    with sqlite3.connect(DB_PATH) as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS klines (
                symbol   TEXT NOT NULL,
                interval TEXT NOT NULL,
                ts       INTEGER NOT NULL,  -- open-time in SECONDS
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
    if not rows:
        return
    with sqlite3.connect(DB_PATH) as conn:
        conn.executemany(
            "INSERT OR REPLACE INTO klines VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [(symbol, interval, ts, o, h, l, c, v) for ts, o, h, l, c, v in rows],
        )
        conn.commit()


def fetch_candles(symbol: str, interval: str, limit: int) -> list[dict]:
    """Return last <limit> rows sorted by ts asc."""
    with sqlite3.connect(DB_PATH) as conn:
        cursor = conn.execute(
            "SELECT ts, open, high, low, close, volume FROM klines WHERE symbol=? AND interval=? "
            "ORDER BY ts DESC LIMIT ?",
            (symbol, interval, limit),
        )
        rows = cursor.fetchall()
    rows.reverse()
    return [
        {"time": ts, "open": o, "high": h, "low": l, "close": c, "volume": v}
        for ts, o, h, l, c, v in rows
    ]


# -----------------------------------------------------------------------------
# Binance.US REST
# -----------------------------------------------------------------------------

async def binance_us_klines(symbol: str, interval: str, limit: int = 500) -> list[tuple]:
    """Fetch historical klines from Binance.US (same payload as Binance.com)."""
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(BINANCE_US_REST, params=params)
            resp.raise_for_status()
            data = resp.json()
    except Exception as e:
        logger.error("Binance.US REST failed for %s/%s: %s", symbol, interval, e)
        raise

    candles = []
    for item in data:
        ts_ms, o, h, l, c, v = item[0], item[1], item[2], item[3], item[4], item[5]
        ts = int(ts_ms) // 1000
        candles.append((ts, float(o), float(h), float(l), float(c), float(v)))
    return candles


# -----------------------------------------------------------------------------
# Kraken REST fallback
# -----------------------------------------------------------------------------

async def kraken_ohlc(symbol: str, interval: int, since: Optional[int] = None) -> list[tuple]:
    """
    Fetch from Kraken /0/public/OHLC.
    interval: minutes (1, 5, 15, 30, 60, 240, 1440, 10080).
    since: optional unix timestamp (seconds).
    """
    pair = KRAKEN_PAIR.get(symbol, symbol)
    params = {"pair": pair, "interval": interval}
    if since:
        params["since"] = since

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(KRAKEN_REST, params=params)
            resp.raise_for_status()
            payload = resp.json()
    except Exception as e:
        logger.error("Kraken REST failed for %s/%d: %s", symbol, interval, e)
        raise

    if payload.get("error"):
        logger.error("Kraken error: %s", payload["error"])
        raise HTTPException(500, f"Kraken error: {payload['error']}")

    # result is { "XBTUSDT": [ [ts, o, h, l, c, vwap, volume, count], ... ], "last": ... }
    result_key = list(payload.get("result", {}).keys())[0] if payload.get("result") else None
    if not result_key or result_key == "last":
        return []

    raw = payload["result"][result_key]
    candles = []
    for row in raw:
        ts = int(row[0])
        o, h, l, c, vol = float(row[1]), float(row[2]), float(row[3]), float(row[4]), float(row[6])
        candles.append((ts, o, h, l, c, vol))
    return candles


# -----------------------------------------------------------------------------
# Combined fetch (fallback logic)
# -----------------------------------------------------------------------------

async def fetch_and_cache(symbol: str, interval: str, limit: int = 500) -> None:
    """Fetch from Binance.US or fallback to Kraken, then upsert to DB."""
    global _use_kraken

    if not _use_kraken:
        try:
            candles = await binance_us_klines(symbol, interval, limit)
            upsert_candles(symbol, interval, candles)
            logger.info("Synced %s/%s via Binance.US (%d candles)", symbol, interval, len(candles))
            return
        except Exception as e:
            logger.warning("Binance.US failed, switching to Kraken: %s", e)
            _use_kraken = True

    # Kraken fallback
    interval_min = INTERVAL_MAP[interval][1]
    try:
        candles = await kraken_ohlc(symbol, interval_min)
        upsert_candles(symbol, interval, candles)
        logger.info("Synced %s/%s via Kraken (%d candles)", symbol, interval, len(candles))
    except Exception as e:
        logger.error("Kraken also failed for %s/%s: %s", symbol, interval, e)


# -----------------------------------------------------------------------------
# Scheduler
# -----------------------------------------------------------------------------

async def periodic_sync():
    """Scheduled job: refresh all warmup pairs/intervals."""
    logger.info("Running periodic sync...")
    for symbol in WARMUP_PAIRS:
        for interval in WARMUP_INTERVALS:
            try:
                await fetch_and_cache(symbol, interval, limit=500)
            except Exception as e:
                logger.error("Periodic sync failed for %s/%s: %s", symbol, interval, e)


@router.on_event("startup")
async def startup():
    global _scheduler
    init_db()
    logger.info("Warming up cache...")
    for symbol in WARMUP_PAIRS:
        for interval in WARMUP_INTERVALS:
            try:
                await fetch_and_cache(symbol, interval, limit=1000)
            except Exception as e:
                logger.warning("Warmup failed for %s/%s: %s", symbol, interval, e)

    _scheduler = AsyncIOScheduler()
    _scheduler.add_job(periodic_sync, "interval", seconds=SYNC_INTERVAL_SEC)
    _scheduler.start()
    logger.info("Scheduler started (sync every %ds)", SYNC_INTERVAL_SEC)


@router.on_event("shutdown")
async def shutdown():
    if _scheduler:
        _scheduler.shutdown()
    for task in _ws_tasks:
        task.cancel()
    logger.info("Market router shutdown complete")


# -----------------------------------------------------------------------------
# REST API Endpoints
# -----------------------------------------------------------------------------

@router.get("/klines")
async def get_klines(
    symbol: str = Query(..., description="e.g. BTCUSDT"),
    interval: str = Query(..., description="e.g. 1h, 4h, 1d"),
    limit: int = Query(500, ge=1, le=1000),
):
    """
    Fetch cached klines (or trigger fallback if missing).
    Returns: [{"time": ts, "open": o, "high": h, "low": l, "close": c, "volume": v}, ...]
    """
    if interval not in INTERVAL_MAP:
        raise HTTPException(400, f"Invalid interval: {interval}")

    # Try DB first
    rows = fetch_candles(symbol, interval, limit)
    if rows:
        logger.info("Served %s/%s from cache (%d rows)", symbol, interval, len(rows))
        return rows

    # Cache miss => fetch now
    logger.warning("Cache miss for %s/%s, fetching...", symbol, interval)
    await fetch_and_cache(symbol, interval, limit)
    rows = fetch_candles(symbol, interval, limit)
    if not rows:
        raise HTTPException(404, f"No data for {symbol}/{interval}")
    return rows


@router.get("/symbol_info")
async def symbol_info(symbol: str = Query("BTCUSDT")):
    """
    Return symbol metadata. Minimal placeholder for now.
    """
    return {
        "symbol": symbol,
        "baseAsset": symbol[:-4],  # assume USDT suffix
        "quoteAsset": "USDT",
        "status": "TRADING",
    }


@router.get("/ping")
async def ping():
    """Health check."""
    return {"status": "ok", "source": "Kraken" if _use_kraken else "Binance.US"}


# -----------------------------------------------------------------------------
# WebSocket endpoint — proxies Binance.US kline stream to the browser
# -----------------------------------------------------------------------------

@router.websocket("/ws/klines/{symbol}/{interval}")
async def ws_klines(websocket: WebSocket, symbol: str, interval: str):
    """
    Proxy Binance.US kline WebSocket stream to the frontend.

    Binance stream message (kline event):
    {
      "e": "kline",
      "E": 1234567890,   # event time ms
      "s": "BTCUSDT",
      "k": {
        "t": 1234567800000,  # candle open time ms
        "T": 1234567859999,  # candle close time ms
        "s": "BTCUSDT",
        "i": "1m",
        "o": "42000.00",
        "c": "42050.00",
        "h": "42100.00",
        "l": "41900.00",
        "v": "100.5",
        "x": false          # is this candle closed?
      }
    }

    We forward a simplified payload to the frontend:
    {
      "time":   <open_time_seconds>,
      "open":   <float>,
      "high":   <float>,
      "low":    <float>,
      "close":  <float>,
      "volume": <float>,
      "closed": <bool>      # true = candle finalised, false = still forming
    }
    """
    if interval not in INTERVAL_MAP:
        await websocket.close(code=1008, reason=f"Invalid interval: {interval}")
        return

    await websocket.accept()
    stream_name = f"{symbol.lower()}@kline_{interval}"
    binance_ws_url = f"{BINANCE_US_WS}/{stream_name}"
    logger.info("WS client connected: %s/%s -> %s", symbol, interval, binance_ws_url)

    async def _send_candle(k: dict) -> None:
        candle = {
            "time":   int(k["t"]) // 1000,
            "open":   float(k["o"]),
            "high":   float(k["h"]),
            "low":    float(k["l"]),
            "close":  float(k["c"]),
            "volume": float(k["v"]),
            "closed": bool(k["x"]),
        }
        await websocket.send_json(candle)
        # If candle just closed, upsert to cache so REST is also up-to-date
        if candle["closed"]:
            upsert_candles(
                symbol, interval,
                [(candle["time"], candle["open"], candle["high"],
                  candle["low"], candle["close"], candle["volume"])]
            )

    try:
        async with websockets.connect(binance_ws_url, ping_interval=20, ping_timeout=30) as binance_ws:
            while True:
                try:
                    raw = await asyncio.wait_for(binance_ws.recv(), timeout=30)
                except asyncio.TimeoutError:
                    # Keep the frontend WS alive with a heartbeat
                    await websocket.send_json({"type": "ping"})
                    continue

                msg = json.loads(raw)
                if msg.get("e") == "kline":
                    await _send_candle(msg["k"])

    except WebSocketDisconnect:
        logger.info("Frontend WS disconnected: %s/%s", symbol, interval)
    except websockets.exceptions.ConnectionClosed as e:
        logger.warning("Binance WS closed for %s/%s: %s", symbol, interval, e)
        try:
            await websocket.send_json({"type": "error", "message": "Upstream connection closed"})
        except Exception:
            pass
        await websocket.close()
    except Exception as e:
        logger.error("WS proxy error for %s/%s: %s", symbol, interval, e)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
        await websocket.close()
