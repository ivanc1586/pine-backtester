from fastapi import APIRouter
from pydantic import BaseModel
from typing import List, Optional
import httpx

router = APIRouter()

class BacktestRequest(BaseModel):
    symbol: str = "BTCUSDT"
    interval: str = "1d"
    limit: int = 100
    strategy: str = "sma_cross"
    params: dict = {}

async def fetch_klines(symbol: str, interval: str, limit: int):
    url = "https://api.binance.com/api/v3/klines"
    params = {"symbol": symbol, "interval": interval, "limit": limit}
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, params=params)
        data = resp.json()
    return [
        {
            "time": k[0],
            "open": float(k[1]),
            "high": float(k[2]),
            "low": float(k[3]),
            "close": float(k[4]),
            "volume": float(k[5]),
        }
        for k in data
    ]

def run_sma_cross(klines, fast=10, slow=30):
    closes = [k["close"] for k in klines]
    trades = []
    position = None
    equity = 10000.0
    for i in range(slow, len(closes)):
        fast_ma = sum(closes[i - fast:i]) / fast
        slow_ma = sum(closes[i - slow:i]) / slow
        if fast_ma > slow_ma and position is None:
            position = {"entry": closes[i], "entry_time": klines[i]["time"]}
        elif fast_ma < slow_ma and position is not None:
            pnl = (closes[i] - position["entry"]) / position["entry"] * equity
            equity += pnl
            trades.append({
                "entry_time": position["entry_time"],
                "exit_time": klines[i]["time"],
                "entry": position["entry"],
                "exit": closes[i],
                "pnl": round(pnl, 2),
                "equity": round(equity, 2),
            })
            position = None
    return trades, equity

@router.post("/run")
async def run_backtest(req: BacktestRequest):
    klines = await fetch_klines(req.symbol, req.interval, req.limit)
    fast = req.params.get("fast_period", 10)
    slow = req.params.get("slow_period", 30)
    trades, final_equity = run_sma_cross(klines, fast=fast, slow=slow)
    total_trades = len(trades)
    winning = [t for t in trades if t["pnl"] > 0]
    win_rate = len(winning) / total_trades * 100 if total_trades > 0 else 0
    return {
        "symbol": req.symbol,
        "interval": req.interval,
        "strategy": req.strategy,
        "total_trades": total_trades,
        "win_rate": round(win_rate, 2),
        "final_equity": round(final_equity, 2),
        "trades": trades,
        "klines": klines,
    }
