from fastapi import FastAPI, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from routers import market, strategy, backtest
import uvicorn
import asyncio

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

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)