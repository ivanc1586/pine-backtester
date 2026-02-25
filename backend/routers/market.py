from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import httpx
import asyncio

router = APIRouter()

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
    url = "https://api.binance.com/api/v3/klines"
    params = {
        "symbol": symbol.upper(),
        "interval": interval,
        "limit": min(limit, 1000)
    }
    async with httpx.AsyncClient() as client:
        response = await client.get(url, params=params, timeout=30)
        response.raise_for_status()
        raw = response.json()

    # Binance klines: [openTime(ms), open, high, low, close, volume, ...]
    # Frontend expects: timestamp (ms), open, high, low, close, volume
    candles = []
    for k in raw:
        candles.append({
            "timestamp": int(k[0]),   # keep as milliseconds - frontend divides by 1000
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
            url = "https://api.binance.com/api/v3/klines"
            params = {
                "symbol": symbol.upper(),
                "interval": interval,
                "limit": 1
            }
            async with httpx.AsyncClient() as client:
                response = await client.get(url, params=params, timeout=10)
                response.raise_for_status()
                raw = response.json()

            if raw:
                k = raw[0]
                candle = {
                    "timestamp": int(k[0]),   # milliseconds - frontend divides by 1000
                    "open": float(k[1]),
                    "high": float(k[2]),
                    "low": float(k[3]),
                    "close": float(k[4]),
                    "volume": float(k[5]),
                }
                await websocket.send_json(candle)

            await asyncio.sleep(5)
    except WebSocketDisconnect:
        pass
    except Exception:
        try:
            await websocket.close()
        except:
            pass