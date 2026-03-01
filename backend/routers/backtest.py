# =============================================================================
# routers/backtest.py  v2.0.0 - 2026-03-01
# FIXES:
#   - run_sma_cross: 修正 PnL 計算 bug（原本乘以 equity 導致天文數字）
#     改為 TV-aligned: units = equity * qty_pct / entry_price
#     PnL = units*(exit-entry) - comm_entry - comm_exit
#   - commission 雙向扣除（entry + exit）
#   - final_equity 正確反映累積複利
# =============================================================================

from fastapi import APIRouter
from pydantic import BaseModel
from typing import Optional
import httpx
import numpy as np

router = APIRouter()


class BacktestRequest(BaseModel):
    symbol: str = "BTCUSDT"
    interval: str = "1d"
    limit: int = 100
    strategy: str = "sma_cross"
    initial_capital: float = 10000.0
    commission_value: float = 0.001
    commission_type: str = "percent"
    qty_type: str = "percent_of_equity"
    qty_value: float = 100.0
    params: dict = {}


async def fetch_klines(symbol: str, interval: str, limit: int):
    url = "https://api.binance.com/api/v3/klines"
    p = {"symbol": symbol, "interval": interval, "limit": limit}
    async with httpx.AsyncClient(timeout=15) as client:
        resp = await client.get(url, params=p)
        resp.raise_for_status()
        data = resp.json()
    return [
        {
            "time":   k[0],
            "open":   float(k[1]),
            "high":   float(k[2]),
            "low":    float(k[3]),
            "close":  float(k[4]),
            "volume": float(k[5]),
        }
        for k in data
    ]


def run_sma_cross(
    klines: list,
    fast: int = 10,
    slow: int = 30,
    initial_capital: float = 10000.0,
    commission_value: float = 0.001,
    commission_type: str = "percent",
    qty_type: str = "percent_of_equity",
    qty_value: float = 100.0,
):
    """
    TV-aligned SMA cross backtest.
    units recalculated at each entry using current equity (dynamic compounding).
    Commission applied on BOTH entry AND exit legs.
    Returns (trades, final_equity, equity_curve).
    """
    closes = [k["close"] for k in klines]
    n = len(closes)
    trades = []
    position = None
    equity = initial_capital
    equity_curve = [initial_capital]

    for i in range(slow, n):
        fast_ma = sum(closes[i - fast:i]) / fast
        slow_ma = sum(closes[i - slow:i]) / slow
        price = closes[i]

        # --- Entry ---
        if fast_ma > slow_ma and position is None:
            if qty_type == "percent_of_equity":
                units = (equity * qty_value / 100.0) / price
            elif qty_type == "cash":
                units = qty_value / price
            else:
                units = qty_value

            comm_entry = (units * price * commission_value
                          if commission_type == "percent"
                          else commission_value)
            equity -= comm_entry
            position = {
                "entry":      price,
                "entry_time": klines[i]["time"],
                "units":      units,
                "comm_entry": comm_entry,
            }

        # --- Exit ---
        elif fast_ma < slow_ma and position is not None:
            units = position["units"]
            comm_exit = (units * price * commission_value
                         if commission_type == "percent"
                         else commission_value)
            gross = units * (price - position["entry"])
            pnl = gross - position["comm_entry"] - comm_exit
            equity += gross - comm_exit
            ep = position["entry"]
            trades.append({
                "entry_time":  position["entry_time"],
                "exit_time":   klines[i]["time"],
                "entry_price": round(ep, 6),
                "exit_price":  round(price, 6),
                "side":        "long",
                "pnl":         round(pnl, 4),
                "pnl_pct":     round((price - ep) / ep * 100.0, 4),
                "equity":      round(equity, 2),
            })
            equity_curve.append(round(equity, 2))
            position = None

    # Close open position at last bar
    if position is not None:
        price = closes[-1]
        units = position["units"]
        comm_exit = (units * price * commission_value
                     if commission_type == "percent"
                     else commission_value)
        gross = units * (price - position["entry"])
        pnl = gross - position["comm_entry"] - comm_exit
        equity += gross - comm_exit
        ep = position["entry"]
        trades.append({
            "entry_time":  position["entry_time"],
            "exit_time":   klines[-1]["time"],
            "entry_price": round(ep, 6),
            "exit_price":  round(price, 6),
            "side":        "long",
            "pnl":         round(pnl, 4),
            "pnl_pct":     round((price - ep) / ep * 100.0, 4),
            "equity":      round(equity, 2),
        })
        equity_curve.append(round(equity, 2))

    return trades, round(equity, 2), equity_curve


def calc_basic_metrics(trades, equity_curve, initial_capital):
    if not trades:
        return {
            "total_trades": 0, "win_rate": 0.0, "profit_pct": 0.0,
            "profit_factor": 0.0, "max_drawdown": 0.0, "sharpe_ratio": 0.0,
            "final_equity": initial_capital, "gross_profit": 0.0, "gross_loss": 0.0,
        }
    pnls = [t["pnl"] for t in trades]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]
    win_rate = len(wins) / len(pnls) * 100
    gross_profit = sum(wins) if wins else 0.0
    gross_loss = abs(sum(losses)) if losses else 1e-9
    profit_factor = gross_profit / gross_loss
    eq_arr = np.array(equity_curve, dtype=float)
    peak = np.maximum.accumulate(eq_arr)
    dd = (peak - eq_arr) / np.where(peak == 0, 1, peak) * 100
    max_drawdown = float(dd.max())
    final_equity = equity_curve[-1]
    profit_pct = (final_equity - initial_capital) / initial_capital * 100
    return {
        "total_trades":  len(trades),
        "win_rate":      round(win_rate, 2),
        "profit_pct":    round(profit_pct, 2),
        "profit_factor": round(profit_factor, 4),
        "max_drawdown":  round(max_drawdown, 2),
        "sharpe_ratio":  0.0,
        "final_equity":  round(final_equity, 2),
        "gross_profit":  round(gross_profit, 2),
        "gross_loss":    round(gross_loss, 2),
    }


@router.post("/run")
async def run_backtest(req: BacktestRequest):
    klines = await fetch_klines(req.symbol, req.interval, req.limit)
    fast = int(req.params.get("fast_period", req.params.get("fastLength", 10)))
    slow = int(req.params.get("slow_period", req.params.get("slowLength", 30)))
    trades, final_equity, equity_curve = run_sma_cross(
        klines, fast=fast, slow=slow,
        initial_capital=req.initial_capital,
        commission_value=req.commission_value,
        commission_type=req.commission_type,
        qty_type=req.qty_type,
        qty_value=req.qty_value,
    )
    metrics = calc_basic_metrics(trades, equity_curve, req.initial_capital)
    return {
        "symbol": req.symbol, "interval": req.interval, "strategy": req.strategy,
        "klines": klines, "trades": trades, "equity_curve": equity_curve,
        **metrics,
    }
