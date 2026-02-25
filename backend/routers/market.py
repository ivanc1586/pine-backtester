"""
market.py - Binance data source with SQLite caching
Architecture:
  - Binance REST API: fetch historical klines (500 candles)
  - Binance WebSocket: real-time last candle update
  - SQLite: local cache, updated every 60s via REST + live via WS
  - Frontend reads /api/market/klines (served from DB, ts in seconds)
"""

import asyncio
import json
import sqlite3
import time
import logging
from pathlib import Path

import httpx
import websockets
from fastapi import APIRouter, HTTPException

logger = logging.getLogger(__name__)
router = APIRouter()

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------
BINANCE_REST = "https://api.binance.com"
BINANCE_WS   = "wss://stream.binance.com:9443/ws"

VALID_INTERVALS = {
    "1m","3m","5m","15m","30m",
    "1h","2h","4h","6h","8h","12h",
    "1d","3d","1w","1M"
}

DB_PATH = Path("/tmp/market_cache.db")

_ws_tasks: dict[str, asyncio.Task] = {}
_ws_lock = asyncio.Lock()
_sync_tasks: dict[str, asyncio.Task] = {}
_sync_lock = asyncio.Lock()

# ---------------------------------------------------------------------------
# Database
# ---------------------------------------------------------------------------
def get_db() -> sqlite3.Connection:
    conn = sqlite3.connect(str(DB_PATH), check_same_thread=False)
    conn.row_factory = sqlite3.Row
    return conn


def init_db():
    with get_db() as conn:
        conn.execute("""
            CREATE TABLE IF NOT EXISTS klines (
                symbol   TEXT NOT NULL,
                interval TEXT NOT NULL,
                ts       INTEGER NOT NULL,
                open     REAL NOT NULL,
                high     REAL NOT NULL,
                low      REAL NOT NULL,
                close    REAL NOT NULL,
                volume   REAL NOT NULL,
                PRIMARY KEY (symbol, interval, ts)
            )
        """)
        conn.execute("""
            CREATE TABLE IF NOT EXISTS last_sync (
                symbol    TEXT NOT NULL,
                interval  TEXT NOT NULL,
                synced_at INTEGER NOT NULL,
                PRIMARY KEY (symbol, interval)
            )
        """)
        conn.commit()
    logger.info("DB initialised at %s", DB_PATH)


def upsert_candles(symbol: str, interval: str, candles: list):
    if not candles:
        return
    with get_db() as conn:
        conn.executemany(
            """INSERT OR REPLACE INTO klines
               (symbol, interval, ts, open, high, low, close, volume)
               VALUES (:symbol, :interval, :ts, :open, :high, :low, :close, :volume)""",
            [{"symbol": symbol, "interval": interval, **c} for c in candles],
        )
        conn.execute(
            """INSERT OR REPLACE INTO last_sync (symbol, interval, synced_at)
               VALUES (?, ?, ?)""",
            (symbol, interval, int(time.time())),
        )
        conn.commit()


def read_candles(symbol: str, interval: str, limit: int = 500) -> list:
    with get_db() as conn:
        rows = conn.execute(
            """SELECT ts, open, high, low, close, volume
               FROM klines WHERE symbol=? AND interval=?
               ORDER BY ts DESC LIMIT ?""",
            (symbol, interval, limit),
        ).fetchall()
    return [
        {"time": r["ts"], "open": r["open"], "high": r["high"],
         "low": r["low"], "close": r["close"], "volume": r["volume"]}
        for r in reversed(rows)
    ]


def get_last_sync(symbol: str, interval: str) -> int:
    with get_db() as conn:
        row = conn.execute(
            "SELECT synced_at FROM last_sync WHERE symbol=? AND interval=?",
            (symbol, interval),
        ).fetchone()
    return row["synced_at"] if row else 0


# ---------------------------------------------------------------------------
# Binance REST
# ---------------------------------------------------------------------------
async def fetch_binance_rest(symbol: str, interval: str, limit: int = 500) -> list:
    url = f"{BINANCE_REST}/api/v3/klines"
    params = {"symbol": symbol.upper(), "interval": interval, "limit": limit}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, params=params)
        if resp.status_code == 400:
            raise HTTPException(400, f"Invalid symbol or interval: {symbol}/{interval}")
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, f"Binance error: {resp.text[:200]}")
        raw = resp.json()
    return [
        {
            "ts":     int(row[0]) // 1000,   # ms -> seconds
            "open":   float(row[1]),
            "high":   float(row[2]),
            "low":    float(row[3]),
            "close":  float(row[4]),
            "volume": float(row[5]),
        }
        for row in raw
    ]


# ---------------------------------------------------------------------------
# Binance WebSocket - real-time candle updates
# ---------------------------------------------------------------------------
async def _ws_stream(symbol: str, interval: str):
    stream = f"{symbol.lower()}@kline_{interval}"
    uri = f"{BINANCE_WS}/{stream}"
    backoff = 1
    while True:
        try:
            logger.info("[WS] Connecting %s", uri)
            async with websockets.connect(uri, ping_interval=20, ping_timeout=10) as ws:
                backoff = 1
                async for raw_msg in ws:
                    msg = json.loads(raw_msg)
                    k = msg.get("k", {})
                    candle = {
                        "ts":     int(k["t"]) // 1000,
                        "open":   float(k["o"]),
                        "high":   float(k["h"]),
                        "low":    float(k["l"]),
                        "close":  float(k["c"]),
                        "volume": float(k["v"]),
                    }
                    upsert_candles(symbol.upper(), interval, [candle])
        except asyncio.CancelledError:
            logger.info("[WS] Cancelled %s %s", symbol, interval)
            return
        except Exception as exc:
            logger.warning("[WS] Error %s %s: %s - retry in %ds", symbol, interval, exc, backoff)
            await asyncio.sleep(backoff)
            backoff = min(backoff * 2, 60)


async def ensure_ws(symbol: str, interval: str):
    key = f"{symbol.upper()}_{interval}"
    async with _ws_lock:
        task = _ws_tasks.get(key)
        if task is None or task.done():
            _ws_tasks[key] = asyncio.create_task(
                _ws_stream(symbol, interval), name=f"ws_{key}"
            )


async def stop_all_ws():
    async with _ws_lock:
        for t in _ws_tasks.values():
            t.cancel()
        _ws_tasks.clear()


# ---------------------------------------------------------------------------
# 60-second REST sync
# ---------------------------------------------------------------------------
async def _sync_loop(symbol: str, interval: str, every: int = 60):
    while True:
        try:
            candles = await fetch_binance_rest(symbol, interval, limit=500)
            upsert_candles(symbol.upper(), interval, candles)
            logger.info("[SYNC] %s %s - %d candles", symbol, interval, len(candles))
        except Exception as exc:
            logger.warning("[SYNC] Error %s %s: %s", symbol, interval, exc)
        await asyncio.sleep(every)


async def ensure_sync(symbol: str, interval: str, every: int = 60):
    key = f"{symbol.upper()}_{interval}"
    async with _sync_lock:
        task = _sync_tasks.get(key)
        if task is None or task.done():
            _sync_tasks[key] = asyncio.create_task(
                _sync_loop(symbol, interval, every), name=f"sync_{key}"
            )


async def stop_all_sync():
    async with _sync_lock:
        for t in _sync_tasks.values():
            t.cancel()
        _sync_tasks.clear()


# ---------------------------------------------------------------------------
# Startup / Shutdown (called from main.py lifespan)
# ---------------------------------------------------------------------------
DEFAULT_PAIRS = [
    ("BTCUSDT", "1h"),
    ("ETHUSDT", "1h"),
    ("BTCUSDT", "4h"),
    ("ETHUSDT", "4h"),
    ("BTCUSDT", "1d"),
]

async def startup():
    init_db()
    for sym, ivl in DEFAULT_PAIRS:
        try:
            candles = await fetch_binance_rest(sym, ivl, limit=500)
            upsert_candles(sym, ivl, candles)
            logger.info("[STARTUP] Pre-warmed %s %s", sym, ivl)
        except Exception as exc:
            logger.warning("[STARTUP] Failed %s %s: %s", sym, ivl, exc)
        await ensure_ws(sym, ivl)
        await ensure_sync(sym, ivl)


async def shutdown():
    await stop_all_ws()
    await stop_all_sync()


# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@router.get("/klines")
async def get_klines(
    symbol: str = "BTCUSDT",
    interval: str = "1h",
    limit: int = 500,
    source: str = "binance",   # legacy param, ignored - always Binance
):
    symbol = symbol.upper()

    if interval not in VALID_INTERVALS:
        raise HTTPException(
            400,
            f"Invalid interval '{interval}'. Valid values: {sorted(VALID_INTERVALS)}"
        )

    # Try DB cache first
    cached = read_candles(symbol, interval, limit)

    if not cached:
        # Cache miss: fetch from Binance on-demand
        logger.info("[API] Cache miss %s %s - fetching live", symbol, interval)
        try:
            candles = await fetch_binance_rest(symbol, interval, limit=limit)
        except HTTPException:
            raise
        except Exception as exc:
            raise HTTPException(502, str(exc))
        upsert_candles(symbol, interval, candles)
        cached = read_candles(symbol, interval, limit)

    # Ensure background tasks are running for this pair
    await ensure_ws(symbol, interval)
    await ensure_sync(symbol, interval)

    if not cached:
        raise HTTPException(404, "No data available for this symbol/interval")

    return {
        "symbol": symbol,
        "interval": interval,
        "source": "binance",
        "candles": cached,          # [{time, open, high, low, close, volume}]
        "currentPrice": cached[-1]["close"] if cached else None,
        "lastSync": get_last_sync(symbol, interval),
        "count": len(cached),
    }


@router.get("/symbols")
async def get_symbols():
    return {
        "symbols": [
            "BTCUSDT","ETHUSDT","BNBUSDT","SOLUSDT","XRPUSDT",
            "ADAUSDT","DOGEUSDT","AVAXUSDT","DOTUSDT","MATICUSDT",
            "LINKUSDT","UNIUSDT","LTCUSDT","ATOMUSDT","NEARUSDT",
            "TRXUSDT","SHIBUSDT","TONUSDT","WLDUSDT","INJUSDT",
        ]
    }


@router.get("/price/{symbol}")
async def get_price(symbol: str):
    symbol = symbol.upper()
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(
            f"{BINANCE_REST}/api/v3/ticker/price",
            params={"symbol": symbol}
        )
        if resp.status_code != 200:
            raise HTTPException(resp.status_code, "Symbol not found")
    return {"symbol": symbol, "price": float(resp.json()["price"])}


@router.get("/status")
async def get_status():
    """Debug endpoint: active streams and sync tasks."""
    return {
        "ws_streams": list(_ws_tasks.keys()),
        "sync_tasks": list(_sync_tasks.keys()),
        "db_path": str(DB_PATH),
    }
