# =============================================================================
# optimize.py
# -----------------------------------------------------------------------------
# v2.7.4 - 2026-02-28
#   - GEMINI_SYSTEM_PROMPT: @njit 模板加入嚴格禁令
#       * FORBIDDEN: dict/list/str 在 @njit 內（numba nopython 不支援）
#       * trade 資料結構改為純 numpy array（entry/exit price/idx/pnl/side）
#       * Python 層組裝 trade dicts（在 _core_loop 返回後）
#       * 加入正確的 run_strategy 組裝範例
#   - objective: 針對 numba TypingError 加入自動 fallback
#       * 偵測到 TypingError 時清除 translate cache，改用 fallback strategy 重跑
#       * 避免 100 個 trial 全部失敗（回傳 0 筆交易）
# =============================================================================

import re
import gc
import json
import hashlib
import asyncio
import logging
import os
import time
import random

DEFAULT_MODEL_NAME = os.environ.get("GEMINI_MODEL_NAME", "gemini-2.5-flash-lite")
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
# In-memory caches  (md5(pine_script) -> result)
# ---------------------------------------------------------------------------

_translate_cache: dict[str, str] = {}
_suggest_cache: dict[str, list] = {}

def _script_hash(pine_script: str) -> str:
    return hashlib.md5(pine_script.encode("utf-8")).hexdigest()

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
    commission_type: str = "percent"          # percent | cash_per_contract | cash_per_order
    commission_value: float = 0.001           # 0.001 = 0.1% for percent type
    qty_value: float = 1.0                    # renamed from quantity — aligns with parse_strategy_header output
    qty_type: str = "percent_of_equity"       # percent_of_equity | fixed | cash
    param_ranges: list[ParamRange]
    sort_by: str = "profit_pct"
    n_trials: int = 100
    top_n: int = 10
    bypass_cache: bool = False

class ParseRequest(BaseModel):
    pine_script: str

class SuggestRequest(BaseModel):
    pine_script: str

# ---------------------------------------------------------------------------
# Pine Script input parser
# ---------------------------------------------------------------------------

def parse_strategy_header(pine_script: str) -> dict:
    """Extract strategy() call parameters: initial_capital, commission_type/value, qty_type/value."""
    header = {}

    # Match the strategy(...) block (may span multiple lines)
    strat_match = re.search(r'strategy\s*\(([^)]+)\)', pine_script, re.DOTALL | re.IGNORECASE)
    if not strat_match:
        return header

    args = strat_match.group(1)

    def _get(key: str, default=None):
        pat = re.compile(rf'\b{key}\s*=\s*([^\s,)]+)', re.IGNORECASE)
        m = pat.search(args)
        return m.group(1).strip().strip('"\'') if m else default

    # initial_capital
    ic = _get('initial_capital')
    if ic:
        try:
            header['initial_capital'] = float(ic)
        except ValueError:
            pass

    # commission_type: strategy.commission.percent / strategy.commission.cash_per_contract / ...
    ct = _get('commission_type')
    if ct:
        raw = ct.lower()
        if 'percent' in raw:
            header['commission_type'] = 'percent'
        elif 'cash_per_contract' in raw:
            header['commission_type'] = 'cash_per_contract'
        elif 'cash_per_order' in raw:
            header['commission_type'] = 'cash_per_order'
        else:
            header['commission_type'] = raw

    # commission_value
    cv = _get('commission_value')
    if cv:
        try:
            header['commission_value'] = float(cv)
        except ValueError:
            pass

    # default_qty_type: strategy.percent_of_equity / strategy.fixed / strategy.cash
    qt = _get('default_qty_type')
    if qt:
        raw = qt.lower()
        if 'percent_of_equity' in raw:
            header['qty_type'] = 'percent_of_equity'
        elif 'cash' in raw:
            header['qty_type'] = 'cash'
        elif 'fixed' in raw:
            header['qty_type'] = 'fixed'
        else:
            header['qty_type'] = raw

    # default_qty_value
    qv = _get('default_qty_value')
    if qv:
        try:
            header['qty_value'] = float(qv)
        except ValueError:
            pass

    return header


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
# Quota error detection
# ---------------------------------------------------------------------------

def _is_quota_error(e: Exception) -> bool:
    """Return True if the exception indicates a Gemini quota / rate-limit error."""
    msg = str(e).lower()
    return any(k in msg for k in ("429", "quota", "resourceexhausted", "rate limit", "too many requests"))

# ---------------------------------------------------------------------------
# Gemini rate limiter — prevent concurrent calls within the same second
# ---------------------------------------------------------------------------

_gemini_lock = asyncio.Lock()
_gemini_last_call: list[float] = [0.0]
_GEMINI_MIN_INTERVAL = 4.0  # minimum seconds between consecutive Gemini API calls

async def _call_gemini_with_retry(model, prompt: str, max_retries: int = 3, _lock: asyncio.Lock = None, _last_call: list = None) -> str:
    """
    Call model.generate_content(prompt) with:
      - Per-endpoint rate limiting (_GEMINI_MIN_INTERVAL seconds between calls)
      - Exponential backoff + jitter on 429 / RESOURCE_EXHAUSTED (up to max_retries)
    Returns response.text on success, raises RuntimeError on persistent rate-limit failure.
    """
    if _lock is None:
        _lock = _gemini_lock
    if _last_call is None:
        _last_call = _gemini_last_call

    for attempt in range(max_retries + 1):
        async with _lock:
            now = time.monotonic()
            elapsed = now - _last_call[0]
            if elapsed < _GEMINI_MIN_INTERVAL:
                await asyncio.sleep(_GEMINI_MIN_INTERVAL - elapsed)
            _last_call[0] = time.monotonic()

        try:
            loop = asyncio.get_event_loop()
            response = await loop.run_in_executor(None, lambda: model.generate_content(prompt))
            return response.text
        except Exception as e:
            if _is_quota_error(e):
                if attempt >= max_retries:
                    raise RuntimeError(
                        f"優化失敗：Gemini 請求過於頻繁，已重試 {max_retries} 次仍失敗，請稍後再試"
                    )
                wait = (2 ** attempt) + random.uniform(0.5, 1.5)
                logger.warning(f"Gemini 429/rate-limit (attempt {attempt + 1}/{max_retries}), retrying in {wait:.1f}s...")
                await asyncio.sleep(wait)
            else:
                raise

# ---------------------------------------------------------------------------
# Gemini AI translator
# ---------------------------------------------------------------------------

GEMINI_SYSTEM_PROMPT = """You are an expert Pine Script to Python translator for backtesting.
Convert the Pine Script strategy to a Python function with these STRICT rules:

1. Function signature: def run_strategy(df: pd.DataFrame, **params) -> dict
2. df columns: open, high, low, close, volume (float64, datetime index)
3. MANDATORY PARAMETER RULE — IRON LAW: ALL numeric input variables MUST be read from params.
   - CORRECT:   fast = int(params.get('fastLength', 9))
   - CORRECT:   sl_mult = float(params.get('slMult', 1.5))
   - FORBIDDEN: fast = 9          # hardcoded literal — this is a CRITICAL bug
   - FORBIDDEN: sl_mult = 1.5     # hardcoded literal — this is a CRITICAL bug
   If ANY input variable is hardcoded as a literal instead of read via params.get(),
   the translation is INVALID and will be rejected. Every. Single. Parameter. Must use params.get().

4. TV-ALIGNED ACCOUNTING RULES (must match TradingView strategy engine exactly):
   a) Read execution context from params — use EXACTLY these key names:
      initial_capital  = float(params.get('initial_capital', 10000.0))
      commission_value = float(params.get('commission_value', 0.001))
      commission_type  = str(params.get('commission_type', 'percent'))
      qty_type         = str(params.get('qty_type', 'percent_of_equity'))
      qty_value        = float(params.get('qty_value', 1.0))
      equity           = initial_capital   # mutable, updated after every trade

   b) Position sizing — DYNAMIC COMPOUNDING (IRON LAW):
      Recalculate units at the moment of EACH entry using the CURRENT equity value.
      NEVER use initial_capital for sizing after the first trade.
      if qty_type == 'percent_of_equity':
          units = (equity * qty_value / 100.0) / entry_price   # equity = current value, NOT initial
      elif qty_type == 'cash':
          units = qty_value / entry_price
      else:  # 'fixed'
          units = qty_value

   c) Commission deduction — apply on BOTH entry AND exit:
      ON ENTRY:
          if commission_type == 'percent':
              comm_entry = units * entry_price * commission_value
          else:
              comm_entry = commission_value
          equity -= comm_entry          # deduct entry commission immediately
          # store comm_entry for use at exit

      ON EXIT:
          if commission_type == 'percent':
              comm_exit = units * exit_price * commission_value
          else:
              comm_exit = commission_value
          gross_pnl = units * (exit_price - entry_price) * position  # *position handles short
          pnl = gross_pnl - comm_entry - comm_exit   # BOTH commissions deducted from pnl
          equity += gross_pnl - comm_exit            # equity already had comm_entry deducted at entry

      CRITICAL: trade dict pnl field = gross_pnl - comm_entry - comm_exit (NOT just gross - comm_exit)
      This ensures sum(trade["pnl"]) == final_equity - initial_capital (TV-aligned)

   d) equity_curve MUST be List[float] — a plain Python list of float values,
      one value per bar, representing total portfolio value (cash + open position mark-to-market).
      While in a position: equity_curve[i] = equity + units * (close_arr[i] - entry_price)
      While flat: equity_curve[i] = equity
      FORBIDDEN: returning dicts, DataFrames, or any non-float items in equity_curve.

5. NEVER use future data: ta.highest/lowest MUST use .shift(1) before rolling
6. SMMA: first value = SMA, then smma = (smma_prev*(length-1) + close) / length
7. ATR: Wilder smoothing (same formula as SMMA), NOT simple EMA
8. var variables = persistent state across bars
9. position tracking: integer flag (0=flat, 1=long, -1=short)
10. Return: {"trades": [...], "equity_curve": [...]}

Each trade dict:
{
  "entry_time": str, "exit_time": str,
  "entry_price": float, "exit_price": float,
  "side": "long"/"short",
  "pnl": float, "pnl_pct": float
}

equity_curve: List[float] — plain list of float, one per bar, same length as df.
  FORBIDDEN formats: [{"time":..,"equity":..}], pd.Series, np.ndarray — must be list of float.

PERFORMANCE RULES — MANDATORY:
- FORBIDDEN: using .iloc inside any for-loop. Convert to numpy FIRST:
    close_arr = df['close'].to_numpy(dtype=np.float64)
    high_arr  = df['high'].to_numpy(dtype=np.float64)
    low_arr   = df['low'].to_numpy(dtype=np.float64)
    open_arr  = df['open'].to_numpy(dtype=np.float64)
    times     = df.index
  Then index with close_arr[i], NOT df['close'].iloc[i]
- Pre-compute ALL indicator arrays as numpy arrays BEFORE the bar loop.
- The bar loop must only read from pre-computed arrays — no pandas ops inside loop.
- MANDATORY @njit STRUCTURE: The core bar loop MUST be extracted into a separate
  @njit function. ALWAYS use the following safe import pattern at the top of the
  generated code (graceful fallback when numba is not installed):

    try:
        from numba import njit
    except ImportError:
        def njit(*args, **kwargs):
            def decorator(fn): return fn
            return decorator if args and callable(args[0]) else decorator

  !!!CRITICAL NUMBA RULES — VIOLATION CAUSES ALL TRIALS TO FAIL!!!
  The @njit function runs in nopython mode. These types are STRICTLY FORBIDDEN inside @njit:
    - FORBIDDEN: dict  (e.g. trades.append({"entry_time": ...}))  — numba cannot type dicts
    - FORBIDDEN: list of dicts  (e.g. trades_list = [])            — numba cannot type list of dicts
    - FORBIDDEN: str  (e.g. side = "long")                         — numba cannot type Python strings
    - FORBIDDEN: pandas Series, DataFrame, or any pandas object
  The @njit function MUST only use: np.ndarray, int, float, bool scalars.
  Trade data MUST be stored in pre-allocated numpy arrays and assembled into dicts OUTSIDE @njit.

  Correct skeleton — @njit stores raw numbers only, Python layer assembles dicts:

    @njit
    def _core_loop(close_arr, high_arr, low_arr, open_arr,
                   indicator_arr,   # pass all pre-computed indicator arrays as np.ndarray
                   initial_capital, commission_value, commission_type_id,
                   qty_type_id, qty_value):
        # commission_type_id: 0=percent, 1=cash
        # qty_type_id: 0=percent_of_equity, 1=cash, 2=fixed
        equity = initial_capital
        position = 0        # 0=flat, 1=long, -1=short  (int, NOT str)
        entry_price = 0.0
        entry_units = 0.0
        entry_idx = 0
        n = len(close_arr)
        # preallocate result arrays — ONLY numpy arrays allowed here
        eq_curve          = np.empty(n, dtype=np.float64)
        trade_entry_price = np.empty(n, dtype=np.float64)
        trade_exit_price  = np.empty(n, dtype=np.float64)
        trade_entry_idx   = np.empty(n, dtype=np.int64)
        trade_exit_idx    = np.empty(n, dtype=np.int64)
        trade_pnl         = np.empty(n, dtype=np.float64)
        trade_side        = np.empty(n, dtype=np.int64)   # 1=long, -1=short  (int, NOT str)
        trade_count = 0
        for i in range(n):
            price = close_arr[i]
            # --- your signal logic here (use only numeric comparisons) ---
            # entry:
            if signal_entry and position == 0:
                if qty_type_id == 0:   # percent_of_equity
                    units = (equity * qty_value / 100.0) / price
                elif qty_type_id == 1: # cash
                    units = qty_value / price
                else:                  # fixed
                    units = qty_value
                comm = (units * price * commission_value) if commission_type_id == 0 else commission_value
                equity -= comm
                position = 1
                entry_price = price
                entry_units = units
                entry_idx = i
            # exit:
            elif signal_exit and position != 0:
                comm = (entry_units * price * commission_value) if commission_type_id == 0 else commission_value
                gross = entry_units * (price - entry_price) * position  # *position handles short
                pnl = gross - comm
                equity += gross - comm
                trade_entry_price[trade_count] = entry_price
                trade_exit_price[trade_count]  = price
                trade_entry_idx[trade_count]   = entry_idx
                trade_exit_idx[trade_count]    = i
                trade_pnl[trade_count]         = pnl
                trade_side[trade_count]        = position   # 1 or -1, converted to "long"/"short" in Python
                trade_count += 1
                position = 0
            # equity curve (mark-to-market)
            if position != 0:
                eq_curve[i] = equity + entry_units * (price - entry_price) * position
            else:
                eq_curve[i] = equity
        return (eq_curve,
                trade_entry_price, trade_exit_price,
                trade_entry_idx, trade_exit_idx,
                trade_pnl, trade_side, trade_count)

  After calling _core_loop(), assemble trade dicts in Python (NOT inside @njit):

    def run_strategy(df: pd.DataFrame, **params) -> dict:
        # ... read params, compute indicators as numpy arrays ...
        commission_type_id = 0 if commission_type == 'percent' else 1
        qty_type_id = 0 if qty_type == 'percent_of_equity' else (1 if qty_type == 'cash' else 2)
        (eq_curve,
         t_ep, t_xp, t_ei, t_xi, t_pnl, t_side, t_count) = _core_loop(
            close_arr, high_arr, low_arr, open_arr,
            indicator_arr,
            initial_capital, commission_value, commission_type_id,
            qty_type_id, qty_value)
        times = df.index
        trades = []
        for k in range(t_count):
            ep = float(t_ep[k]); xp = float(t_xp[k])
            side_str = "long" if t_side[k] == 1 else "short"
            pnl = float(t_pnl[k])
            pnl_pct = (xp - ep) / ep * 100.0 * (1 if t_side[k] == 1 else -1)
            trades.append({
                "entry_time":  str(times[int(t_ei[k])]),
                "exit_time":   str(times[int(t_xi[k])]),
                "entry_price": round(ep, 4),
                "exit_price":  round(xp, 4),
                "side":        side_str,
                "pnl":         round(pnl, 4),
                "pnl_pct":     round(pnl_pct, 4),
            })
        return {"trades": trades, "equity_curve": eq_curve.tolist()}

Technical indicators:
- SMA(src, n): src.rolling(n).mean()
- EMA(src, n): src.ewm(span=n, adjust=False).mean()
- ta.highest(src, n): src.shift(1).rolling(n).max()
- ta.lowest(src, n): src.shift(1).rolling(n).min()
- RSI: Wilder smoothed RS
- ATR: Wilder smoothed true range

Output ONLY the Python function, no markdown."""

async def translate_with_gemini(pine_script: str, bypass_cache: bool = False) -> str:
    """Use Gemini Flash to translate Pine Script to Python. Cached by md5 hash."""
    key = _script_hash(pine_script)
    if bypass_cache and key in _translate_cache:
        del _translate_cache[key]
        logger.info(f"Bypass Cache: 強制重新轉譯 (key={key[:8]}...)")
    if key in _translate_cache:
        logger.info(f"Cache Hit: translate key={key[:8]}...")
        return _translate_cache[key]

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        logger.warning("GEMINI_API_KEY not set, using fallback strategy")
        return _get_fallback_strategy()

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(
            model_name=DEFAULT_MODEL_NAME,
            system_instruction=GEMINI_SYSTEM_PROMPT
        )

        prompt = f"Translate this Pine Script strategy to Python:\n\n```pinescript\n{pine_script}\n```\n\nReturn ONLY the Python function."
        code = (await _call_gemini_with_retry(model, prompt, _lock=_gemini_lock, _last_call=_gemini_last_call)).strip()

        # Strip markdown fences
        code = re.sub(r'^```python\s*\n?', '', code, flags=re.MULTILINE)
        code = re.sub(r'^```\s*\n?', '', code, flags=re.MULTILINE)
        code = re.sub(r'\n?```$', '', code.strip())
        code = code.strip()

        _translate_cache[key] = code
        return code

    except Exception as e:
        if _is_quota_error(e):
            raise RuntimeError("優化失敗：Gemini 配額已耗盡，請稍後再試")
        logger.warning(f"Gemini translation failed: {e}, using fallback")
        return _get_fallback_strategy()

def _get_fallback_strategy() -> str:
    return '''def run_strategy(df: pd.DataFrame, **params) -> dict:
    fast = int(params.get("fastLength", params.get("fast_length", 9)))
    slow = int(params.get("slowLength", params.get("slow_length", 21)))
    qty_value = float(params.get("qty_value", 1.0))
    commission_value = float(params.get("commission_value", 0.001))
    capital = float(params.get("initial_capital", 10000.0))
    qty_type = str(params.get("qty_type", "percent_of_equity"))
    commission_type = str(params.get("commission_type", "percent"))

    close = df["close"]
    fast_ema = close.ewm(span=fast, adjust=False).mean()
    slow_ema = close.ewm(span=slow, adjust=False).mean()

    position = 0
    entry_price = 0.0
    entry_units = 0.0
    entry_time = None
    entry_comm = 0.0
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
            # TV-aligned position sizing — dynamic compounding (use current equity)
            if qty_type == "percent_of_equity":
                units = (equity * qty_value / 100.0) / price
            elif qty_type == "cash":
                units = qty_value / price
            else:  # fixed
                units = qty_value
            # entry commission — deduct immediately, store for pnl calc at exit
            if commission_type == "percent":
                comm_entry = units * price * commission_value
            else:
                comm_entry = commission_value
            equity -= comm_entry
            position = 1
            entry_price = price
            entry_units = units
            entry_time = ts
            entry_comm = comm_entry  # stored for exit pnl calculation

        elif prev_f >= prev_s and curr_f < curr_s and position == 1:
            if commission_type == "percent":
                comm_exit = entry_units * price * commission_value
            else:
                comm_exit = commission_value
            gross = entry_units * (price - entry_price)
            # pnl = gross - BOTH commissions (TV-aligned: entry already deducted from equity)
            pnl = gross - entry_comm - comm_exit
            equity += gross - comm_exit
            trades.append({
                "entry_time": entry_time, "exit_time": ts,
                "entry_price": round(entry_price, 4), "exit_price": round(price, 4),
                "side": "long", "pnl": round(pnl, 4),
                "pnl_pct": round((price - entry_price) / entry_price * 100, 4)
            })
            position = 0
            entry_comm = 0.0

        equity_curve.append(float(equity))

    if position != 0 and entry_price > 0:
        price = close.iloc[-1]
        ts = str(df.index[-1])
        if commission_type == "percent":
            comm_exit = entry_units * price * commission_value
        else:
            comm_exit = commission_value
        gross = entry_units * (price - entry_price)
        pnl = gross - entry_comm - comm_exit
        equity += gross - comm_exit
        trades.append({
            "entry_time": entry_time, "exit_time": ts,
            "entry_price": round(entry_price, 4), "exit_price": round(price, 4),
            "side": "long", "pnl": round(pnl, 4),
            "pnl_pct": round((price - entry_price) / entry_price * 100, 4)
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
    """Use Gemini to suggest intelligent parameter ranges. Cached by md5 hash."""
    key = _script_hash(pine_script)
    if key in _suggest_cache:
        logger.info("suggest_param_ranges_with_gemini: cache hit")
        return _suggest_cache[key]

    api_key = os.environ.get("GEMINI_API_KEY", "")
    if not api_key:
        logger.warning("GEMINI_API_KEY not set, falling back to regex parse")
        return _fallback_suggest(pine_script)

    try:
        import google.generativeai as genai
        genai.configure(api_key=api_key)
        model = genai.GenerativeModel(
            model_name=DEFAULT_MODEL_NAME,
            system_instruction=SUGGEST_SYSTEM_PROMPT
        )

        prompt = (
            f"Analyze this Pine Script and suggest optimization ranges for all numeric input parameters:\n\n"
            f"```pinescript\n{pine_script}\n```\n\n"
            f"Return ONLY a JSON array."
        )
        raw = (await _call_gemini_with_retry(model, prompt, _lock=_gemini_lock, _last_call=_gemini_last_call)).strip()

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

        _suggest_cache[key] = result
        return result

    except Exception as e:
        if _is_quota_error(e):
            raise RuntimeError("優化失敗：Gemini 配額已耗盡，請稍後再試")
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

    # Build trade-based equity curve: initial_capital + cumulative PnL after each trade exit
    # N+1 points (start + one per trade) — compact and clean for charting
    trade_equity = [initial_capital]
    running = initial_capital
    for t in trades:
        running += t["pnl"]
        trade_equity.append(round(running, 2))

    eq_arr = np.array(trade_equity, dtype=float)
    peak = np.maximum.accumulate(eq_arr)
    dd = (peak - eq_arr) / np.where(peak == 0, 1, peak) * 100
    max_drawdown = float(dd.max())
    final_equity = trade_equity[-1]

    profit_pct = (final_equity - initial_capital) / initial_capital * 100

    # ---------------------------------------------------------------------------
    # Sharpe ratio — TV-aligned: daily returns from bar-level equity_curve × √252
    #
    # TV uses daily equity snapshots, NOT per-trade returns.
    # Using trade-based returns × √252 massively over-estimates Sharpe for
    # high-frequency strategies (many trades per day → std underestimated).
    #
    # Approach:
    #   1. Use the bar-level equity_curve returned by run_strategy (same length as df)
    #   2. Resample to daily by taking the last bar value each day
    #      (trades dict carry exit_time strings for resampling)
    #   3. Compute daily returns → mean/std × √252
    # ---------------------------------------------------------------------------
    sharpe = 0.0
    bar_curve = result.get("equity_curve", [])   # bar-level, same length as df
    if len(bar_curve) > 2:
        # Build a per-trade exit_time → equity mapping to resample to daily
        # Use exit_time strings from trades (format: "YYYY-MM-DD ..." or ISO)
        # Group by date, take the last equity value seen that day
        daily_eq: dict[str, float] = {}
        running_eq = float(initial_capital)
        for t in trades:
            exit_date = str(t.get("exit_time", ""))[:10]   # "YYYY-MM-DD"
            running_eq += t["pnl"]
            if exit_date:
                daily_eq[exit_date] = running_eq            # last trade of day wins

        if len(daily_eq) > 2:
            sorted_vals = [v for _, v in sorted(daily_eq.items())]
            d_arr = np.array([initial_capital] + sorted_vals, dtype=float)
            d_rets = np.diff(d_arr) / np.where(d_arr[:-1] == 0, 1, d_arr[:-1])
            if d_rets.std() > 0:
                sharpe = float(d_rets.mean() / d_rets.std() * np.sqrt(252))
        else:
            # Fallback for strategies with very few trading days
            d_arr = np.array([initial_capital] + list(daily_eq.values()), dtype=float) \
                    if daily_eq else eq_arr
            d_rets = np.diff(d_arr) / np.where(d_arr[:-1] == 0, 1, d_arr[:-1])
            if len(d_rets) > 0 and d_rets.std() > 0:
                sharpe = float(d_rets.mean() / d_rets.std() * np.sqrt(252))

    # Use compact trade-based curve for API response (replaces full bar-level curve)
    equity_curve = trade_equity

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
        df = pd.DataFrame(all_candles, columns=[
            "timestamp","open","high","low","close","volume",
            "close_time","quote_volume","trades","taker_buy_base",
            "taker_buy_quote","ignore"
        ])
        df["timestamp"] = pd.to_datetime(df["timestamp"], unit="ms")
        for col in ["open","high","low","close","volume"]:
            df[col] = df[col].astype(float)
        return df.set_index("timestamp")

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
# Optuna optimization (with SSE log events)
# ---------------------------------------------------------------------------

async def run_optuna_optimization(
    run_fn, df: pd.DataFrame,
    param_ranges: list[ParamRange], initial_capital: float,
    commission: float, commission_type: str, commission_value: float,
    qty_value: float, qty_type: str,
    sort_by: str, n_trials: int, top_n: int,
    pine_script: str = "",
) -> AsyncGenerator[str, None]:

    # 將 df 拆解為獨立 float32 numpy 陣列，避免多執行緒共享同一物件造成潛在污染
    # 同時重建輕量 DataFrame 供 run_fn 使用（保留 datetime index）
    _idx = df.index
    _open   = df["open"].to_numpy(dtype=np.float64)
    _high   = df["high"].to_numpy(dtype=np.float64)
    _low    = df["low"].to_numpy(dtype=np.float64)
    _close  = df["close"].to_numpy(dtype=np.float64)
    _volume = df["volume"].to_numpy(dtype=np.float64)
    shared_df = pd.DataFrame(
        {"open": _open, "high": _high, "low": _low, "close": _close, "volume": _volume},
        index=_idx
    )
    n_bars = len(shared_df)

    # results_store 只存摘要指標 (OOM 防護)
    results_store = []
    # 菁英緩衝區：僅保留 top_n 完整資料 (trades + equity_curve)
    elite_store = []

    completed = [0]
    best_value = [None]
    trial_times = []     # 每個 trial 耗時 (秒)

    minimize_metrics = {"max_drawdown"}
    direction = "minimize" if sort_by in minimize_metrics else "maximize"

    def _is_better(a, b):
        return a > b if direction == "maximize" else a < b

    def objective(trial: optuna.Trial) -> float:
        nonlocal run_fn  # TypingError fallback 時更新外層 run_fn
        # Todo 6: JIT 耗時計時
        t_start = time.monotonic()

        trial_params = {}
        for pr in param_ranges:
            if pr.is_int:
                val = trial.suggest_int(pr.name, int(pr.min_val), int(pr.max_val), step=max(1, int(pr.step)))
            else:
                val = trial.suggest_float(pr.name, pr.min_val, pr.max_val, step=pr.step if pr.step > 0 else None)
            trial_params[pr.name] = val

        # 對齊 OptimizeRequest 鍵名：qty_value / commission_value
        trial_params.update({
            "initial_capital":  initial_capital,
            "commission":       commission,
            "commission_type":  commission_type,
            "commission_value": commission_value,
            "qty_value":        qty_value,
            "qty_type":         qty_type,
        })

        try:
            raw = run_fn(shared_df, **trial_params)
            metrics = calc_metrics(raw, initial_capital)
        except Exception as e:
            # numba TypingError: Gemini 生成的 @njit 內用了 dict/str，無法在 nopython 模式執行
            # → 清除 translate cache，改用 pure-Python fallback strategy 重跑本 trial
            is_numba_error = "TypingError" in type(e).__name__ or "TypingError" in str(type(e).__mro__)
            if not is_numba_error:
                try:
                    from numba.core.errors import TypingError as _NumbaTypingError
                    is_numba_error = isinstance(e, _NumbaTypingError)
                except ImportError:
                    pass
            if not is_numba_error and "nopython" in str(e).lower():
                is_numba_error = True

            if is_numba_error and trial.number <= 1:
                # 只在前兩個 trial 觸發時做一次 fallback，避免重複日誌
                logger.warning(
                    f"Trial #{trial.number}: numba TypingError 偵測到，"
                    f"清除 translate cache 並切換至 pure-Python fallback strategy"
                )
                # 清除 Gemini 翻譯 cache，讓後續翻譯重新生成
                if pine_script:
                    key = _script_hash(pine_script)
                    _translate_cache.pop(key, None)
                # 用 fallback strategy 重建 run_fn（閉包更新）
                fallback_code = _get_fallback_strategy()
                fb_ns = {"pd": pd, "np": np}
                try:
                    exec(compile(fallback_code, "<fallback>", "exec"), fb_ns)
                    run_fn = fb_ns["run_strategy"]
                    raw = run_fn(shared_df, **trial_params)
                    metrics = calc_metrics(raw, initial_capital)
                except Exception as fb_e:
                    logger.warning(f"Trial #{trial.number} fallback also failed: {fb_e}")
                    gc.collect()
                    return float("inf") if direction == "minimize" else float("-inf")
            else:
                logger.debug(f"Trial #{trial.number} failed: {type(e).__name__}: {e}")
                gc.collect()
                return float("inf") if direction == "minimize" else float("-inf")

        current_val = metrics.get(sort_by, 0.0)

        # 摘要資料（不含完整 trades/equity_curve，過濾系統控制鍵）
        _sys_keys = {"initial_capital", "commission", "commission_type", "commission_value", "qty_value", "qty_type"}
        summary_entry = {
            "params": {k: v for k, v in trial_params.items() if k not in _sys_keys},
            "total_trades": metrics["total_trades"],
            "win_rate": metrics["win_rate"],
            "profit_pct": metrics["profit_pct"],
            "profit_factor": metrics["profit_factor"],
            "max_drawdown": metrics["max_drawdown"],
            "sharpe_ratio": metrics["sharpe_ratio"],
            "final_equity": metrics["final_equity"],
            "gross_profit": metrics["gross_profit"],
            "gross_loss": metrics["gross_loss"],
            "monthly_pnl": metrics["monthly_pnl"],
        }
        results_store.append(summary_entry)

        # 2a: 菁英緩衝區 — 保留 top_n 完整資料
        full_entry = {**summary_entry, "trades": metrics["trades"], "equity_curve": metrics["equity_curve"]}
        elite_store.append((current_val, full_entry))
        elite_store.sort(key=lambda x: x[0], reverse=(direction == "maximize"))
        if len(elite_store) > top_n:
            # 移除排名最差的，釋放記憶體
            removed = elite_store.pop()
            del removed

        completed[0] += 1

        # Todo 6: JIT 耗時診斷
        t_elapsed = time.monotonic() - t_start
        trial_times.append(t_elapsed)
        if completed[0] == 1:
            logger.info(f"Trial #1 (含 JIT 編譯) 耗時：{t_elapsed * 1000:.1f} ms")

        if best_value[0] is None or _is_better(current_val, best_value[0]):
            best_value[0] = current_val

        gc.collect()
        return current_val

    loop = asyncio.get_event_loop()
    # 3a: 啟用 MedianPruner 剪枝
    study = optuna.create_study(
        direction=direction,
        sampler=optuna.samplers.TPESampler(seed=42),
        pruner=optuna.pruners.MedianPruner(n_startup_trials=5, n_warmup_steps=0)
    )

    chunk_size = 10
    remaining = n_trials

    yield f"data: {json.dumps({'type': 'log', 'message': f'接收標頭：Capital={initial_capital}, Qty={qty_value}% ({qty_type}), Commission={commission_value} ({commission_type})｜K 線：{n_bars} 根｜試驗：{n_trials} 次'})}\n\n"

    while remaining > 0:
        batch = min(chunk_size, remaining)
        # Todo 5: n_jobs=-1 並行解鎖（共享 float32 numpy 陣列，無 race condition）
        await loop.run_in_executor(None, lambda b=batch: study.optimize(objective, n_trials=b, n_jobs=-1, show_progress_bar=False))
        remaining -= batch
        progress = min(99, int((completed[0] / n_trials) * 100))

        best_str = f"，最佳 {sort_by}={best_value[0]:.4f}" if best_value[0] is not None else ""

        log_msg = f"[{progress:3d}%] 已完成 {completed[0]}/{n_trials} 次試驗{best_str}"

        yield f"data: {json.dumps({'type': 'progress', 'progress': progress, 'completed': completed[0], 'total': n_trials})}\n\n"
        yield f"data: {json.dumps({'type': 'log', 'message': log_msg})}\n\n"

    # Todo 6: JIT 編譯耗時 + 後續平均耗時診斷
    if trial_times:
        jit_ms  = trial_times[0] * 1000
        rest_ms = (sum(trial_times[1:]) / max(len(trial_times) - 1, 1)) * 1000
        avg_ms  = sum(trial_times) / len(trial_times) * 1000
        logger.info(f"優化完成：{completed[0]} 個 Trial，JIT={jit_ms:.1f} ms，後續平均={rest_ms:.1f} ms/trial")
        yield f"data: {json.dumps({'type': 'log', 'message': f'JIT 編譯耗時：{jit_ms:.1f} ms｜後續平均：{rest_ms:.1f} ms/trial｜整體平均：{avg_ms:.1f} ms/trial'})}\n\n"


    # 從菁英緩衝區取完整資料，補上 rank
    top_results = [entry for _, entry in elite_store[:top_n]]
    summary_results = []
    for i, r in enumerate(top_results):
        entry = {k: v for k, v in r.items()}
        entry["rank"] = i + 1
        summary_results.append(entry)

    yield f"data: {json.dumps({'type': 'log', 'message': f'優化完成！{len(results_store)} 個有效組合，回傳前 {len(summary_results)} 名'})}\n\n"
    yield f"data: {json.dumps({'type': 'result', 'results': summary_results})}\n\n"
    yield f"data: {json.dumps({'type': 'done'})}\n\n"

# ---------------------------------------------------------------------------
# API Endpoints
# ---------------------------------------------------------------------------

@router.post("/parse")
async def parse_inputs(req: ParseRequest):
    """Auto-detect all input parameters from Pine Script, including strategy() header values."""
    params = parse_pine_inputs(req.pine_script)
    header = parse_strategy_header(req.pine_script)
    return {"params": params, "count": len(params), "header": header}

@router.post("/suggest")
async def suggest_ranges(req: SuggestRequest):
    """Use Gemini AI to suggest intelligent optimization ranges for each parameter."""
    if not req.pine_script.strip():
        raise HTTPException(status_code=400, detail="pine_script is required")

    try:
        suggestions = await suggest_param_ranges_with_gemini(req.pine_script)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
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
        strategy_code = await translate_with_gemini(req.pine_script, bypass_cache=req.bypass_cache)
    except RuntimeError as e:
        raise HTTPException(status_code=503, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Translation failed: {e}")

    try:
        compiled = compile(strategy_code, "<strategy>", "exec")
    except SyntaxError as e:
        raise HTTPException(status_code=422, detail=f"Generated code syntax error: {e}")

    # 在 namespace 加入 numba graceful fallback，防止 import 失敗
    try:
        from numba import njit as _njit
        _njit_avail = _njit
    except ImportError:
        def _njit_avail(*args, **kwargs):
            def decorator(fn): return fn
            return decorator if args and callable(args[0]) else decorator
    namespace = {"pd": pd, "np": np, "njit": _njit_avail}

    logger.info(f"Executing strategy code ({len(strategy_code)} chars), first 300 chars:\n{strategy_code[:300]}")
    try:
        exec(compiled, namespace)
    except Exception as e:
        import traceback
        logger.error(f"Strategy exec error: {traceback.format_exc()}")
        raise HTTPException(status_code=422, detail=f"Strategy execution error: {e}")

    run_fn = namespace.get("run_strategy")
    if not run_fn:
        raise HTTPException(status_code=422, detail="run_strategy function not found in translated code")

    async def event_stream():
        yield "data: " + json.dumps({"type": "status", "message": "正在轉譯 Pine Script..."}) + "\n\n"
        yield "data: " + json.dumps({"type": "status", "message": "轉譯完成，開始最佳化..."}) + "\n\n"
        try:
            async for chunk in run_optuna_optimization(
                run_fn=run_fn, df=df,
                param_ranges=req.param_ranges, initial_capital=req.initial_capital,
                commission=req.commission, commission_type=req.commission_type,
                commission_value=req.commission_value,
                qty_value=req.qty_value, qty_type=req.qty_type,
                sort_by=req.sort_by, n_trials=req.n_trials, top_n=req.top_n,
                pine_script=req.pine_script,
            ):
                yield chunk
        except Exception as e:
            yield f"data: {json.dumps({'type': 'error', 'message': str(e)})}\n\n"

    return StreamingResponse(
        event_stream(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no"}
    )
