from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import market, strategy, backtest, optimize
import uvicorn
import os

app = FastAPI(
    title="Pine Backtester API",
    description="Crypto strategy backtesting platform with Pine Script support",
    version="2.0.0"
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(market.router,    prefix="/api/market",      tags=["Market Data"])
app.include_router(strategy.router,  prefix="/api/strategies",  tags=["Strategies"])
app.include_router(backtest.router,  prefix="/api/backtest",    tags=["Backtest"])
app.include_router(optimize.router,  prefix="/api/optimize",    tags=["Strategy Optimize"])

@app.get("/")
async def root():
    return {"status": "ok", "message": "Pine Backtester API is running", "version": "2.0.0"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
