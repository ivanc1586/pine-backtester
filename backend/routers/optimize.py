# =============================================================================
# 修改歷程記錄
# -----------------------------------------------------------------------------
# v1.0.0 - 2026-02-26 - 初始版本
#   - 新增 Pine Script input 參數自動解析（支援 input.int / input.float / input.bool）
#   - 新增 Gemini AI 轉譯層：將 Pine Script 邏輯動態轉為 Python 回測函式
#   - 新增 Optuna 優化引擎（TPE sampler），支援 SSE 串流進度回報
#   - 防止偷看未來：ta.highest/lowest 強制使用 shift(1)
#   - 正確處理 var 狀態與 strategy.position_size 跨 K 棒邏輯
#   - 優化指標：profit_pct / win_rate / profit_factor / max_drawdown / sharpe
#   - 結果含前 10 組合 + 每月績效 + 交易列表（供前端圖表使用）
# =============================================================================

from __future__ import annotations

import re
import os
import json
import traceback
import asyncio
from typing import Any
from datetime import datetime, timezone

import numpy as np
import pandas as pd
import optuna
import httpx
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

optuna.logging.set_verbosity(optuna.logging.WARNING)

router = APIRouter()

# ─────────────────────────────────────────────────────────────────────────────
# Schemas
# ─────────────────────────────────────────────────────────────────────────────

class ParamRange(BaseModel):
    name: str
    min_val: float
    max_val: float
    step: float
    is_int: bool = True

class OptimizeRequest(BaseModel):
    pine_script: str
    symbol: str = "BTCUSDT"
    interval: str = "1h"
    source: str = "binance"
    start_date: str = "2023-01-01"
    end_date: str = ""
    initial_capital: float = 10000.0
    commission: float = 0.001
    quantity: float = 1.0
    param_ranges: list[ParamRange]
    sort_by: str = "profit_pct"
    n_trials: int = 100
    top_n: int = 10

class ParseRequest(BaseModel):
    pine_script: str


# ─────────────────────────────────────────────────────────────────────────────
# 1. Pine Script input 解析
# ─────────────────────────────────────────────────────────────────────────────

INPUT_PATTERN = re.compile(
    r'(\w+)\s*=\s*input\.(int|float|bool|string)\s*\('
    r'\s*(?:title\s*=\s*["\']([^"\']*)["\'],\s*)?'
    r'(?:defval\s*=\s*)?([^,\)\n]+)',
    re.MULTILINE,
)

def parse_pine_inputs(pine_script: str) -> list[dict]:
    params = []
    seen = set()
    for m in INPUT_PATTERN.finditer(pine_script):
        var_name = m.group(1)
        kind     = m.group(2)
        title    = m.group(3) or var_name
        raw_def  = m.group(4).strip().strip('"\'')
        if var_name in seen:
            continue
        seen.add(var_name)
        try:
            if kind == "int":
                default = int(float(raw_def))
                params.append({"name": var_name, "title": title, "type": "int",
                                "default": default, "min_val": max(1, default // 2),
                                "max_val": default * 3, "step": 1})
            elif kind == "float":
                default = float(raw_def)
                params.append({"name": var_name, "title": title, "type": "float",
                                "default": default,
                                "min_val": round(default * 0.3, 4),
                                "max_val": round(default * 3.0, 4),
                                "step": round(default * 0.1, 4)})
            elif kind == "bool":
                default = raw_def.lower() == "true"
                params.append({"name": var_name, "title": title, "type": "bool",
                                "default": default})
        except Exception:
            pass
    return params


# ─────────────────────────────────────────────────────────────────────────────
# 2. Market data fetch
# ─────────────────────────────────────────────────────────────────────────────

def _parse_date_ms(date_str: str) -> int:
    return int(datetime.strptime(date_str, "%Y-%m-%d").replace(tzinfo=timezone.utc).timestamp() * 1000)

async def fetch_candles(symbol: str, interval: str, start_date: str, end_date: str) -> list[dict]:
    start_ms = _parse_date_ms(start_date)
    end_ms   = _parse_date_ms(end_date) if end_date else int(datetime.now(timezone.utc).timestamp() * 1000)
    interval_ms_map = {
        "1m": 60_000, "3m": 180_000, "5m": 300_000, "15m": 900_000,
        "30m": 1_800_000, "1h": 3_600_000, "2h": 7_200_000,
        "4h": 14_400_000, "6h": 21_600_000, "12h": 43_200_000,
        "1d": 86_400_000, "1w": 604_800_000,
    }
    iv_ms = interval_ms_map.get(interval, 3_600_000)
    limit = min(1000, (end_ms - start_ms) // iv_ms + 1)
    async with httpx.AsyncClient(timeout=30) as client:
        r = await client.get(
            "https://api.binance.com/api/v3/klines",
            params={"symbol": symbol.upper(), "interval": interval,
                    "startTime": start_ms, "endTime": end_ms, "limit": limit},
        )
        r.raise_for_status()
        rows = r.json()
    return [{"timestamp": int(row[0]), "open": float(row[1]), "high": float(row[2]),
             "low": float(row[3]), "close": float(row[4]), "volume": float(row[5])}
            for row in rows]


# ─────────────────────────────────────────────────────────────────────────────
# 3. Gemini AI 轉譯層
# ─────────────────────────────────────────────────────────────────────────────

GEMINI_API_KEY = os.getenv("GEMINI_API_KEY", "")
GEMINI_MODEL   = "gemini-2.0-flash"
GEMINI_URL     = f"https://generativelanguage.googleapis.com/v1beta/models/{GEMINI_MODEL}:generateContent"

SYSTEM_PROMPT = """You are an expert Pine Script to Python converter for backtesting.
Convert the given Pine Script strategy to a Python function.

STRICT RULES:
1. Function signature: def run_strategy(df: pd.DataFrame, **params) -> list[dict]
2. df columns: timestamp(ms int), open, high, low, close, volume (all float except timestamp)
3. Return list of trade dicts: {entry_time, exit_time, entry_price, exit_price, direction, pnl_pct}
4. direction: "long" or "short"
5. NO lookahead bias: use .shift(1) for previous bar values
6. ta.highest(src, n) => df[src].shift(1).rolling(n).max()
7. ta.lowest(src, n)  => df[src].shift(1).rolling(n).min()
8. EMA: close.ewm(span=length, adjust=False).mean()
9. SMMA/RMA: ewm(alpha=1/length, adjust=False).mean()
10. ATR: tr = max(high-low, |high-prev_close|, |low-prev_close|); atr = tr.ewm(alpha=1/length, adjust=False).mean()
11. RSI: use Wilder smoothing ewm(alpha=1/length, adjust=False)
12. var variables: use scalar Python variables updated in loop
13. Track position with: in_position bool + entry_price + entry_time
14. Commission is applied by backtester, do NOT deduct in run_strategy
15. Only import: pandas as pd, numpy as np
16. Return ONLY the Python function code, no markdown fences, no explanation.
17. Handle NaN: skip bars where indicators are NaN
"""

async def translate_pine_to_python(pine_script: str, param_names: list[str]) -> str:
    if not GEMINI_API_KEY:
        return _fallback_strategy(param_names)

    user_prompt = (
        f"Pine Script to convert:\n```pine\n{pine_script}\n```\n\n"
        f"Parameter names passed as **params: {param_names}\n\n"
        "Generate run_strategy(df, **params) Python function. No markdown fences."
    )
    payload = {
        "system_instruction": {"parts": [{"text": SYSTEM_PROMPT}]},
        "contents": [{"parts": [{"text": user_prompt}]}],
        "generationConfig": {"temperature": 0.1, "maxOutputTokens": 8192},
    }
    async with httpx.AsyncClient(timeout=60) as client:
        r = await client.post(GEMINI_URL, params={"key": GEMINI_API_KEY}, json=payload)
        r.raise_for_status()
        data = r.json()
    code = data["candidates"][0]["content"]["parts"][0]["text"]
    code = re.sub(r"^```(?:python)?\n?", "", code.strip())
    code = re.sub(r"\n?```$", "", code.strip())
    return code


def _fallback_strategy(param_names: list[str]) -> str:
    return (
        "def run_strategy(df, **params):\n"
        "    fast = int(params.get('fastLength', params.get('fast_length', 10)))\n"
        "    slow = int(params.get('slowLength', params.get('slow_length', 30)))\n"
        "    df = df.copy()\n"
        "    df['ema_fast'] = df['close'].ewm(span=fast, adjust=False).mean()\n"
        "    df['ema_slow'] = df['close'].ewm(span=slow, adjust=False).mean()\n"
        "    trades, in_pos, ep, et = [], False, 0.0, 0\n"
        "    for i in range(slow + 1, len(df)):\n"
        "        pf = df['ema_fast'].iloc[i-1]; ps = df['ema_slow'].iloc[i-1]\n"
        "        cf = df['ema_fast'].iloc[i];  cs = df['ema_slow'].iloc[i]\n"
        "        price = df['close'].iloc[i];  ts = int(df['timestamp'].iloc[i])\n"
        "        if not in_pos and pf <= ps and cf > cs:\n"
        "            in_pos, ep, et = True, price, ts\n"
        "        elif in_pos and pf >= ps and cf < cs:\n"
        "            trades.append({'entry_time': et, 'exit_time': ts,\n"
        "                           'entry_price': ep, 'exit_price': price,\n"
        "                           'direction': 'long', 'pnl_pct': (price-ep)/ep*100})\n"
        "            in_pos = False\n"
        "    return trades\n"
    )


# ─────────────────────────────────────────────────────────────────────────────
# 4. Backtest executor
# ─────────────────────────────────────────────────────────────────────────────

def _compile_strategy(python_code: str):
    ns: dict[str, Any] = {"pd": pd, "np": np}
    exec(compile(python_code, "<ai_strategy>", "exec"), ns)
    fn = ns.get("run_strategy")
    if fn is None:
        raise ValueError("AI output missing run_strategy function")
    return fn


def run_backtest(candles, strategy_fn, params, initial_capital=10000.0,
                 commission=0.001, quantity=1.0) -> dict:
    df = pd.DataFrame(candles)
    try:
        trades = strategy_fn(df.copy(), **params)
    except Exception as e:
        return {"error": str(e), "trades": [], "profit_pct": -9999,
                "win_rate": 0, "profit_factor": 0, "max_drawdown": 0,
                "total_trades": 0, "sharpe": 0, "monthly": [], "params": params}

    if not trades:
        return {"trades": [], "equity_curve": [], "profit_pct": 0, "win_rate": 0,
                "profit_factor": 0, "max_drawdown": 0, "total_trades": 0,
                "sharpe": 0, "final_equity": initial_capital, "monthly": [], "params": params}

    equity = initial_capital
    equities = [equity]
    pnl_list = []
    wins = losses = 0
    gross_profit = gross_loss = 0.0
    enriched = []

    for t in trades:
        net_pnl_pct = t.get("pnl_pct", 0.0) - commission * 2 * 100
        pnl_dollar  = equity * net_pnl_pct / 100
        equity     += pnl_dollar
        equities.append(equity)
        pnl_list.append(net_pnl_pct)
        if net_pnl_pct > 0:
            wins += 1; gross_profit += pnl_dollar
        else:
            losses += 1; gross_loss += abs(pnl_dollar)
        enriched.append({**t, "net_pnl_pct": round(net_pnl_pct, 4),
                          "equity_after": round(equity, 2)})

    total   = len(trades)
    wr      = wins / total * 100 if total else 0
    pf      = gross_profit / gross_loss if gross_loss > 0 else 999.0
    pp      = (equity - initial_capital) / initial_capital * 100
    eq_arr  = np.array(equities)
    peaks   = np.maximum.accumulate(eq_arr)
    mdd     = float(np.max((peaks - eq_arr) / peaks * 100))
    arr     = np.array(pnl_list)
    sharpe  = float(arr.mean() / (arr.std() + 1e-9) * np.sqrt(252)) if len(arr) > 1 else 0.0
    monthly = _monthly_breakdown(enriched)
    eq_curve = [{"time": int(t["exit_time"]), "value": round(t["equity_after"], 2)}
                for t in enriched]

    return {"trades": enriched, "equity_curve": eq_curve,
            "profit_pct": round(pp, 4), "win_rate": round(wr, 2),
            "profit_factor": round(pf, 4), "max_drawdown": round(mdd, 4),
            "total_trades": total, "sharpe": round(sharpe, 4),
            "final_equity": round(equity, 2), "monthly": monthly, "params": params}


def _monthly_breakdown(trades: list[dict]) -> list[dict]:
    monthly: dict[str, float] = {}
    for t in trades:
        try:
            ts  = int(t["exit_time"]) // 1000
            key = datetime.fromtimestamp(ts, tz=timezone.utc).strftime("%Y-%m")
            monthly[key] = monthly.get(key, 0.0) + t.get("net_pnl_pct", 0.0)
        except Exception:
            pass
    return [{"month": k, "pnl_pct": round(v, 4)} for k, v in sorted(monthly.items())]


# ─────────────────────────────────────────────────────────────────────────────
# 5. API Endpoints
# ─────────────────────────────────────────────────────────────────────────────

SORT_REVERSE = {
    "profit_pct": True, "win_rate": True, "profit_factor": True,
    "max_drawdown": False, "sharpe": True,
}


@router.post("/parse-inputs")
async def parse_inputs(req: ParseRequest):
    """Auto-detect all input() parameters from Pine Script."""
    try:
        return {"params": parse_pine_inputs(req.pine_script)}
    except Exception as e:
        raise HTTPException(status_code=400, detail=str(e))


@router.post("/translate")
async def translate_endpoint(req: ParseRequest):
    """Translate Pine Script to Python via Gemini (preview)."""
    try:
        names = [p["name"] for p in parse_pine_inputs(req.pine_script)]
        code  = await translate_pine_to_python(req.pine_script, names)
        return {"python_code": code}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/run")
async def optimize_run(req: OptimizeRequest):
    """Full pipeline with SSE streaming: fetch -> translate -> Optuna optimize."""

    async def stream():
        try:
            yield f"data: {json.dumps({'type':'status','message':'正在獲取市場數據...'})}\'+'\\n\\n'
            end = req.end_date or datetime.now(timezone.utc).strftime("%Y-%m-%d")
            candles = await fetch_candles(req.symbol, req.interval, req.start_date, end)
            if not candles:
                yield f"data: {json.dumps({'type':'error','message':'無法獲取市場數據'})}\'+'\\n\\n'
                return

            yield f"data: {json.dumps({'type':'status','message':f'獲取 {len(candles)} 根 K 棒，翻譯策略中...'})}\'+'\\n\\n'
            param_names = [pr.name for pr in req.param_ranges]
            try:
                python_code = await translate_pine_to_python(req.pine_script, param_names)
                strategy_fn = _compile_strategy(python_code)
            except Exception as e:
                yield f"data: {json.dumps({'type':'error','message':f'策略轉譯失敗: {e}'})}\'+'\\n\\n'
                return

            yield f"data: {json.dumps({'type':'status','message':f'轉譯完成，開始 Optuna 優化 ({req.n_trials} 次試驗)...'})}\'+'\\n\\n'

            results: list[dict] = []
            sort_by = req.sort_by
            reverse = SORT_REVERSE.get(sort_by, True)

            def objective(trial: optuna.Trial) -> float:
                p: dict[str, Any] = {}
                for pr in req.param_ranges:
                    if pr.is_int:
                        p[pr.name] = trial.suggest_int(pr.name, int(pr.min_val), int(pr.max_val), step=max(1, int(pr.step)))
                    else:
                        p[pr.name] = trial.suggest_float(pr.name, pr.min_val, pr.max_val, step=pr.step)
                res = run_backtest(candles, strategy_fn, p, req.initial_capital, req.commission, req.quantity)
                if "error" in res:
                    return -9999.0
                results.append(res)
                m = res.get(sort_by, 0.0)
                return m if reverse else -m

            loop  = asyncio.get_event_loop()
            study = optuna.create_study(direction="maximize",
                                         sampler=optuna.samplers.TPESampler(seed=42))
            chunk  = max(1, req.n_trials // 10)

            for step in range(0, req.n_trials, chunk):
                n = min(chunk, req.n_trials - step)
                await loop.run_in_executor(None, lambda n=n: study.optimize(objective, n_trials=n, show_progress_bar=False))
                done = min(step + chunk, req.n_trials)
                pct  = round(done / req.n_trials * 100)
                yield f"data: {json.dumps({'type':'progress','progress':pct,'done':done,'total':req.n_trials})}\'+'\\n\\n'

            key_fn = (lambda r: r.get(sort_by, 0.0)) if reverse else (lambda r: -r.get(sort_by, 0.0))
            results.sort(key=key_fn, reverse=True)
            top = results[:req.top_n]
            for i, r in enumerate(top):
                r["rank"] = i + 1

            yield f"data: {json.dumps({'type':'complete','results':top,'total_trials':req.n_trials,'python_code':python_code})}\'+'\\n\\n'

        except Exception as e:
            yield f"data: {json.dumps({'type':'error','message':str(e),'detail':traceback.format_exc()})}\'+'\\n\\n'

    return StreamingResponse(stream(), media_type="text/event-stream",
                             headers={"Cache-Control":"no-cache","X-Accel-Buffering":"no"})
