"""
market.py  –  Live passthrough: Binance.US (primary) → Kraken (fallback)

Why no cache?
  Railway is ephemeral – SQLite is wiped on every deploy.
  Cache warmup failures left some intervals permanently stale.
  Result: different intervals showed wildly different prices.

Fix: every /klines call fetches live data directly from the exchange.
  - Binance.US REST: api.binance.us (same payload as Binance.com, no US geo-block)
  - Kraken REST: api.kraken.com (global, no auth needed, fallback)
"""

import asyncio
import logging
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException, Query, WebSocket, WebSocketDisconnect
import websockets

logger = logging.getLogger(__name__)
router = APIRouter(tags=["market"])

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BINANCE_US_REST = "https://api.binance.us/api/v3/klines"
BINANCE_US_INFO = "https://api.binance.us/api/v3/exchangeInfo"
BINANCE_US_WS   = "wss://stream.binance.us:9443/ws"

KRAKEN_REST     = "https://api.kraken.com/0/public/OHLC"
KRAKEN_TICKER   = "https://api.kraken.com/0/public/Ticker"

# UI interval -> (Binance str, Kraken minutes)
INTERVAL_MAP: dict[str, tuple[str, int]] = {
    "1m":  ("1m",   1),
    "5m":  ("5m",   5),
    "15m": ("15m",  15),
    "30m": ("30m",  30),
    "1h":  ("1h",   60),
    "4h":  ("4h",   240),
    "1d":  ("1d",   1440),
    "1w":  ("1w",   10080),
}

KRAKEN_PAIR: dict[str, str] = {
    "BTCUSDT":  "XBTUSDT",
    "ETHUSDT":  "ETHUSDT",
    "SOLUSDT":  "SOLUSDT",
    "BNBUSDT":  "BNBUSDT",
    "XRPUSDT":  "XRPUSDT",
    "DOGEUSDT": "XDGUSDT",
    "ADAUSDT":  "ADAUSDT",
    "AVAXUSDT": "AVAXUSDT",
    "DOTUSDT":  "DOTUSDT",
    "MATICUSDT":"MATICUSDT",
}

# Global flag: if Binance.US REST is also geo-blocked, permanently use Kraken
_use_kraken = False

# ---------------------------------------------------------------------------
# Binance.US REST
# ---------------------------------------------------------------------------

async def binance_klines(symbol: str, interval: str, limit: int = 500) -> list[dict]:
    """Fetch klines from Binance.US. Returns list of OHLCV dicts."""
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(BINANCE_US_REST, params=params)
        resp.raise_for_status()
        data = resp.json()

    result = []
    for item in data:
        ts = int(item[0]) // 1000  # ms -> seconds
        result.append({
            "time":   ts,
            "open":   float(item[1]),
            "high":   float(item[2]),
            "low":    float(item[3]),
            "close":  float(item[4]),
            "volume": float(item[5]),
        })
    return result

# ---------------------------------------------------------------------------
# Kraken REST fallback
# ---------------------------------------------------------------------------

async def kraken_klines(symbol: str, interval_min: int, limit: int = 500) -> list[dict]:
    """
    Fetch OHLC from Kraken. Kraken always returns up to 720 candles from
    `since` timestamp. To get the most-recent `limit` candles we compute
    since = now - limit * interval_seconds.
    """
    pair = KRAKEN_PAIR.get(symbol, symbol)

    import time
    since = int(time.time()) - limit * interval_min * 60

    params = {"pair": pair, "interval": interval_min, "since": since}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(KRAKEN_REST, params=params)
        resp.raise_for_status()
        payload = resp.json()

    if payload.get("error"):
        raise HTTPException(502, f"Kraken error: {payload['error']}")

    result_data = payload.get("result", {})
    # Remove the 'last' key which is a timestamp, not candle data
    candle_key = next((k for k in result_data if k != "last"), None)
    if not candle_key:
        return []

    raw = result_data[candle_key]
    result = []
    for row in raw:
        # Kraken row: [time, open, high, low, close, vwap, volume, count]
        result.append({
            "time":   int(row[0]),
            "open":   float(row[1]),
            "high":   float(row[2]),
            "low":    float(row[3]),
            "close":  float(row[4]),
            "volume": float(row[6]),
        })
    # Return last `limit` candles (Kraken may return more than requested)
    return result[-limit:]

# ---------------------------------------------------------------------------
# Combined fetch with fallback
# ---------------------------------------------------------------------------

async def fetch_klines(symbol: str, interval: str, limit: int = 500) -> list[dict]:
    """Try Binance.US first; fall back to Kraken on any error."""
    global _use_kraken

    if not _use_kraken:
        try:
            candles = await binance_klines(symbol, interval, limit)
            logger.info("Binance.US OK: %s %s (%d candles, last close=%.4f)",
                        symbol, interval, len(candles),
                        candles[-1]["close"] if candles else 0)
            return candles
        except Exception as exc:
            logger.warning("Binance.US failed (%s), switching to Kraken permanently", exc)
            _use_kraken = True

    interval_min = INTERVAL_MAP.get(interval, ("1h", 60))[1]
    candles = await kraken_klines(symbol, interval_min, limit)
    logger.info("Kraken OK: %s %s (%d candles, last close=%.4f)",
                symbol, interval, len(candles),
                candles[-1]["close"] if candles else 0)
    return candles

# ---------------------------------------------------------------------------
# REST Endpoints
# ---------------------------------------------------------------------------

@router.get("/klines")
async def get_klines(
    symbol:   str = Query("BTCUSDT"),
    interval: str = Query("1h"),
    limit:    int = Query(500, ge=1, le=1000),
):
    if interval not in INTERVAL_MAP:
        raise HTTPException(400, f"Invalid interval '{interval}'. Valid: {list(INTERVAL_MAP)}")
    try:
        candles = await fetch_klines(symbol, interval, limit)
    except HTTPException:
        raise
    except Exception as exc:
        logger.error("fetch_klines failed: %s", exc)
        raise HTTPException(502, f"Market data unavailable: {exc}")

    if not candles:
        raise HTTPException(404, f"No data for {symbol}/{interval}")
    return candles


@router.get("/symbol_info")
async def symbol_info(symbol: str = Query("BTCUSDT")):
    """Return basic price info for a symbol (current price = last candle close)."""
    try:
        # Fetch just 1 candle to get the current price quickly
        candles = await fetch_klines(symbol, "1m", limit=1)
        if candles:
            price = candles[-1]["close"]
            return {"symbol": symbol, "price": price, "source": "binance.us" if not _use_kraken else "kraken"}
    except Exception as exc:
        logger.error("symbol_info failed: %s", exc)
    raise HTTPException(502, "Could not fetch price")


@router.get("/ping")
async def ping():
    return {"status": "ok"}

# ---------------------------------------------------------------------------
# WebSocket proxy: /ws/klines/{symbol}/{interval}
# Forward Binance.US kline stream; if unavailable send periodic REST updates
# ---------------------------------------------------------------------------

@router.websocket("/ws/klines/{symbol}/{interval}")
async def ws_klines(ws: WebSocket, symbol: str, interval: str):
    await ws.accept()
    logger.info("WS opened: %s %s", symbol, interval)

    # Try Binance.US WebSocket stream first
    binance_interval = INTERVAL_MAP.get(interval, ("1h",))[0]
    stream_url = f"{BINANCE_US_WS}/{symbol.lower()}@kline_{binance_interval}"

    try:
        async with websockets.connect(stream_url, open_timeout=8) as upstream:
            logger.info("WS upstream connected: %s", stream_url)
            while True:
                try:
                    raw = await asyncio.wait_for(upstream.recv(), timeout=30)
                    data = json_parse(raw)
                    k = data.get("k", {})
                    candle = {
                        "time":   int(k.get("t", 0)) // 1000,
                        "open":   float(k.get("o", 0)),
                        "high":   float(k.get("h", 0)),
                        "low":    float(k.get("l", 0)),
                        "close":  float(k.get("c", 0)),
                        "volume": float(k.get("v", 0)),
                        "closed": k.get("x", False),
                    }
                    await ws.send_json(candle)
                except asyncio.TimeoutError:
                    # Send ping to keep client alive
                    await ws.send_json({"ping": True})
                except WebSocketDisconnect:
                    break
    except Exception as exc:
        logger.warning("Binance.US WS failed (%s), falling back to REST polling", exc)
        # Fallback: poll REST every 5 seconds and send latest candle
        import time
        last_ts = 0
        while True:
            try:
                candles = await fetch_klines(symbol, interval, limit=1)
                if candles:
                    c = candles[-1]
                    c["closed"] = False
                    if c["time"] != last_ts:
                        last_ts = c["time"]
                    await ws.send_json(c)
            except WebSocketDisconnect:
                break
            except Exception as e:
                logger.error("WS REST fallback error: %s", e)
            await asyncio.sleep(5)

    logger.info("WS closed: %s %s", symbol, interval)


def json_parse(raw: str | bytes) -> dict:
    import json
    if isinstance(raw, bytes):
        raw = raw.decode()
    return json.loads(raw)
