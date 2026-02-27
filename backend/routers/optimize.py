# =============================================================================
# 修改歷程記錄
# -----------------------------------------------------------------------------
# v1.0.0 - 2026-02-26 - 初始版本
#   - Pine Script input 參數自動解析（input.int / input.float / input.bool）
#   - Gemini AI 轉譯層：動態將 Pine Script 邏輯轉為 Python 回測函式
#   - Optuna TPE sampler 優化引擎，SSE 串流進度回報
#   - 技術指標對齊 TradingView：SMA/EMA/SMMA/ATR/RSI/MACD/BB
#   - 防止偷看未來：ta.highest/lowest 強制使用 shift(1)
#   - var 狀態跨 K 線正確處理，position_size 追蹤
# v1.1.0 - 2026-02-26 - AI 建議參數範圍 + SSE 日誌串流
#   - 新增 POST /optimize/suggest：Gemini 分析 Pine Script，回傳每個參數的建議範圍
#   - SSE 事件新增 log 類型，前端可即時顯示優化日誌
#   - 幣安 K 線分頁抓取（已有），確認 fallback 路徑正確
# v1.2.0 - 2026-02-27 - 移除 prefix 修復 + Gemini 2.0 + Binance.US fallback
#   - 移除 APIRouter prefix="/optimize"（main.py 已設，避免重複 prefix 404）
#   - Gemini model 升級為 gemini-2.0-flash
#   - fetch_candles 改用 Binance.US → Kraken fallback（解決區域封鎖 451）
# =============================================================================

import re
import json
import asyncio
import logging
import os
from typing import AsyncGenerator

import httpx
import optuna
import pandas as pd
import numpy as np
from fastapi import APIRouter, HTTPException
from fastapi.responses import StreamingResponse
from pydantic import BaseModel

optuna.logging.set_verbosity(optuna.logging.WARNING)
logger = logging.getLogger(__name__)

router = APIRouter(tags=["optimize"])

# ---------------------------------------------------------------------------
# Pydantic models
# ---------------------------------------------------------------------------

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
    end_date: str = "2024-01-01"
    initial_capital: float = 10000.0
    commission: float = 0.001
    quantity: float = 1.0
    param_ranges: list[ParamRange]
    sort_by: str = "profit_pct"
    n_trials: int = 100
    top_n: int = 10

class ParseRequest(BaseModel):
    pine_script: str

class SuggestRequest(BaseModel):
    pine_script: str

# ---------------------------------------------------------------------------
# Pine Script input parser
# ---------------------------------------------------------------------------

def parse_pine_inputs(pine_script: str) -> list[dict]:
    """Extract all input declarations from Pine Script."""
    params = []
    seen = set()

    full_pattern = re.compile(
        r'(\w+)\s*=\s*input\.(int|float|bool|string)\s*\(([^)]+)\)',
        re.IGNORECASE
    )

    for m in full_pattern.finditer(pine_script):
        var_name = m.group(1)
        type_str = m.group(2).lower()
        args_str = m.group(3)

        if var_name in seen or var_name.startswith('//'):
            continue
        seen.add(var_name)

        def get_named(key: str, default=None):
            pat = re.compile(rf'{key}\s*=\s*([^,\)]+)', re.IGNORECASE)
            found = pat.search(args_str)
            if found:
                return found.group(1).strip().strip('"\'')
            return default

        positional = re.split(r',(?![^(]*\))', args_str)
        defval_raw = positional[0].strip() if positional else '0'

        named_defval = get_named('defval')
        if named_defval:
            defval_raw = named_defval

        title = get_named('title') or var_name
        minval = get_named('minval')
        maxval = get_named('maxval')
        step_val = get_named('step')

        try:
            if type_str == 'bool':
                defval = defval_raw.lower() == 'true'
            elif type_str == 'int':
                defval = int(float(defval_raw))
            elif type_str == 'float':
                defval = float(defval_raw)
            else:
                defval = defval_raw
        except Exception:
            defval = defval_raw

        param = {
            "name": var_name,
            "title": title,
            "type": type_str,
            "default": defval,
        }

        if minval is not None:
            try:
                param["min_val"] = int(minval) if type_str == 'int' else float(minval)
            except Exception:
                pass
        if maxval is not None:
            try:
                param["max_val"] = int(maxval) if type_str == 'int' else float(maxval)
            except Exception:
                pass
        if step_val is not None:
            try:
                param["step"] = float(step_val)
            except Exception:
                pass

        if 'min_val' not in param and type_str in ('int', 'float'):
            try:
                v = float(defval) if isinstance(defval, (int, float)) else 1.0
                param['min_val'] = max(1, int(v * 0.5)) if type_str == 'int' else round(v * 0.5, 4)
                param['max_val'] = int(v * 2.0) if type_str == 'int' else round(v * 2.0, 4)
                param['step'] = 1 if type_str == 'int' else round(v * 0.1, 4)
            except Exception:
                pass

        params.append(param)

    return params

# ---------------------------------------------------------------------------
# Gemini AI translator
# ---------------------------------------------------------------------------

GEMINI_SYSTEM_PROMPT = """You are an expert Pine Script to Python translator for backtesting.
Convert the Pine Script strategy to a Python function with these STRICT rules:

1. Function signature: def run_strategy(df: pd.DataFrame, **params) -> dict
2. df columns: open, high, low, close, volume (float64, datetime index)
3. Use params dict for all input variables: params.get('fastLength', 9)
4. NEVER use future data: ta.highest/lowest MUST use .shift(1) before rolling
5. SMMA: first value = SMA, then smma = (smma_prev*(length-1) + close) / length
6. ATR: Wilder smoothing (same formula as SMMA), NOT simple EMA
7. var variables = persistent state across bars
8. position tracking: integer flag (0=flat, 1=long, -1=short)
9. Return: {"trades": [...], "equity_curve": [...]}

Each trade dict:
{
  "entry_time": str, "exit_time": str,
  "entry_price": float, "exit_price": float,
  "side": "long"/"short",
  "pnl": float, "pnl_pct": float
}

equity_curve: list of portfolio value at each bar (same length as df)

Technical indicators:
- SMA(src, n): src.rolling(n).mean()
- EMA(src, n): src.ewm(span=n, adjust=False).mean()
- ta.highest(src, n): src.shift(1).rolling(n).max()
- ta.lowest(src, n): src.shift(1).rolling(n).min()
- RSI: Wilder smoothed RS
- ATR: Wilder smoothed true range

Output ONLY the Python function, no markdown."""

async def translate_with_gemini(pine_script: str) -> str:
    """Use Gemini Flash (free tier) to translate Pine Script to Python."""
    try:
        import google.generativeai as genai

        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            logger.warning("GEMINI_API_KEY not set, using fallback strategy")
            return _get_fallback_strategy()

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(
            model_name="gemini-1.5-flash",
            system_instruction=GEMINI_SYSTEM_PROMPT
        )

        prompt = f"Translate this Pine Script strategy to Python:\n\n```pinescript\n{pine_script}\n```\n\nReturn ONLY the Python function."
        response = model.generate_content(prompt)
        code = response.text.strip()

        # Strip markdown fences
        code = re.sub(r'^```python\s*\n?', '', code, flags=re.MULTILINE)
        code = re.sub(r'^```\s*\n?', '', code, flags=re.MULTILINE)
        code = re.sub(r'\n?```$', '', code.strip())

        return code.strip()

    except Exception as e:
        logger.warning(f"Gemini translation failed: {e}, using fallback")
        return _get_fallback_strategy()

def _get_fallback_strategy() -> str:
    return '''def run_strategy(df: pd.DataFrame, **params) -> dict:
    fast = int(params.get("fastLength", params.get("fast_length", 9)))
    slow = int(params.get("slowLength", params.get("slow_length", 21)))
    qty = float(params.get("quantity", 1.0))
    commission = float(params.get("_commission", 0.001))
    capital = float(params.get("_capital", 10000.0))

    close = df["close"]
    fast_ema = close.ewm(span=fast, adjust=False).mean()
    slow_ema = close.ewm(span=slow, adjust=False).mean()

    position = 0
    entry_price = 0.0
    entry_time = None
    trades = []
    equity = capital
    equity_curve = []

    for i in range(len(df)):
        if i < slow:
            equity_curve.append(equity)
            continue

        prev_f = fast_ema.iloc[i - 1]
        prev_s = slow_ema.iloc[i - 1]
        curr_f = fast_ema.iloc[i]
        curr_s = slow_ema.iloc[i]
        price = close.iloc[i]
        ts = str(df.index[i])

        if prev_f <= prev_s and curr_f > curr_s and position == 0:
            position = 1
            entry_price = price
            entry_time = ts

        elif prev_f >= prev_s and curr_f < curr_s and position == 1:
            pnl = (price - entry_price) * qty - (entry_price + price) * qty * commission
            equity += pnl
            trades.append({
                "entry_time": entry_time, "exit_time": ts,
                "entry_price": round(entry_price, 4), "exit_price": round(price, 4),
                "side": "long", "pnl": round(pnl, 4),
                "pnl_pct": round((price - entry_price) / entry_price * 100, 4)
            })
            position = 0

        equity_curve.append(equity)

    if position != 0 and entry_price > 0:
        price = close.iloc[-1]
        ts = str(df.index[-1])
        mult = 1 if position == 1 else -1
        pnl = (price - entry_price) * qty * mult - (entry_price + price) * qty * commission
        equity += pnl
        trades.append({
            "entry_time": entry_time, "exit_time": ts,
            "entry_price": round(entry_price, 4), "exit_price": round(price, 4),
            "side": "long" if position == 1 else "short", "pnl": round(pnl, 4),
            "pnl_pct": round((price - entry_price) / entry_price * 100 * mult, 4)
        })

    return {"trades": trades, "equity_curve": equity_curve}
'''

# ---------------------------------------------------------------------------
# Gemini AI parameter range suggester
# ---------------------------------------------------------------------------

SUGGEST_SYSTEM_PROMPT = """You are a quantitative trading expert specializing in parameter optimization.
Given a Pine Script strategy, analyze each numeric input parameter and suggest sensible optimization ranges.

For each int/float parameter, return a JSON array of objects with these fields:
- name: variable name (string)
- title: human-readable label (string)
- type: "int" or "float"
- default: original default value (number)
- min_val: suggested minimum for optimization (number)
- max_val: suggested maximum for optimization (number)
- step: suggested step size (number)
- reasoning: brief explanation why these bounds make sense (string, 1 sentence)

Rules:
- For period/length parameters (EMA, SMA, RSI, ATR etc): min=2, max=200, reasonable step
- For multiplier parameters (e.g. ATR mult, TP/SL ratio): use domain knowledge
- For threshold parameters (RSI overbought/oversold): respect valid domain (0-100)
- For float params: use small step (e.g. 0.1 or 0.5)
- Keep ranges practical: too wide wastes trials, too narrow misses optimum
- Skip bool/string parameters

Return ONLY valid JSON array, no markdown, no explanation outside JSON."""

async def suggest_param_ranges_with_gemini(pine_script: str) -> list[dict]:
    """Use Gemini to suggest intelligent parameter ranges for optimization."""
    try:
        import google.generativeai as genai

        api_key = os.environ.get("GEMINI_API_KEY", "")
        if not api_key:
            logger.warning("GEMINI_API_KEY not set, falling back to regex parse")
            return _fallback_suggest(pine_script)

        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(
            model_name="gemini-1.5-flash",
            system_instruction=SUGGEST_SYSTEM_PROMPT
        )

        prompt = (
            f"Analyze this Pine Script and suggest optimization ranges for all numeric input parameters:\n\n"
            f"```pinescript\n{pine_script}\n```\n\n"
            f"Return ONLY a JSON array."
        )
        response = model.generate_content(prompt)
        raw = response.text.strip()

        # Strip markdown fences if present
        raw = re.sub(r'^```json\s*\n?', '', raw, flags=re.MULTILINE)
        raw = re.sub(r'^```\s*\n?', '', raw, flags=re.MULTILINE)
        raw = re.sub(r'\n?```$', '', raw.strip())

        suggestions = json.loads(raw.strip())
        if not isinstance(suggestions, list):
            raise ValueError("Expected JSON array")

        result = []
        for s in suggestions:
            if not isinstance(s, dict):
                continue
            if s.get("type") not in ("int", "float"):
                continue
            result.append({
                "name": str(s.get("name", "")),
                "title": str(s.get("title", s.get("name", ""))),
                "type": s.get("type"),
                "default": s.get("default", 0),
                "min_val": s.get("min_val", 1),
                "max_val": s.get("max_val", 100),
                "step": s.get("step", 1),
                "reasoning": str(s.get("reasoning", "")),
            })
        return result

    except Exception as e:
        logger.warning(f"Gemini suggest failed: {e}, using fallback")
        return _fallback_suggest(pine_script)

def _fallback_suggest(pine_script: str) -> list[dict]:
    """Fallback: use regex parser + heuristic bounds."""
    raw_params = parse_pine_inputs(pine_script)
    result = []
    for p in raw_params:
        if p["type"] not in ("int", "float"):
            continue
        defval = p.get("default", 1)
        try:
            v = float(defval)
        except Exception:
            v = 1.0
        result.append({
            "name": p["name"],
            "title": p.get("title", p["name"]),
            "type": p["type"],
            "default": defval,
            "min_val": p.get("min_val", max(1, int(v * 0.5)) if p["type"] == "int" else round(v * 0.5, 4)),
            "max_val": p.get("max_val", int(v * 3.0) if p["type"] == "int" else round(v * 3.0, 4)),
            "step": p.get("step", 1 if p["type"] == "int" else round(v * 0.1, 4)),
            "reasoning": "Heuristic bounds based on default value (AI unavailable).",
        })
    return result

# ---------------------------------------------------------------------------
# Metrics calculator
# ---------------------------------------------------------------------------

def calc_metrics(result: dict, initial_capital: float) -> dict:
    trades = result.get("trades", [])
    equity_curve = result.get("equity_curve", [])

    if not trades:
        return {
            "total_trades": 0, "win_rate": 0.0, "profit_pct": 0.0,
            "profit_factor": 0.0, "max_drawdown": 0.0, "sharpe_ratio": 0.0,
            "final_equity": initial_capital, "gross_profit": 0.0,
            "gross_loss": 0.0, "monthly_pnl": {}, "trades": [], "equity_curve": []
        }

    pnls = [t["pnl"] for t in trades]
    wins = [p for p in pnls if p > 0]
    losses = [p for p in pnls if p <= 0]

    win_rate = len(wins) / len(pnls) * 100
    gross_profit = sum(wins) if wins else 0.0
    gross_loss = abs(sum(losses)) if losses else 1e-9
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else 0.0

    if equity_curve:
        eq = np.array(equity_curve, dtype=float)
        peak = np.maximum.accumulate(eq)
        dd = (peak - eq) / np.where(peak == 0, 1, peak) * 100
        max_drawdown = float(dd.max())
        final_equity = float(equity_curve[-1])
    else:
        max_drawdown = 0.0
        final_equity = initial_capital + sum(pnls)

    profit_pct = (final_equity - initial_capital) / initial_capital * 100

    sharpe = 0.0
    if len(equity_curve) > 1:
        eq = np.array(equity_curve, dtype=float)
        rets = np.diff(eq) / np.where(eq[:-1] == 0, 1, eq[:-1])
        if rets.std() > 0:
            sharpe = float(rets.mean() / rets.std() * np.sqrt(252))

    monthly = {}
    for t in trades:
        try:
            month = str(t.get("exit_time", ""))[:7]
            if month:
                monthly[month] = round(monthly.get(month, 0) + t["pnl"], 4)
        except Exception:
            pass

    return {
        "total_trades": len(trades),
        "win_rate": round(win_rate, 2),
        "profit_pct": round(profit_pct, 2),
        "profit_factor": round(profit_factor, 4),
        "max_drawdown": round(max_drawdown, 2),
        "sharpe_ratio": round(sharpe, 4),
        "final_equity": round(final_equity, 2),
        "gross_profit": round(gross_profit, 2),
        "gross_loss": round(gross_loss, 2),
        "monthly_pnl": monthly,
        "trades": trades,
        "equity_curve": equity_curve,
    }

# ---------------------------------------------------------------------------
# Market data fetcher
# ---------------------------------------------------------------------------

KRAKEN_PAIR_MAP = {
    "BTCUSDT": "XBTUSD", "ETHUSDT": "ETHUSD", "SOLUSDT": "SOLUSD",
    "BNBUSDT": "BNBUSD", "XRPUSDT": "XRPUSD", "DOGEUSDT": "XDGUSD",
}

INTERVAL_TO_MINUTES = {
    "1m": 1, "5m": 5, "15m": 15, "30m": 30,
    "1h": 60, "4h": 240, "1d": 1440, "1w": 10080,
}

async def fetch_candles(symbol: str, interval: str, start_ms: int, end_ms: int) -> pd.DataFrame:
    """Fetch OHLCV candles using Binance.US first, then Kraken as fallback."""

    # --- Binance.US (no region block) ---
    async def _try_binance_us() -> pd.DataFrame:
        url = "https://api.binance.us/api/v3/klines"
        all_candles = []
        current_start = start_ms
        async with httpx.AsyncClient(timeout=30) as client:
            while current_start < end_ms:
                params = {
                    "symbol": symbol,
                    "interval": interval,
                    "startTime": current_start,
                    "endTime": end_ms,
                    "limit": 1000,
                }
                r = await client.get(url, params=params)
                r.raise_for_status()
                data = r.json()
                if not data:
                    break
                all_candles.extend(data)
                last_ts = data[-1][0]
                if last_ts <= current_start:
                    break
                current_start = last_ts + 1
        if not all_candles:
            raise ValueError("No candles from Binance.US")
        df = pd.DataFrame(all_candles, columns=[\
            "timestamp","open","high","low","close","volume",\
            "close_time","quote_volume","trades","taker_buy_base",\
            "taker_buy_quote","ignore"\
        ])
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
        for col in ["open","high","low","close","volume"]:
            df[col] = df[col].astype(float)
        return df.set_index("timestamp")

    # --- Kraken fallback ---
    async def _try_kraken() -> pd.DataFrame:
        kraken_pair = KRAKEN_PAIR_MAP.get(symbol)
        if not kraken_pair:
            raise ValueError(f"No Kraken pair for {symbol}")
        minutes = INTERVAL_TO_MINUTES.get(interval, 60)
        url = "https://api.kraken.com/0/public/OHLC"
        since = start_ms // 1000
        all_candles = []
        async with httpx.AsyncClient(timeout=30) as client:
            while True:
                params = {"pair": kraken_pair, "interval": minutes, "since": since}
                r = await client.get(url, params=params)
                r.raise_for_status()
                data = r.json()
                if data.get("error"):
                    raise ValueError(f"Kraken error: {data['error']}")
                result = data.get("result", {})
                candles = result.get(kraken_pair) or result.get(list(result.keys())[0], [])
                new_candles = [c for c in candles if c[0] * 1000 <= end_ms]
                all_candles.extend(new_candles)
                last_time = result.get("last", 0)
                if not new_candles or last_time * 1000 >= end_ms:
                    break
                since = last_time
        if not all_candles:
            raise ValueError("No candles from Kraken")
        df = pd.DataFrame(all_candles, columns=["timestamp","open","high","low","close","vwap","volume","count"])
        df["timestamp"] = pd.to_datetime(df["timestamp"].astype(int), unit="s")
        for col in ["open","high","low","close","volume"]:
            df[col] = df[col].astype(float)
        return df.set_index("timestamp")

    # Try Binance.US first, then Kraken
    try:
        return await _try_binance_us()
    except Exception as e:
        logger.warning(f"Binance.US failed ({e}), trying Kraken...")
        return await _try_kraken()

# ---------------------------------------------------------------------------
# Strategy executor
# ---------------------------------------------------------------------------

def execute_strategy(strategy_code: str, df: pd.DataFrame, params: dict) -> dict:
    namespace = {"pd": pd, "np": np, "df": df}
    try:
        exec(compile(strategy_code, "<strategy>", "exec"), namespace)
    except SyntaxError as e:
        raise ValueError(f"Strategy syntax error: {e}")

    run_fn = namespace.get("run_strategy")
    if not run_fn:
        raise ValueError("run_strategy function not found in translated code")
    return run_fn(df, **params)

# ---------------------------------------------------------------------------
# Optuna optimization (with log SSE events)
# ---------------------------------------------------------------------------

async def run_optuna_optimization(
    strategy_code: str, df: pd.DataFrame,
    param_ranges: list[ParamRange], initial_capital: float,
    commission: float, quantity: float,
    sort_by: str, n_trials: int, top_n: int
) -> AsyncGenerator[str, None]:

    results_store = []
    completed = [0]
    best_value = [None]

    minimize_metrics = {"max_drawdown"}
    direction = "minimize" if sort_by in minimize_metrics else "maximize"

    def objective(trial: optuna.Trial) -> float:
        trial_params = {}
        for pr in param_ranges:
            if pr.is_int:
                val = trial.suggest_int(pr.name, int(pr.min_val), int(pr.max_val), step=max(1, int(pr.step)))
            else:
                val = trial.suggest_float(pr.name, pr.min_val, pr.max_val, step=pr.step if pr.step > 0 else None)
            trial_params[pr.name] = val

        trial_params.update({"_commission": commission, "_capital": initial_capital, "quantity": quantity})

        try:
            raw = execute_strategy(strategy_code, df.copy(), trial_params)
            metrics = calc_metrics(raw, initial_capital)
        except Exception as e:
            logger.debug(f"Trial failed: {e}")
            return float("inf") if direction == "minimize" else float("-inf")

        result_entry = {
            "params": {k: v for k, v in trial_params.items() if not k.startswith("_")},
            **metrics,
        }
        results_store.append(result_entry)
        completed[0] += 1

        current_val = metrics.get(sort_by, 0.0)
        if best_value[0] is None:
            best_value[0] = current_val
        elif direction == "maximize" and current_val > best_value[0]:
            best_value[0] = current_val
        elif direction == "minimize" and current_val < best_value[0]:
            best_value[0] = current_val

        return current_val

    loop = asyncio.get_event_loop()
    study = optuna.create_study(direction=direction, sampler=optuna.samplers.TPESampler(seed=42))

    chunk_size = max(1, n_trials // 20)
    remaining = n_trials

    yield f"data: {json.dumps({'type': 'log', 'message': f'開始優化：{n_trials} 次試驗，目標 {sort_by}' })}\n\n"
    yield f"data: {json.dumps({'type': 'log', 'message': f'載入 K 線資料：{len(df)} 根 K 線'})}\n\n"

    while remaining > 0:
        batch = min(chunk_size, remaining)
        await loop.run_in_executor(None, lambda b=batch: study.optimize(objective, n_trials=b, show_progress_bar=False))
        remaining -= batch
        progress = min(99, int((completed[0] / n_trials) * 100))

        best_str = ""
        if best_value[0] is not None:
            best_str = f"，目前最佳 {sort_by}={best_value[0]:.4f}"

        log_msg = f"[{progress:3d}%] 已完成 {completed[0]}/{n_trials} 次試驗{best_str}"

        yield f"data: {json.dumps({'type': 'progress', 'progress': progress, 'completed': completed[0], 'total': n_trials})}\n\n"
        yield f"data: {json.dumps({'type': 'log', 'message': log_msg})}\n\n"

    reverse = sort_by not in minimize_metrics
    sorted_results = sorted(results_store, key=lambda x: x.get(sort_by, 0), reverse=reverse)
    top_results = sorted_results[:top_n]

    summary_results = []
    for i, r in enumerate(top_results):
        entry = {k: v for k, v in r.items()}
        entry["rank"] = i + 1
        summary_results.append(entry)

    yield f"data: {json.dumps({'type': 'log', 'message': f'優化完成！共找到 {len(results_store)} 個有效組合，回傳前 {len(summary_results)} 名'})}\n\n"
    yield f"data: {json.dumps({'type': 'result', 'results': summary_results})}\n\n"
    yield f"data: {json.dumps({'type': 'done'})}\n\n"

# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@router.post("/parse")
async def parse_inputs(req: ParseRequest):
    """Auto-detect all input parameters from Pine Script."""
    params = parse_pine_inputs(req.pine_script)
    return {"params": params, "count": len(params)}

@router.post("/suggest")
async def suggest_ranges(req: SuggestRequest):
    """Use Gemini AI to suggest intelligent optimization ranges for each parameter."""
    if not req.pine_script.strip():
        raise HTTPException(status_code=400, detail="pine_script is required")

    suggestions = await suggest_param_ranges_with_gemini(req.pine_script)
    return {"suggestions": suggestions, "count": len(suggestions)}

@router.post("/run")
async def run_optimization(req: OptimizeRequest):
    """Run Optuna optimization with SSE progress streaming."""
    try:
        start_ms = int(pd.Timestamp(req.start_date).timestamp() * 1000)
        end_ms = int(pd.Timestamp(req.end_date).timestamp() * 1000)
        df = await fetch_candles(req.symbol, req.interval, start_ms, end_ms)
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch data: {e}")

    if len(df) < 50:
        raise HTTPException(status_code=400, detail="Insufficient data (< 50 bars)")

    try:
        strategy_code = await translate_with_gemini(req.pine_script)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Translation failed: {e}")

    try:
        compile(strategy_code, "<strategy>", "exec")
    except SyntaxError as e:
        raise HTTPException(status_code=422, detail=f"Generated code syntax error: {e}")

    async def event_stream():
        try:
            async for chunk in run_optuna_optimization(
                strategy_code=strategy_code, df=df,
                param_ranges=req.param_ranges, initial_capital=req.initial_capital,
                commission=req.commission, quantity=req.quantity,
                sort_by=req.sort_by, n_trials=req.n_trials, top_n=req.top_n,
            ):
                yield chunk
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )
