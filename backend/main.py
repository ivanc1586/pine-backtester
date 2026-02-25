from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from routers import market, strategy, backtest
import uvicorn
import logging

logging.basicConfig(level=logging.INFO)

@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: init DB, pre-warm data, start WS streams and 60s sync
    await market.startup()
    yield
    # Shutdown: cancel all background tasks
    await market.shutdown()

app = FastAPI(
    title="Pine Backtester API",
    description="Crypto strategy backtesting platform with Pine Script support",
    version="2.0.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(market.router, prefix="/api/market", tags=["market"])
app.include_router(strategy.router, prefix="/api/strategy", tags=["strategy"])
app.include_router(backtest.router, prefix="/api/backtest", tags=["backtest"])

@app.get("/")
async def root():
    return {"status": "ok", "message": "Pine Backtester API is running"}

if __name__ == "__main__":
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=False)
