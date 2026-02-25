from fastapi import APIRouter, WebSocket, WebSocketDisconnect, HTTPException
import httpx
import asyncio
from datetime import datetime, timezone

router = APIRouter()

COINGECKO_IDS = {
    "BTCUSDT": "bitcoin", "ETHUSDT": "ethereum", "BNBUSDT": "binancecoin",
    "SOLUSDT": "solana", "XRPUSDT": "ripple", "ADAUSDT": "cardano",
    "DOGEUSDT": "dogecoin", "AVAXUSDT": "avalanche-2", "DOTUSDT": "polkadot",
    "MATICUSDT": "matic-network", "LINKUSDT": "chainlink", "UNIUSDT": "uniswap",
    "LTCUSDT": "litecoin", "ATOMUSDT": "cosmos", "NEARUSDT": "near",
}

COINCAP_IDS = {
    "BTCUSDT": "bitcoin", "ETHUSDT": "ethereum", "BNBUSDT": "binance-coin",
    "SOLUSDT": "solana", "XRPUSDT": "xrp", "ADAUSDT": "cardano",
    "DOGEUSDT": "dogecoin", "AVAXUSDT": "avalanche", "DOTUSDT": "polkadot",
    "MATICUSDT": "polygon", "LINKUSDT": "chainlink", "UNIUSDT": "uniswap",
    "LTCUSDT": "litecoin", "ATOMUSDT": "cosmos", "NEARUSDT": "near-protocol",
}

# CoinCap interval strings
COINCAP_INTERVALS = {
    "1m": "m1", "5m": "m5", "15m": "m15", "30m": "m30",
    "1h": "h1", "4h": "h4", "1d": "d1", "1w": "w1",
}

def interval_to_minutes(interval: str) -> int:
    return {"1m":1,"5m":5,"15m":15,"30m":30,"1h":60,"4h":240,"1d":1440,"1w":10080}.get(interval, 60)

def interval_to_coingecko_days(interval: str, limit: int) -> int:
    minutes = interval_to_minutes(interval)
    days = max(1, (minutes * limit) // 1440)
    return min(days, 365)

async def fetch_coingecko(symbol: str, interval: str, limit: int):
    coin_id = COINGECKO_IDS.get(symbol.upper(), "bitcoin")
    days = interval_to_coingecko_days(interval, limit)
    url = f"https://api.coingecko.com/api/v3/coins/{coin_id}/ohlc"
    params = {"vs_currency": "usd", "days": str(days)}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, params=params)
        if r.status_code == 429:
            raise HTTPException(status_code=429, detail="CoinGecko rate limit hit. Wait 60s.")
        r.raise_for_status()
        data = r.json()
    candles = []
    for row in data[-limit:]:
        candles.append({
            "timestamp": int(row[0]),
            "open":  float(row[1]),
            "high":  float(row[2]),
            "low":   float(row[3]),
            "close": float(row[4]),
            "volume": 0.0,
        })
    return candles

async def fetch_coincap(symbol: str, interval: str, limit: int):
    asset_id = COINCAP_IDS.get(symbol.upper(), "bitcoin")
    iv = COINCAP_INTERVALS.get(interval, "h1")   # correct interval format
    interval_ms = interval_to_minutes(interval) * 60 * 1000
    end_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    start_ms = end_ms - (interval_ms * limit)
    url = f"https://api.coincap.io/v2/assets/{asset_id}/history"
    params = {"interval": iv, "start": start_ms, "end": end_ms}
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        data = r.json().get("data", [])
    candles = []
    for item in data[-limit:]:
        ts = int(item["time"])
        price = float(item["priceUsd"])
        candles.append({
            "timestamp": ts,
            "open": price, "high": price, "low": price, "close": price,
            "volume": 0.0,
        })
    return candles

async def fetch_binance(symbol: str, interval: str, limit: int):
    hosts = ["api1.binance.com", "api2.binance.com", "api3.binance.com", "api.binance.com"]
    last_err = None
    for host in hosts:
        url = f"https://{host}/api/v3/klines"
        params = {"symbol": symbol.upper(), "interval": interval, "limit": limit}
        try:
            async with httpx.AsyncClient(timeout=15) as client:
                r = await client.get(url, params=params)
                r.raise_for_status()
                data = r.json()
            candles = []
            for row in data:
                candles.append({
                    "timestamp": int(row[0]),
                    "open":   float(row[1]),
                    "high":   float(row[2]),
                    "low":    float(row[3]),
                    "close":  float(row[4]),
                    "volume": float(row[5]),
                })
            return candles
        except Exception as e:
            last_err = e
            continue
    raise HTTPException(status_code=503, detail=f"Binance unreachable: {last_err}")

@router.get("/klines")
async def get_klines(symbol: str, interval: str, limit: int = 500, source: str = "coingecko"):
    source = source.lower().strip()
    if source == "coingecko":
        return await fetch_coingecko(symbol, interval, limit)
    elif source == "coincap":
        return await fetch_coincap(symbol, interval, limit)
    else:
        return await fetch_binance(symbol, interval, limit)

@router.websocket("/ws/klines")
async def websocket_klines(websocket: WebSocket):
    await websocket.accept()
    try:
        config = await websocket.receive_json()
        symbol   = config.get("symbol",   "BTCUSDT")
        interval = config.get("interval", "1h")
        source   = config.get("source",   "coingecko")
        while True:
            try:
                candles = await get_klines(symbol, interval, limit=1, source=source)
                await websocket.send_json({"candles": candles})
            except Exception as e:
                await websocket.send_json({"error": str(e)})
            await asyncio.sleep(30)
    except WebSocketDisconnect:
        pass
