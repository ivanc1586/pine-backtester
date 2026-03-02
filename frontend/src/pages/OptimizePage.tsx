// =============================================================================
// OptimizePage v2.7.0
// -----------------------------------------------------------------------------
// v2.8.0 - 2026-02-28
//   - 新增「策略執行設定」區塊：初始資金、手續費類型/數值、開倉類型/數值 五個輸入框
//   - /parse 回傳 header 後自動填充上述五個欄位
//   - runOptimization body 補齊 initial_capital / commission_type / commission_value
//     / qty_value / qty_type / bypass_cache 欄位，完整對齊後端 OptimizeRequest
// v2.6.0 - 2026-02-27
//   - 新增即時日誌窗格（消費 SSE type:'log' 事件，顯示優化進度訊息）
//   - 新增清除 Pine Script 按鈕（一鍵清空輸入區）
//   - 後端 Binance 451 修正（api.binance.vision）
// =============================================================================

import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  Play, Sparkles, Settings2, Copy, Check,
  TrendingUp, BarChart2, Zap, AlertCircle, RefreshCw, Target, X, Terminal
} from 'lucide-react'
import PageHeader from '../components/PageHeader'

// ---------------------------------------------------------------------------
// API base URL — 從環境變數取得，production 打後端，dev 走 vite proxy
// ---------------------------------------------------------------------------
const API_BASE = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface DetectedParam {
  name: string
  title: string
  type: 'int' | 'float' | 'bool' | 'string'
  default: number | boolean | string
  min_val?: number
  max_val?: number
  step?: number
}

interface ParamRange {
  name: string
  title: string   // Human-readable label e.g. "Fast MA Period"
  enabled: boolean
  min_val: number
  max_val: number
  step: number
  is_int: boolean
  default_val: number
}

interface StrategyHeader {
  initial_capital?: number
  commission_type?: string
  commission_value?: number
  qty_type?: string
  qty_value?: number
}

interface OptimizeResult {
  rank: number
  params: Record<string, number>
  symbol?: string
  market_type?: string
  interval?: string
  start_date?: string
  end_date?: string
  total_trades: number
  win_rate: number
  profit_pct: number
  profit_factor: number
  max_drawdown: number
  sharpe_ratio: number
  final_equity: number
  gross_profit: number
  gross_loss: number
  monthly_pnl: Record<string, number>
  equity_curve: number[]
  trades?: TradeRecord[]
}

interface TradeRecord {
  entry_time?: string
  exit_time?: string
  side?: string
  pnl?: number
  entry_price?: number
  exit_price?: number
}

interface SavedReport extends OptimizeResult {
  strategy_name?: string
  saved_at?: string
}

interface Candle {
  t: number
  o: number
  h: number
  l: number
  c: number
  v: number
}

const SORT_OPTIONS = [
  { value: 'profit_pct',    label: '最大盈利 %' },
  { value: 'win_rate',      label: '最高勝率' },
  { value: 'profit_factor', label: '最高盈虧比' },
  { value: 'max_drawdown',  label: '最低 MDD' },
  { value: 'sharpe_ratio',  label: '最高夏普比率' },
  { value: 'total_trades',  label: '最多交易筆數' },
]

const COMMISSION_TYPES = [
  { value: 'percent',           label: '百分比 (%)' },
  { value: 'cash_per_contract', label: '每口固定金額' },
  { value: 'cash_per_order',    label: '每單固定金額' },
]

const QTY_TYPES = [
  { value: 'percent_of_equity', label: '資金百分比 (%)' },
  { value: 'cash',              label: '固定金額' },
  { value: 'fixed',             label: '固定數量' },
]

const INTERVALS       = ['1m','5m','15m','30m','1h','4h','1d','1w']
const POPULAR_SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','MATICUSDT',
]