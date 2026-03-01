# =============================================================================
# routers/backtest.py  v3.0.0 - 2026-03-01
# FIXES:
#   - TV-aligned execution: signal detected on bar N close, order fills on bar N+1 OPEN
#     (matches TradingView default: process_orders_on_close=false)
#   - Eliminates look-ahead bias: entry/exit price = next bar's open, not signal bar's close
#   - PnL accounting unchanged (TV-aligned units/commission from v2.0.0)
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

    Execution model (process_orders_on_close=false, TV default):
      - Signal is detected on bar N close (after both MAs are confirmed)
      - Order fills on bar N+1 OPEN price
      - This eliminates look-ahead bias and matches TradingView behaviour

    Position sizing: dynamic compounding (recalculate units at each entry using current equity).
    Commission: applied on BOTH entry AND exit legs.
    Returns (trades, final_equity, equity_curve).
    """
    closes = [k["close"] for k in klines]
    opens  = [k["open"]  for k in klines]
    n = len(closes)
    trades = []
    position = None
    equity = initial_capital
    equity_curve = [initial_capital]

    # pending_signal: set on bar i, executed on bar i+1 open
    # None | "entry" | "exit"
    pending_signal = None

    for i in range(slow, n):
        # -- Step 1: Execute pending order from PREVIOUS bar's signal --
        if pending_signal == "entry" and position is None:
            price = opens[i]   # fill on this bar's open
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
            pending_signal = None

        elif pending_signal == "exit" and position is not None:
            price = opens[i]   # fill on this bar's open
            units = position["units"]
            comm_exit = (units * price * commission_value
                         if commission_type == "percent"
                         else commission_value)
            gross = units * (price - position["entry"])
            pnl   = gross - position["comm_entry"] - comm_exit
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
            pending_signal = None

        else:
            pending_signal = None  # stale signal (e.g. already in position), clear it

        # -- Step 2: Detect signal on bar i close --
        # Use bars [i-fast:i] and [i-slow:i] -- does NOT include bar i+1 (no look-ahead)
        fast_ma = sum(closes[i - fast + 1 : i + 1]) / fast
        slow_ma = sum(closes[i - slow + 1 : i + 1]) / slow
        fast_ma_prev = sum(closes[i - fast : i]) / fast
        slow_ma_prev = sum(closes[i - slow : i]) / slow

        if fast_ma_prev <= slow_ma_prev and fast_ma > slow_ma and position is None:
            pending_signal = "entry"   # golden cross confirmed on bar i close -> fill on bar i+1 open
        elif fast_ma_prev >= slow_ma_prev and fast_ma < slow_ma and position is not None:
            pending_signal = "exit"    # death cross confirmed on bar i close -> fill on bar i+1 open

    # -- Close open position at last bar (market close) --
    if position is not None:
        price = closes[-1]
        units = position["units"]
        comm_exit = (units * price * commission_value
                     if commission_type == "percent"
                     else commission_value)
        gross = units * (price - position["entry"])
        pnl   = gross - position["comm_entry"] - comm_exit
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
