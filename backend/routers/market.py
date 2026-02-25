from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import httpx
import asyncio
from datetime import datetime, timezone

router = APIRouter()

# ── CoinGecko ID map ──────────────────────────────────────────────────────────
COINGECKO_IDS = {
    "BTCUSDT": "bitcoin",
    "ETHUSDT": "ethereum",
    "BNBUSDT": "binancecoin",
    "SOLUSDT": "solana",
    "XRPUSDT": "ripple",
    "ADAUSDT": "cardano",
    "DOGEUSDT": "dogecoin",
    "AVAXUSDT": "avalanche-2",
}

# ── CoinCap ID map ────────────────────────────────────────────────────────────
COINCAP_IDS = {
    "BTCUSDT": "bitcoin",
    "ETHUSDT": "ethereum",
    "BNBUSDT": "binance-coin",
    "SOLUSDT": "solana",
    "XRPUSDT": "xrp",
    "ADAUSDT": "cardano",
    "DOGEUSDT": "dogecoin",
    "AVAXUSDT": "avalanche",
}

# ── Interval helpers ──────────────────────────────────────────────────────────
def interval_to_coingecko_days(interval: str, limit: int) -> int:
    minutes = {"1m": 1, "5m": 5, "15m": 15, "30m": 30,
               "1h": 60, "4h": 240, "1d": 1440}.get(interval, 60)
    days = max(1, (minutes * limit) // 1440)
    return min(days, 365)

def interval_to_coincap_ms(interval: str) -> int:
    return {"1m": 60000, "5m": 300000, "15m": 900000, "30m": 1800000,
            "1h": 3600000, "4h": 14400000, "1d": 86400000}.get(interval, 3600000)

# ── Data fetchers ─────────────────────────────────────────────────────────────
async def fetch_coingecko(symbol: str, interval: str, limit: int):
    coin_id = COINGECKO_IDS.get(symbol.upper(), "bitcoin")
    days = interval_to_coingecko_days(interval, limit)
    url = f"https://api.coingecko.com/api/v3/coins/{coin_id}/ohlc"
    params = {"vs_currency": "usd", "days": str(days)}
    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        data = r.json()  # [[timestamp_ms, open, high, low, close], ...]
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
    interval_ms = interval_to_coincap_ms(interval)
    end_ms = int(datetime.now(timezone.utc).timestamp() * 1000)
    start_ms = end_ms - interval_ms * limit
    url = f"https://api.coincap.io/v2/assets/{asset_id}/history"
    params = {
        "interval": "h1",   # CoinCap free tier: m1/m5/m15/h1/d1
        "start": str(start_ms),
        "end": str(end_ms),
    }
    # Map our interval to CoinCap's interval param
    coincap_interval_map = {
        "1m": "m1", "5m": "m5", "15m": "m15",
        "30m": "m15", "1h": "h1", "4h": "h1", "1d": "d1",
    }
    params["interval"] = coincap_interval_map.get(interval, "h1")

    async with httpx.AsyncClient(timeout=20) as client:
        r = await client.get(url, params=params)
        r.raise_for_status()
        data = r.json().get("data", [])

    candles = []
    prev_price = None
    for row in data[-limit:]:
        price = float(row["priceUsd"])
        candles.append({
            "timestamp": int(row["time"]),
            "open":  prev_price if prev_price is not None else price,
            "high":  price,
            "low":   price,
            "close": price,
            "volume": 0.0,
        })
        prev_price = price
    return candles

async def fetch_binance(symbol: str, interval: str, limit: int):
    hosts = [
        "https://api1.binance.com",
        "https://api2.binance.com",
        "https://api3.binance.com",
        "https://api4.binance.com",
    ]
    params = {"symbol": symbol.upper(), "interval": interval, "limit": min(limit, 1000)}
    last_error = None
    async with httpx.AsyncClient(timeout=15) as client:
        for host in hosts:
            try:
                r = await client.get(f"{host}/api/v3/klines", params=params)
                if r.status_code == 200:
                    raw = r.json()
                    return [{
                        "timestamp": int(k[0]),
                        "open":  float(k[1]),
                        "high":  float(k[2]),
                        "low":   float(k[3]),
                        "close": float(k[4]),
                        "volume": float(k[5]),
                    } for k in raw]
                last_error = f"HTTP {r.status_code} from {host}"
            except Exception as e:
                last_error = str(e)
    raise Exception(f"All Binance hosts failed: {last_error}")

# ── Router ────────────────────────────────────────────────────────────────────
@router.get("/symbols")
async def get_symbols():
    return {
        "symbols": [
            {"symbol": "BTCUSDT", "name": "Bitcoin/USDT"},
            {"symbol": "ETHUSDT", "name": "Ethereum/USDT"},
            {"symbol": "BNBUSDT", "name": "BNB/USDT"},
            {"symbol": "SOLUSDT", "name": "Solana/USDT"},
            {"symbol": "XRPUSDT", "name": "XRP/USDT"},
            {"symbol": "ADAUSDT", "name": "Cardano/USDT"},
            {"symbol": "DOGEUSDT", "name": "Dogecoin/USDT"},
            {"symbol": "AVAXUSDT", "name": "Avalanche/USDT"},
        ]
    }

@router.get("/klines")
async def get_klines(
    symbol: str = "BTCUSDT",
    interval: str = "1h",
    source: str = "coingecko",
    limit: int = 500,
):
    if source == "coincap":
        return await fetch_coincap(symbol, interval, limit)
    elif source == "binance":
        return await fetch_binance(symbol, interval, limit)
    else:  # default: coingecko
        return await fetch_coingecko(symbol, interval, limit)

@router.websocket("/ws/{symbol}/{interval}")
async def websocket_klines(websocket: WebSocket, symbol: str, interval: str):
    await websocket.accept()
    try:
        while True:
            try:
                candles = await fetch_coingecko(symbol, interval, limit=2)
                if candles:
                    await websocket.send_json(candles[-1])
            except Exception as e:
                await websocket.send_json({"error": str(e)})
            await asyncio.sleep(30)
    except WebSocketDisconnect:
        pass
