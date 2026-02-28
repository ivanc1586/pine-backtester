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

// ---------------------------------------------------------------------------
// SVG Equity Curve（零依賴，不使用 lightweight-charts）
// ---------------------------------------------------------------------------
function EquityCurve({ data, timestamps }: { data: number[]; timestamps?: number[] }) {
  if (!data || data.length < 2) return <div className="h-40 flex items-center justify-center text-gray-500 text-sm">無資料</div>
  const W = 600, H = 180, PL = 48, PR = 8, PT = 8, PB = 24
  const chartW = W - PL - PR
  const chartH = H - PT - PB
  const minV = Math.min(...data)
  const maxV = Math.max(...data)
  const range = maxV - minV || 1
  const toX = (i: number) => PL + (i / (data.length - 1)) * chartW
  const toY = (v: number) => PT + (1 - (v - minV) / range) * chartH
  const pts = data.map((v, i) => `${toX(i)},${toY(v)}`).join(' ')
  const fillPts = `${PL},${PT + chartH} ${pts} ${PL + chartW},${PT + chartH}`
  const zeroY = toY(0)
  const isPositive = data[data.length - 1] >= data[0]
  const color = isPositive ? '#26a69a' : '#ef5350'
  // Y axis labels (5 ticks)
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const v = minV + (range * i) / 4
    const y = toY(v)
    return { v, y }
  })
  // X axis labels (up to 5 timestamps)
  const xTicks = timestamps && timestamps.length > 0
    ? [0, 0.25, 0.5, 0.75, 1].map(frac => {
        const i = Math.min(Math.floor(frac * (data.length - 1)), data.length - 1)
        const d = new Date(timestamps[i])
        const label = `${d.getMonth() + 1}/${d.getDate()}`
        return { x: toX(i), label }
      })
    : []
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 180 }}>
      <defs>
        <linearGradient id="eq-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {/* Y grid lines + labels */}
      {yTicks.map(({ v, y }, i) => (
        <g key={i}>
          <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#2a2a3a" strokeWidth="0.5" />
          <text x={PL - 4} y={y + 4} textAnchor="end" fontSize="9" fill="#666">
            {v >= 10000 ? `${(v/1000).toFixed(0)}k` : v >= 1000 ? `${(v/1000).toFixed(1)}k` : v.toFixed(0)}
          </text>
        </g>
      ))}
      {/* 0% reference line */}
      {zeroY >= PT && zeroY <= PT + chartH && (
        <line x1={PL} y1={zeroY} x2={W - PR} y2={zeroY} stroke="#555" strokeWidth="1" strokeDasharray="4,3" />
      )}
      {/* Area fill */}
      <polygon points={fillPts} fill="url(#eq-grad)" />
      {/* Line */}
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
      {/* X axis labels */}
      {xTicks.map(({ x, label }, i) => (
        <text key={i} x={x} y={H - 4} textAnchor="middle" fontSize="9" fill="#555">{label}</text>
      ))}
    </svg>
  )
}

function MonthlyBarChart({ data, initialCapital }: { data: Record<string, number>; initialCapital?: number }) {
  const entries = Object.entries(data).sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return <div className="h-24 flex items-center justify-center text-gray-500 text-sm">無月度資料</div>
  const values = entries.map(([, v]) => v)
  const maxAbs = Math.max(...values.map(Math.abs), 1)
  const barW = Math.max(8, Math.min(28, Math.floor(560 / entries.length) - 2))
  const H = 120, midY = 60, maxBarH = 50
  const [tooltip, setTooltip] = React.useState<{ x: number; y: number; text: string } | null>(null)
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${Math.max(560, entries.length * (barW + 2))} ${H + 28}`} className="w-full overflow-visible">
        {/* Zero baseline */}
        <line x1="0" y1={midY} x2="100%" y2={midY} stroke="#444" strokeWidth="1" />
        {entries.map(([month, val], i) => {
          const x = i * (barW + 2) + 1
          const barH = Math.abs(val) / maxAbs * maxBarH
          const y = val >= 0 ? midY - barH : midY
          const color = val >= 0 ? '#26a69a' : '#ef5350'
          const monthLabel = month.slice(5)  // "MM"
          const year = month.slice(0, 4)     // "YYYY"
          const prevEntry = i > 0 ? entries[i - 1] : null
          const showYear = i === 0 || (prevEntry && prevEntry[0].slice(0, 4) !== year)
          const pctVal = initialCapital && initialCapital > 0
            ? (val / initialCapital * 100).toFixed(2) + '%'
            : val.toFixed(2)
          return (
            <g key={month}
              onMouseEnter={() => setTooltip({ x: x + barW / 2, y: val >= 0 ? y - 4 : y + barH + 4, text: `${month}\n${val >= 0 ? '+' : ''}${val.toFixed(2)} (${pctVal})` })}
              onMouseLeave={() => setTooltip(null)}
              style={{ cursor: 'default' }}>
              <rect x={x} y={y} width={barW} height={Math.max(barH, 1)} fill={color} opacity="0.85" rx="1" />
              <text x={x + barW / 2} y={H + 10} textAnchor="middle" fontSize="8" fill="#666">{monthLabel}</text>
              {showYear && (
                <text x={x + barW / 2} y={H + 22} textAnchor="middle" fontSize="8" fill="#888">{year}</text>
              )}
            </g>
          )
        })}
      </svg>
      {tooltip && (
        <div className="absolute z-10 bg-gray-900 border border-gray-600 text-white text-xs px-2 py-1 rounded pointer-events-none whitespace-pre"
          style={{ left: tooltip.x, top: tooltip.y - 32, transform: 'translateX(-50%)' }}>
          {tooltip.text}
        </div>
      )}
    </div>
  )
}

function MetricBadge({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div style={{
      textAlign: 'center', padding: '8px 12px',
      background: highlight ? 'rgba(38,166,154,0.15)' : 'rgba(255,255,255,0.04)',
      borderRadius: 6, border: `1px solid ${highlight ? 'rgba(38,166,154,0.3)' : '#2b2b43'}`,
    }}>
      <div style={{ fontSize: 10, color: '#848e9c', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 700, color: highlight ? '#26a69a' : '#d1d4dc' }}>{value}</div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Style helpers
// ---------------------------------------------------------------------------
const inputStyle: React.CSSProperties = {
  width: '100%', padding: '6px 10px', background: '#131722',
  border: '1px solid #2b2b43', borderRadius: 4, color: '#d1d4dc',
  fontSize: 12, outline: 'none', boxSizing: 'border-box',
}
const selectStyle: React.CSSProperties = { ...inputStyle, cursor: 'pointer' }

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function OptimizePage() {
  const [pineScript,     setPineScript]     = useState('')
  const [isParsing,      setIsParsing]      = useState(false)
  const [isSuggesting,   setIsSuggesting]   = useState(false)
  const [detectedParams, setDetectedParams] = useState<DetectedParam[]>([])
  const [paramRanges,    setParamRanges]    = useState<ParamRange[]>([])
  const [parseError,     setParseError]     = useState('')

  // ── 策略執行設定（從 /parse header 自動填充）──
  const [initialCapital,   setInitialCapital]   = useState(10000)
  const [commissionType,   setCommissionType]   = useState('percent')
  const [commissionValue,  setCommissionValue]  = useState(0.001)
  const [qtyType,          setQtyType]          = useState('percent_of_equity')
  const [qtyValue,         setQtyValue]         = useState(1.0)
  const [bypassCache,      setBypassCache]      = useState(false)

  const [symbol,       setSymbol]      = useState('BTCUSDT')
  const [marketType,   setMarketType]  = useState<'spot' | 'futures'>('spot')
  const [intervalVal,  setIntervalVal] = useState('1h')
  const [startDate,    setStartDate]   = useState('2023-01-01')
  const [endDate,      setEndDate]     = useState(new Date().toISOString().split('T')[0])
  const [sortBy,       setSortBy]      = useState('profit_pct')
  const [nTrials,      setNTrials]     = useState(100)

  const [isRunning,      setIsRunning]      = useState(false)
  const [progress,       setProgress]       = useState(0)
  const [progressText,   setProgressText]   = useState('')
  const [results,        setResults]        = useState<OptimizeResult[]>([])
  const [selectedResult, setSelectedResult] = useState<OptimizeResult | null>(null)
  const [copiedCode,     setCopiedCode]     = useState(false)
  const [showExportModal, setShowExportModal] = useState(false)
  const [errorMsg,       setErrorMsg]       = useState('')
  const [isSaving,       setIsSaving]       = useState(false)