"""
market.py  v2.0.0 - 2026-03-01
CHANGES:
  - /ticker/{symbol}: 改用 Binance /api/v3/ticker/24hr 取得正確 priceChangePercent
  - K 線資料加入磁碟快取（diskcache），減少重複 API 呼叫，降低記憶體佔用
  - 磁碟快取 TTL: 1m=60s, 5m=300s, 15m/30m=600s, 1h=1800s, 4h/1d/1w=3600s
  - /ticker 批次端點：一次回傳多幣對 24h 資料
  - WebSocket 保持不變
"""

import asyncio
import json
import logging
import os
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
BINANCE_REST    = "https://api.binance.com/api/v3/klines"
BINANCE_TICKER  = "https://api.binance.com/api/v3/ticker/24hr"
BINANCE_US_REST = "https://api.binance.us/api/v3/klines"
BINANCE_US_WS   = "wss://stream.binance.us:9443/ws"
KRAKEN_REST     = "https://api.kraken.com/0/public/OHLC"

INTERVAL_MAP: dict[str, tuple[str, int, int]] = {
    "1m":  ("1m",    1,     60),
    "5m":  ("5m",    5,    300),
    "15m": ("15m",  15,    900),
    "30m": ("30m",  30,   1800),
    "1h":  ("1h",   60,   3600),
    "4h":  ("4h",  240,  14400),
    "1d":  ("1d", 1440,  86400),
    "1w":  ("1w", 10080, 604800),
}

# TTL per interval (seconds)
CACHE_TTL: dict[str, int] = {
    "1m": 60, "5m": 300, "15m": 600, "30m": 600,
    "1h": 1800, "4h": 3600, "1d": 3600, "1w": 3600,
}

KRAKEN_PAIR: dict[str, str] = {
    "BTCUSDT":  "XBTUSDT",
    "ETHUSDT":  "ETHUSDT",
    "SOLUSDT":  "SOLUSDT",
    "BNBUSDT":  "BNBUSDT",
    "XRPUSDT":  "XRPUSDT",
    "DOGEUSDT": "XDGUSDT",
}

_use_kraken = False

# ---------------------------------------------------------------------------
# Disk cache setup (diskcache, falls back to in-memory dict if unavailable)
# ---------------------------------------------------------------------------
_disk_cache = None
_mem_cache: dict = {}   # fallback in-memory cache {key: (value, expire_ts)}

def _get_cache_dir() -> str:
    return os.environ.get("KLINE_CACHE_DIR", "/tmp/kline_cache")

def _init_disk_cache():
    global _disk_cache
    if _disk_cache is not None:
        return
    try:
        import diskcache
        _disk_cache = diskcache.Cache(_get_cache_dir())
        logger.info(f"Disk cache initialised at {_get_cache_dir()}")
    except Exception as e:
        logger.warning(f"diskcache unavailable ({e}), using in-memory fallback")
        _disk_cache = None

def _cache_get(key: str):
    _init_disk_cache()
    if _disk_cache is not None:
        try:
            return _disk_cache.get(key)
        except Exception:
            pass
    # in-memory fallback
    entry = _mem_cache.get(key)
    if entry and time.time() < entry[1]:
        return entry[0]
    return None

def _cache_set(key: str, value, ttl: int):
    _init_disk_cache()
    if _disk_cache is not None:
        try:
            _disk_cache.set(key, value, expire=ttl)
            return
        except Exception:
            pass
    _mem_cache[key] = (value, time.time() + ttl)

# ---------------------------------------------------------------------------
# Lifecycle
# ---------------------------------------------------------------------------
async def startup() -> None:
    _init_disk_cache()
    logger.info("market.startup(): disk-cache mode ready.")

async def shutdown() -> None:
    global _disk_cache
    if _disk_cache is not None:
        try:
            _disk_cache.close()
        except Exception:
            pass
    logger.info("market.shutdown(): done.")

# ---------------------------------------------------------------------------
# Binance REST (global, not .us)
# ---------------------------------------------------------------------------
async def _binance_klines(symbol: str, interval: str, limit: int) -> list[dict]:
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(BINANCE_REST, params=params)
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

async def _binance_us_klines(symbol: str, interval: str, limit: int) -> list[dict]:
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
async def _kraken_klines(symbol: str, interval: str, limit: int) -> list[dict]:
    kraken_pair = KRAKEN_PAIR.get(symbol)
    if not kraken_pair:
        raise HTTPException(status_code=400, detail=f"Symbol {symbol} not supported on Kraken fallback")
    _, kraken_minutes, _ = INTERVAL_MAP.get(interval, ("1h", 60, 3600))
    params = {"pair": kraken_pair, "interval": kraken_minutes}
    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.get(KRAKEN_REST, params=params)
        resp.raise_for_status()
        data = resp.json()
    if data.get("error"):
        raise HTTPException(status_code=502, detail=f"Kraken error: {data['error']}")
    result = data.get("result", {})
    candles = result.get(kraken_pair) or result.get(list(result.keys())[0], [])
    candles = candles[-limit:]
    return [
        {
            "time":   int(c[0]),
            "open":   float(c[1]),
            "high":   float(c[2]),
            "low":    float(c[3]),
            "close":  float(c[4]),
            "volume": float(c[6]),
        }
        for c in candles
    ]

# ---------------------------------------------------------------------------
# Unified kline fetcher (with disk cache)
# ---------------------------------------------------------------------------
async def fetch_klines(symbol: str, interval: str, limit: int) -> list[dict]:
    global _use_kraken
    cache_key = f"klines:{symbol}:{interval}:{limit}"
    cached = _cache_get(cache_key)
    if cached is not None:
        logger.debug(f"Kline cache hit: {cache_key}")
        return cached

    if _use_kraken:
        data = await _kraken_klines(symbol, interval, limit)
    else:
        try:
            data = await _binance_klines(symbol, interval, limit)
        except Exception as e:
            logger.warning(f"Binance global failed ({e}), trying Binance.US...")
            try:
                data = await _binance_us_klines(symbol, interval, limit)
            except Exception as e2:
                logger.warning(f"Binance.US failed ({e2}), switching to Kraken...")
                _use_kraken = True
                data = await _kraken_klines(symbol, interval, limit)

    ttl = CACHE_TTL.get(interval, 600)
    _cache_set(cache_key, data, ttl)
    return data

# ---------------------------------------------------------------------------
# REST endpoints
# ---------------------------------------------------------------------------

@router.get("/klines")
async def get_klines(
    symbol: str = Query("BTCUSDT"),
    interval: str = Query("1h"),
    limit: int = Query(200, ge=1, le=1000),
):
    data = await fetch_klines(symbol, interval, limit)
    return {"symbol": symbol, "interval": interval, "data": data}


@router.get("/symbols")
async def get_symbols():
    return {
        "symbols": [
            {"symbol": "BTCUSDT",  "name": "Bitcoin"},
            {"symbol": "ETHUSDT",  "name": "Ethereum"},
            {"symbol": "SOLUSDT",  "name": "Solana"},
            {"symbol": "BNBUSDT",  "name": "BNB"},
            {"symbol": "XRPUSDT",  "name": "XRP"},
            {"symbol": "DOGEUSDT", "name": "Dogecoin"},
            {"symbol": "ADAUSDT",  "name": "Cardano"},
            {"symbol": "AVAXUSDT", "name": "Avalanche"},
            {"symbol": "DOTUSDT",  "name": "Polkadot"},
            {"symbol": "LINKUSDT", "name": "Chainlink"},
            {"symbol": "MATICUSDT","name": "Polygon"},
            {"symbol": "LTCUSDT",  "name": "Litecoin"},
            {"symbol": "UNIUSDT",  "name": "Uniswap"},
            {"symbol": "ATOMUSDT", "name": "Cosmos"},
            {"symbol": "XAUUSDT",  "name": "Gold"},
            {"symbol": "XAGUSDT",  "name": "Silver"},
        ]
    }


@router.get("/ticker/{symbol}")
async def get_ticker(symbol: str):
    """
    使用 Binance /api/v3/ticker/24hr 取得正確的 24h 漲跌幅。
    priceChangePercent 與 K 線圖顯示的漲跌幅一致。
    """
    cache_key = f"ticker24h:{symbol}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.get(BINANCE_TICKER, params={"symbol": symbol})
            resp.raise_for_status()
            data = resp.json()

        result = {
            "symbol":      symbol,
            "price":       float(data["lastPrice"]),
            "change_pct":  float(data["priceChangePercent"]),
            "high":        float(data["highPrice"]),
            "low":         float(data["lowPrice"]),
            "volume":      float(data["volume"]),
            "quote_volume": float(data["quoteVolume"]),
        }
        _cache_set(cache_key, result, ttl=30)   # 30s TTL for ticker
        return result
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=502, detail=str(e))


@router.get("/tickers")
async def get_tickers(symbols: str = Query(..., description="Comma-separated symbols, e.g. BTCUSDT,ETHUSDT")):
    """
    批次取得多幣對 24h ticker，一次 API 呼叫。
    """
    symbol_list = [s.strip().upper() for s in symbols.split(",") if s.strip()]
    if not symbol_list:
        raise HTTPException(status_code=400, detail="No symbols provided")

    results = []
    for sym in symbol_list:
        cache_key = f"ticker24h:{sym}"
        cached = _cache_get(cache_key)
        if cached:
            results.append(cached)
            continue
        try:
            async with httpx.AsyncClient(timeout=10) as client:
                resp = await client.get(BINANCE_TICKER, params={"symbol": sym})
                resp.raise_for_status()
                data = resp.json()
            entry = {
                "symbol":      sym,
                "price":       float(data["lastPrice"]),
                "change_pct":  float(data["priceChangePercent"]),
                "high":        float(data["highPrice"]),
                "low":         float(data["lowPrice"]),
                "volume":      float(data["volume"]),
                "quote_volume": float(data["quoteVolume"]),
            }
            _cache_set(cache_key, entry, ttl=30)
            results.append(entry)
        except Exception as e:
            results.append({"symbol": sym, "error": str(e)})

    return {"tickers": results}


# ---------------------------------------------------------------------------
# WebSocket price stream
# ---------------------------------------------------------------------------

@router.websocket("/ws/{symbol}")
async def websocket_price(websocket: WebSocket, symbol: str, interval: str = "1m"):
    await websocket.accept()
    stream = f"{symbol.lower()}@kline_{interval}"
    uri = f"{BINANCE_US_WS}/{stream}"
    try:
        async with websockets.connect(uri) as ws:
            while True:
                try:
                    msg = await asyncio.wait_for(ws.recv(), timeout=30)
                    data = json.loads(msg)
                    k = data.get("k", {})
                    await websocket.send_json({
                        "time":   k.get("t", 0) // 1000,
                        "open":   float(k.get("o", 0)),
                        "high":   float(k.get("h", 0)),
                        "low":    float(k.get("l", 0)),
                        "close":  float(k.get("c", 0)),
                        "volume": float(k.get("v", 0)),
                        "closed": k.get("x", False),
                    })
                except asyncio.TimeoutError:
                    await websocket.send_json({"ping": True})
    except WebSocketDisconnect:
        pass
    except Exception as e:
        logger.warning(f"WS stream error: {e}")
        try:
            await websocket.close()
        except Exception:
            pass
