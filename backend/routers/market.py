"""
market.py – live-fetch only (no SQLite cache)
Primary:  Binance.US  (api.binance.us)
Fallback: Kraken      (api.kraken.com)
Startup/shutdown are plain async functions called by main.py lifespan.
"""

import asyncio
import json
import logging
import time
from typing import Optional

import httpx
import websockets
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect

logger = logging.getLogger(__name__)

router = APIRouter(tags=["market"])

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BINANCE_US_REST = "https://api.binance.us/api/v3/klines"
BINANCE_US_WS   = "wss://stream.binance.us:9443/ws"
KRAKEN_REST     = "https://api.kraken.com/0/public/OHLC"

# interval label -> (binance str, kraken minutes, seconds per candle)
INTERVAL_MAP: dict[str, tuple[str, int, int]] = {
    "1m":  ("1m",   1,     60),
    "5m":  ("5m",   5,    300),
    "15m": ("15m", 15,    900),
    "30m": ("30m", 30,   1800),
    "1h":  ("1h",  60,   3600),
    "4h":  ("4h", 240,  14400),
    "1d":  ("1d", 1440, 86400),
    "1w":  ("1w", 10080, 604800),
}

KRAKEN_PAIR: dict[str, str] = {
    "BTCUSDT":  "XBTUSDT",
    "ETHUSDT":  "ETHUSDT",
    "SOLUSDT":  "SOLUSDT",
    "BNBUSDT":  "BNBUSDT",
    "XRPUSDT":  "XRPUSDT",
    "DOGEUSDT": "XDGUSDT",
}

_use_kraken = False   # flipped True if Binance.US is geo-blocked

# ---------------------------------------------------------------------------
# Lifecycle – called by main.py lifespan
# ---------------------------------------------------------------------------

async def startup() -> None:
    """Called by main.py lifespan on startup. Nothing to initialise (no cache)."""
    logger.info("market.startup(): live-fetch mode, no cache.")

async def shutdown() -> None:
    """Called by main.py lifespan on shutdown."""
    logger.info("market.shutdown(): done.")

# ---------------------------------------------------------------------------
# Binance.US REST
# ---------------------------------------------------------------------------

async def _binance_klines(symbol: str, interval: str, limit: int) -> list[dict]:
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(BINANCE_US_REST, params=params)
        resp.raise_for_status()
        data = resp.json()
    return [
        {
            "time":   int(item[0]) // 1000,
            "open":   float(item[1]),
            "high":   float(item[2]),
            "low":    float(item[3]),
            "close":  float(item[4]),
            "volume": float(item[5]),
        }
        for item in data
    ]

# ---------------------------------------------------------------------------
# Kraken REST fallback
# ---------------------------------------------------------------------------

async def _kraken_klines(symbol: str, interval_min: int, limit: int, interval_sec: int) -> list[dict]:
    pair = KRAKEN_PAIR.get(symbol, symbol)
    # Calculate `since` so we get the most recent `limit` candles
    since = int(time.time()) - limit * interval_sec - interval_sec
    params = {"pair": pair, "interval": interval_min, "since": since}

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(KRAKEN_REST, params=params)
        resp.raise_for_status()
        payload = resp.json()

    if payload.get("error"):
        raise HTTPException(500, f"Kraken error: {payload['error']}")

    result = payload.get("result", {})
    # remove the "last" key
    data_key = next((k for k in result if k != "last"), None)
    if not data_key:
        return []

    rows = result[data_key]
    # Kraken row: [time, open, high, low, close, vwap, volume, count]
    candles = [
        {
            "time":   int(row[0]),
            "open":   float(row[1]),
            "high":   float(row[2]),
            "low":    float(row[3]),
            "close":  float(row[4]),
            "volume": float(row[6]),
        }
        for row in rows
    ]
    # Return only the most recent `limit` candles
    return candles[-limit:]

# ---------------------------------------------------------------------------
# Combined fetch
# ---------------------------------------------------------------------------

async def _fetch_live(symbol: str, interval: str, limit: int) -> list[dict]:
    global _use_kraken
    binance_interval, kraken_min, interval_sec = INTERVAL_MAP[interval]

    if not _use_kraken:
        try:
            candles = await _binance_klines(symbol, binance_interval, limit)
            logger.info("Fetched %s/%s from Binance.US (%d candles)", symbol, interval, len(candles))
            return candles
        except Exception as e:
            logger.warning("Binance.US failed (%s), switching to Kraken", e)
            _use_kraken = True

    candles = await _kraken_klines(symbol, kraken_min, limit, interval_sec)
    logger.info("Fetched %s/%s from Kraken (%d candles)", symbol, interval, len(candles))
    return candles

# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

@router.get("/klines")
async def get_klines(
    symbol: str = Query(..., description="e.g. BTCUSDT"),
    interval: str = Query(..., description="1m 5m 15m 30m 1h 4h 1d 1w"),
    limit: int = Query(500, ge=1, le=1000),
):
    if interval not in INTERVAL_MAP:
        raise HTTPException(400, f"Invalid interval '{interval}'. Valid: {list(INTERVAL_MAP)}")
    try:
        return await _fetch_live(symbol, interval, limit)
    except HTTPException:
        raise
    except Exception as e:
        logger.error("get_klines failed for %s/%s: %s", symbol, interval, e)
        raise HTTPException(502, f"Failed to fetch data: {e}")


@router.get("/symbol_info")
async def symbol_info(symbol: str = Query("BTCUSDT")):
    return {
        "symbol": symbol,
        "baseAsset": symbol.replace("USDT", ""),
        "quoteAsset": "USDT",
        "status": "TRADING",
    }


@router.get("/ping")
async def ping():
    return {"status": "ok", "source": "Kraken" if _use_kraken else "Binance.US"}


# ---------------------------------------------------------------------------
# WebSocket – proxy Binance.US kline stream
# ---------------------------------------------------------------------------

@router.websocket("/ws/klines/{symbol}/{interval}")
async def ws_klines(websocket: WebSocket, symbol: str, interval: str):
    if interval not in INTERVAL_MAP:
        await websocket.close(code=1008, reason=f"Invalid interval: {interval}")
        return

    await websocket.accept()
    stream = f"{symbol.lower()}@kline_{interval}"
    url = f"{BINANCE_US_WS}/{stream}"
    logger.info("WS open: %s/%s -> %s", symbol, interval, url)

    try:
        async with websockets.connect(url, ping_interval=20, ping_timeout=30) as bws:
            while True:
                try:
                    raw = await asyncio.wait_for(bws.recv(), timeout=30)
                except asyncio.TimeoutError:
                    await websocket.send_json({"type": "ping"})
                    continue

                msg = json.loads(raw)
                if msg.get("e") == "kline":
                    k = msg["k"]
                    await websocket.send_json({
                        "time":   int(k["t"]) // 1000,
                        "open":   float(k["o"]),
                        "high":   float(k["h"]),
                        "low":    float(k["l"]),
                        "close":  float(k["c"]),
                        "volume": float(k["v"]),
                        "closed": bool(k["x"]),
                    })

    except WebSocketDisconnect:
        logger.info("WS client disconnected: %s/%s", symbol, interval)
    except websockets.exceptions.ConnectionClosed as e:
        logger.warning("Binance WS closed for %s/%s: %s", symbol, interval, e)
        try:
            await websocket.send_json({"type": "error", "message": "Upstream closed"})
        except Exception:
            pass
    except Exception as e:
        logger.error("WS error %s/%s: %s", symbol, interval, e)
        try:
            await websocket.send_json({"type": "error", "message": str(e)})
        except Exception:
            pass
    finally:
        try:
            await websocket.close()
        except Exception:
            pass
