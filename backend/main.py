from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from routers import market, strategy, backtest
import uvicorn
import asyncio
import httpx
import json

app = FastAPI(
    title="Pine Backtester API",
    description="Crypto strategy backtesting platform with Pine Script support",
    version="1.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(market.router, prefix="/api/market", tags=["Market Data"])
app.include_router(strategy.router, prefix="/api/strategy", tags=["Strategy"])
app.include_router(backtest.router, prefix="/api/backtest", tags=["Backtest"])

@app.get("/")
async def root():
    return {"status": "ok", "message": "Pine Backtester API is running"}

@app.websocket("/ws/market/{symbol}/{interval}")
async def websocket_market(websocket: WebSocket, symbol: str, interval: str):
    await websocket.accept()
    try:
        while True:
            async with httpx.AsyncClient() as client:
                resp = await client.get(
                    "https://api.binance.com/api/v3/klines",
                    params={"symbol": symbol.upper(), "interval": interval, "limit": 1}
                )
                if resp.status_code == 200:
                    data = resp.json()
                    if data:
                        k = data[0]
                        await websocket.send_json({
                            "time": k[0] // 1000,
                            "open": float(k[1]),
                            "high": float(k[2]),
                            "low": float(k[3]),
                            "close": float(k[4]),
                            "volume": float(k[5])
                        })
            await asyncio.sleep(5)
    except WebSocketDisconnect:
        pass

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
