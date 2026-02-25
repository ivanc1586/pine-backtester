from fastapi import APIRouter

router = APIRouter()

@router.get("/symbols")
async def get_symbols():
    return {
        "symbols": [
            {"symbol": "BTCUSDT", "name": "Bitcoin / USDT"},
            {"symbol": "ETHUSDT", "name": "Ethereum / USDT"},
            {"symbol": "BNBUSDT", "name": "BNB / USDT"},
            {"symbol": "SOLUSDT", "name": "Solana / USDT"},
            {"symbol": "ADAUSDT", "name": "Cardano / USDT"},
            {"symbol": "XRPUSDT", "name": "XRP / USDT"},
            {"symbol": "DOGEUSDT", "name": "Dogecoin / USDT"},
            {"symbol": "AVAXUSDT", "name": "Avalanche / USDT"},
        ]
    }

@router.get("/klines")
async def get_klines(symbol: str = "BTCUSDT", interval: str = "1d", limit: int = 100):
    import httpx
    url = f"https://api.binance.com/api/v3/klines"
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, params=params)
        data = resp.json()
    return {
        "symbol": symbol,
        "interval": interval,
        "klines": [
            {
                "time": k[0],
                "open": float(k[1]),
                "high": float(k[2]),
                "low": float(k[3]),
                "close": float(k[4]),
                "volume": float(k[5]),
            }
            for k in data
        ],
    }
