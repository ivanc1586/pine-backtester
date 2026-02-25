from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import httpx
import asyncio

router = APIRouter()

# Binance API fallback domains (Railway IP blocked on api.binance.com with 451)
BINANCE_HOSTS = [
    "https://api1.binance.com",
    "https://api2.binance.com",
    "https://api3.binance.com",
    "https://api4.binance.com",
]

async def fetch_binance_klines(symbol: str, interval: str, limit: int = 1000):
    """Try multiple Binance hosts until one works."""
    params = {
        "symbol": symbol.upper(),
        "interval": interval,
        "limit": min(limit, 1000)
    }
    last_error = None
    async with httpx.AsyncClient(timeout=15) as client:
        for host in BINANCE_HOSTS:
            try:
                url = f"{host}/api/v3/klines"
                response = await client.get(url, params=params)
                if response.status_code == 200:
                    return response.json()
                last_error = f"HTTP {response.status_code} from {host}"
            except Exception as e:
                last_error = str(e)
                continue
    raise Exception(f"All Binance hosts failed. Last error: {last_error}")

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
async def get_klines(symbol: str = "BTCUSDT", interval: str = "1h", source: str = "binance", limit: int = 1000):
    raw = await fetch_binance_klines(symbol, interval, limit)
    candles = []
    for k in raw:
        candles.append({
            "timestamp": int(k[0]),
            "open": float(k[1]),
            "high": float(k[2]),
            "low": float(k[3]),
            "close": float(k[4]),
            "volume": float(k[5]),
        })
    return candles

@router.websocket("/ws/{symbol}/{interval}")
async def websocket_klines(websocket: WebSocket, symbol: str, interval: str):
    await websocket.accept()
    try:
        while True:
            try:
                raw = await fetch_binance_klines(symbol, interval, limit=1)
                if raw:
                    k = raw[0]
                    await websocket.send_json({
                        "timestamp": int(k[0]),
                        "open": float(k[1]),
                        "high": float(k[2]),
                        "low": float(k[3]),
                        "close": float(k[4]),
                        "volume": float(k[5]),
                    })
            except Exception as e:
                await websocket.send_json({"error": str(e)})
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await websocket.close()
        except:
            pass