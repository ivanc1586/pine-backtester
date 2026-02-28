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
          <text x={PL - 4} y={y + 4} textAnchor="end" fontSize="9" fill="#666">{v.toFixed(1)}%</text>
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

  // 即時日誌
  const [logs, setLogs] = useState<string[]>([])
  const logEndRef = useRef<HTMLDivElement>(null)

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // 日誌自動捲到底
  useEffect(() => {
    if (logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' })
    }
  }, [logs])

  // ---------------------------------------------------------------------------
  // Auto-parse on Pine Script change (debounce 800ms)
  // ---------------------------------------------------------------------------
  const parsePineScript = useCallback(async (script: string) => {
    if (!script.trim()) {
      setDetectedParams([])
      setParamRanges([])
      setParseError('')
      return
    }
    setIsParsing(true)
    setParseError('')
    try {
      const res = await fetch(`${API_BASE}/api/optimize/parse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pine_script: script }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setDetectedParams(data.params)

      // ── 自動填充 header 數值到策略執行設定 ──
      const hdr: StrategyHeader = data.header ?? {}
      if (hdr.initial_capital  !== undefined) setInitialCapital(hdr.initial_capital)
      if (hdr.commission_type  !== undefined) setCommissionType(hdr.commission_type)
      if (hdr.commission_value !== undefined) setCommissionValue(hdr.commission_value)
      if (hdr.qty_type         !== undefined) setQtyType(hdr.qty_type)
      if (hdr.qty_value        !== undefined) setQtyValue(hdr.qty_value)

      const ranges: ParamRange[] = data.params
        .filter((p: DetectedParam) => p.type === 'int' || p.type === 'float')
        .map((p: DetectedParam) => {
          const defVal = typeof p.default === 'number' ? p.default : 1
          return {
            name: p.name,
            title: p.title,
            enabled: true,
            min_val:     p.min_val ?? Math.max(1, Math.floor(defVal * 0.5)),
            max_val:     p.max_val ?? Math.ceil(defVal * 2),
            step:        p.step   ?? (p.type === 'int' ? 1 : 0.1),
            is_int:      p.type === 'int',
            default_val: defVal,
          }
        })
      setParamRanges(ranges)

      if (data.params.length === 0) {
        setParseError('未偵測到 input 參數，請確認 Pine Script 包含 input.int / input.float 宣告')
      }
    } catch (err: any) {
      setParseError(`解析失敗：${err.message}`)
    } finally {
      setIsParsing(false)
    }
  }, [])

  const handleScriptChange = (value: string) => {
    setPineScript(value)
    setDetectedParams([])
    setParamRanges([])
    setParseError('')
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (value.trim()) {
      debounceRef.current = setTimeout(() => parsePineScript(value), 800)
    }
  }

  // 清除 Pine Script
  const clearScript = () => {
    if (debounceRef.current) clearTimeout(debounceRef.current)
    setPineScript('')
    setDetectedParams([])
    setParamRanges([])
    setParseError('')
  }

  useEffect(() => () => { if (debounceRef.current) clearTimeout(debounceRef.current) }, [])

  // ---------------------------------------------------------------------------
  // AI 建議參數範圍 — 呼叫 Gemini /suggest
  // ---------------------------------------------------------------------------
  const suggestParamRanges = async () => {
    if (!pineScript.trim()) { setParseError('請先貼入 Pine Script 代碼'); return }
    setIsSuggesting(true)
    setParseError('')
    try {
      const res = await fetch(`${API_BASE}/api/optimize/suggest`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pine_script: pineScript }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setParamRanges(prev => prev.map(p => {
        const suggestion = (data.ranges ?? data.suggestions)?.find((r: any) => r.name === p.name)
        if (!suggestion) return p
        return {
          ...p,
          min_val: suggestion.min_val ?? p.min_val,
          max_val: suggestion.max_val ?? p.max_val,
          step:    suggestion.step    ?? p.step,
          enabled: true,
        }
      }))
    } catch (err: any) {
      setParseError(`AI 建議失敗：${err.message}`)
    } finally {
      setIsSuggesting(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Update param range
  // ---------------------------------------------------------------------------
  const updateRange = (name: string, field: keyof ParamRange, value: any) => {
    setParamRanges(prev => prev.map(p => p.name === name ? { ...p, [field]: value } : p))
  }

  // ---------------------------------------------------------------------------
  // Run optimization
  // ---------------------------------------------------------------------------
  const runOptimization = async () => {
    if (!pineScript.trim()) { setErrorMsg('請先貼入 Pine Script 代碼'); return }
    const enabledRanges = paramRanges.filter(p => p.enabled)
    if (enabledRanges.length === 0) { setErrorMsg('請至少勾選一個參數進行優化'); return }

    setIsRunning(true); setProgress(0); setProgressText('正在初始化...')
    setResults([]); setSelectedResult(null); setErrorMsg('')
    setLogs(['▶ 開始策略優化...'])

    try {
      const res = await fetch(`${API_BASE}/api/optimize/run`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pine_script:      pineScript,
          symbol,
          market_type:      marketType,
          interval:         intervalVal,
          start_date:       startDate,
          end_date:         endDate,
          // ── 策略執行設定 ──
          initial_capital:  initialCapital,
          commission_type:  commissionType,
          commission_value: commissionValue,
          qty_value:        qtyValue,
          qty_type:         qtyType,
          bypass_cache:     bypassCache,
          // ── 優化設定 ──
          param_ranges: enabledRanges.map(p => ({
            name: p.name, min_val: p.min_val, max_val: p.max_val,
            step: p.step, is_int: p.is_int,
          })),
          sort_by: sortBy, n_trials: nTrials, top_n: 10,
        }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || '優化請求失敗') }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('無法讀取串流回應')
      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (!payload) continue
          try {
            const data = JSON.parse(payload)
            if (data.type === 'progress') {
              setProgress(data.progress)
              setProgressText(`已完成 ${data.completed} / ${data.total} 次試驗`)
            } else if (data.type === 'log') {
              setLogs(prev => [...prev, data.message])
            } else if (data.type === 'result') {
              setResults(data.results); setProgress(100)
              setProgressText(`優化完成！共 ${data.results.length} 個最佳組合`)
              setLogs(prev => [...prev, `✅ 優化完成，回傳 ${data.results.length} 個最佳組合`])
            } else if (data.type === 'error') {
              throw new Error(data.message)
            }
          } catch (_) {}
        }
      }
    } catch (err: any) {
      setErrorMsg(`優化失敗：${err.message}`)
      setLogs(prev => [...prev, `❌ 錯誤：${err.message}`])
    } finally {
      setIsRunning(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Copy optimized code
  // ---------------------------------------------------------------------------
  const getOptimizedCode = useCallback(() => {
    if (!selectedResult) return ''
    let code = pineScript
    Object.entries(selectedResult.params).forEach(([name, val]) => {
      const pattern = new RegExp(`(${name}\\s*=\\s*input\\.(int|float)\\s*\\()[^)]*\\)`, 'g')
      code = code.replace(pattern, (match: string) =>
        match.replace(/defval\s*=\s*[\d.]+/, `defval = ${val}`)
      )
    })
    return code
  }, [selectedResult, pineScript])

  const copyOptimizedCode = useCallback(() => {
    if (!selectedResult) return
    let code = pineScript
    Object.entries(selectedResult.params).forEach(([name, val]) => {
      const pattern = new RegExp(`(${name}\\s*=\\s*input\\.(?:int|float)\\s*\\()[^)]*\\)`, 'g')
      code = code.replace(pattern, (match) =>
        match.replace(/defval\s*=\s*[\d.]+/, `defval = ${val}`)
      )
    })
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2500)
    })
  }, [selectedResult, pineScript])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div style={{ minHeight: '100vh', background: '#131722', color: '#d1d4dc' }}>
      <PageHeader
        title="策略優化"
        subtitle="貼入 Pine Script 自動偵測參數，Optuna 智能搜尋最佳組合"
        icon={<Target size={24} />}
      />

      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px', display: 'flex', flexDirection: 'column', gap: 16 }}>

        {/* ── Pine Script Input ────────────────────────────────────────── */}
        <div style={{ background: '#1e222d', border: '1px solid #2b2b43', borderRadius: 8 }}>
          <div style={{ padding: '12px 16px', borderBottom: '1px solid #2b2b43', display: 'flex', alignItems: 'center', gap: 8 }}>
            <Zap size={15} color="#f0b90b" />
            <span style={{ fontWeight: 700, fontSize: 13 }}>貼入 Pine Script</span>
            {isParsing && (
              <span style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: '#848e9c' }}>
                <RefreshCw size={11} style={{ animation: 'spin 1s linear infinite' }} /> 解析中...
              </span>
            )}
            {!isParsing && detectedParams.length > 0 && (
              <span style={{ fontSize: 11, padding: '2px 8px', borderRadius: 10, background: 'rgba(38,166,154,0.15)', color: '#26a69a', border: '1px solid rgba(38,166,154,0.3)' }}>
                偵測到 {paramRanges.length} 個可優化參數
              </span>
            )}
            {/* 清除按鈕 */}
            {pineScript && (
              <button
                onClick={clearScript}
                title="清除 Pine Script"
                style={{
                  marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4,
                  padding: '4px 10px', borderRadius: 4, border: '1px solid rgba(239,83,80,0.35)',
                  background: 'rgba(239,83,80,0.1)', color: '#ef5350',
                  fontSize: 11, cursor: 'pointer', fontWeight: 600,
                }}
              >
                <X size={11} /> 清除
              </button>
            )}
          </div>
          <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
            <textarea
              value={pineScript}
              onChange={(e) => handleScriptChange(e.target.value)}
              placeholder={`//@version=5\nstrategy("My Strategy", overlay=true)\nfastLength = input.int(9, title="Fast EMA", minval=2, maxval=50)\nslowLength = input.int(21, title="Slow EMA", minval=5, maxval=100)\n// 貼上完整策略後自動解析參數...`}
              style={{
                width: '100%', height: 180, padding: '10px 12px',
                background: '#131722', border: '1px solid #2b2b43', borderRadius: 6,
                color: '#26a69a', fontFamily: 'monospace', fontSize: 12,
                resize: 'vertical', outline: 'none', boxSizing: 'border-box',
              }}
            />
            {parseError && (
              <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, color: '#ef5350' }}>
                <AlertCircle size={13} /> {parseError}
              </div>
            )}
          </div>
        </div>

        {/* ── 策略執行設定（初始資金 / 手續費 / 開倉）────────────────── */}
        <div style={{ background: '#1e222d', border: '1px solid #2b2b43', borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Settings2 size={14} color="#26a69a" />
            <span style={{ fontWeight: 700, fontSize: 13 }}>策略執行設定</span>
            <span style={{ fontSize: 11, color: '#848e9c' }}>貼入策略後自動從 strategy() 填入</span>
            {/* bypass_cache 勾選框 */}
            <div
              style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer' }}
              onClick={() => setBypassCache(v => !v)}
            >
              <div style={{
                width: 14, height: 14, borderRadius: 3, flexShrink: 0,
                border: `1px solid ${bypassCache ? '#f0b90b' : '#555'}`,
                background: bypassCache ? '#f0b90b' : 'transparent',
                display: 'flex', alignItems: 'center', justifyContent: 'center',
              }}>
                {bypassCache && <span style={{ fontSize: 9, fontWeight: 900, color: '#000', lineHeight: 1 }}>✓</span>}
              </div>
              <span style={{ fontSize: 11, color: '#848e9c' }}>強制重新轉譯</span>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 12, marginBottom: 12 }}>
            {/* 初始資金 */}
            <div>
              <div style={{ fontSize: 10, color: '#848e9c', marginBottom: 4 }}>初始資金 (USDT)</div>
              <input
                type="number" value={initialCapital} min={100} step={100}
                onChange={e => setInitialCapital(Number(e.target.value))}
                style={inputStyle}
              />
            </div>
            {/* 手續費類型 */}
            <div>
              <div style={{ fontSize: 10, color: '#848e9c', marginBottom: 4 }}>手續費類型</div>
              <select value={commissionType} onChange={e => setCommissionType(e.target.value)} style={selectStyle}>
                {COMMISSION_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {/* 手續費數值 */}
            <div>
              <div style={{ fontSize: 10, color: '#848e9c', marginBottom: 4 }}>
                手續費數值 {commissionType === 'percent' ? '(0.001 = 0.1%)' : '(固定金額)'}
              </div>
              <input
                type="number" value={commissionValue} min={0} step={0.0001}
                onChange={e => setCommissionValue(Number(e.target.value))}
                style={inputStyle}
              />
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12 }}>
            {/* 開倉類型 */}
            <div>
              <div style={{ fontSize: 10, color: '#848e9c', marginBottom: 4 }}>開倉類型</div>
              <select value={qtyType} onChange={e => setQtyType(e.target.value)} style={selectStyle}>
                {QTY_TYPES.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            {/* 開倉數值 */}
            <div>
              <div style={{ fontSize: 10, color: '#848e9c', marginBottom: 4 }}>
                開倉數值 {qtyType === 'percent_of_equity' ? '(% of equity)' : qtyType === 'cash' ? '(USDT)' : '(contracts)'}
              </div>
              <input
                type="number" value={qtyValue} min={0.01} step={qtyType === 'percent_of_equity' ? 1 : 0.01}
                onChange={e => setQtyValue(Number(e.target.value))}
                style={inputStyle}
              />
            </div>
          </div>
        </div>

        {/* ── Detected Params + AI Suggest ────────────────────────────── */}
        {paramRanges.length > 0 && (
          <div style={{ background: '#1e222d', border: '1px solid #2b2b43', borderRadius: 8, padding: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
              <Settings2 size={14} color="#f0b90b" />
              <span style={{ fontWeight: 700, fontSize: 13 }}>參數優化設定</span>
              <span style={{ fontSize: 11, color: '#848e9c' }}>勾選要優化的參數並設定範圍</span>
              <button
                onClick={suggestParamRanges}
                disabled={isSuggesting}
                style={{
                  marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 6,
                  padding: '5px 12px', borderRadius: 4, border: '1px solid rgba(240,185,11,0.4)',
                  background: 'rgba(240,185,11,0.1)', color: '#f0b90b',
                  fontSize: 12, cursor: isSuggesting ? 'not-allowed' : 'pointer', fontWeight: 600,
                  opacity: isSuggesting ? 0.6 : 1,
                }}
              >
                {isSuggesting
                  ? <><RefreshCw size={12} style={{ animation: 'spin 1s linear infinite' }} /> 分析中...</>
                  : <><Sparkles size={12} /> AI 建議參數範圍</>
                }
              </button>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {paramRanges.map((p) => (
                <div key={p.name} style={{
                  padding: '10px 14px', borderRadius: 6,
                  background: p.enabled ? 'rgba(240,185,11,0.06)' : 'rgba(255,255,255,0.02)',
                  border: `1px solid ${p.enabled ? 'rgba(240,185,11,0.25)' : '#2b2b43'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <div
                      onClick={() => updateRange(p.name, 'enabled', !p.enabled)}
                      style={{
                        width: 14, height: 14, borderRadius: 3, cursor: 'pointer', flexShrink: 0,
                        border: `1px solid ${p.enabled ? '#f0b90b' : '#555'}`,
                        background: p.enabled ? '#f0b90b' : 'transparent',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                      }}
                    >
                      {p.enabled && <span style={{ fontSize: 9, fontWeight: 900, color: '#000', lineHeight: 1 }}>✓</span>}
                    </div>
                    <span style={{ fontSize: 13, color: '#d1d4dc', fontWeight: 600 }}>{p.title}</span>
                    <span style={{ fontSize: 11, color: '#848e9c' }}>({p.name})</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#848e9c' }}>預設: {p.default_val}</span>
                  </div>

                  {p.enabled && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 10, marginTop: 10 }}>
                      {[
                        { label: '最小值', field: 'min_val' as keyof ParamRange },
                        { label: '最大值', field: 'max_val' as keyof ParamRange },
                        { label: '步長',   field: 'step'    as keyof ParamRange },
                      ].map(({ label, field }) => (
                        <div key={field}>
                          <div style={{ fontSize: 10, color: '#848e9c', marginBottom: 4 }}>{label}</div>
                          <input
                            type="number"
                            value={p[field] as number}
                            step={p.is_int ? 1 : 0.01}
                            min={field === 'step' ? (p.is_int ? 1 : 0.01) : undefined}
                            onChange={(e) => updateRange(p.name, field, parseFloat(e.target.value))}
                            style={inputStyle}
                          />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Market & Optimize Settings ───────────────────────────────── */}
        <div style={{ background: '#1e222d', border: '1px solid #2b2b43', borderRadius: 8, padding: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 14 }}>
            <Settings2 size={14} color="#f0b90b" />
            <span style={{ fontWeight: 700, fontSize: 13 }}>市場與優化設定</span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 12, marginBottom: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: '#848e9c', marginBottom: 4 }}>交易對（幣安）</div>
              <select value={symbol} onChange={(e) => setSymbol(e.target.value)} style={selectStyle}>
                {POPULAR_SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#848e9c', marginBottom: 4 }}>時間框架</div>
              <select value={intervalVal} onChange={(e) => setIntervalVal(e.target.value)} style={selectStyle}>
                {INTERVALS.map(i => <option key={i} value={i}>{i}</option>)}
              </select>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 12 }}>
            <div>
              <div style={{ fontSize: 10, color: '#848e9c', marginBottom: 4 }}>開始日期</div>
              <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#848e9c', marginBottom: 4 }}>結束日期</div>
              <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inputStyle} />
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#848e9c', marginBottom: 4 }}>優化目標</div>
              <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={selectStyle}>
                {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
              </select>
            </div>
            <div>
              <div style={{ fontSize: 10, color: '#848e9c', marginBottom: 4 }}>試驗次數</div>
              <input type="number" value={nTrials} min={10} max={2000} step={10}
                onChange={(e) => setNTrials(Number(e.target.value))} style={inputStyle} />
            </div>
          </div>
        </div>

        {/* ── Error ───────────────────────────────────────────────────── */}
        {errorMsg && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '10px 14px', background: 'rgba(239,83,80,0.1)', border: '1px solid rgba(239,83,80,0.3)', borderRadius: 6, fontSize: 12, color: '#ef5350' }}>
            <AlertCircle size={13} /> {errorMsg}
          </div>
        )}

        {/* ── Run Button ──────────────────────────────────────────────── */}
        <button
          onClick={runOptimization}
          disabled={isRunning}
          style={{
            width: '100%', padding: '14px 0', borderRadius: 6, border: 'none', cursor: isRunning ? 'not-allowed' : 'pointer',
            background: isRunning ? '#2b2b43' : '#f0b90b', color: isRunning ? '#848e9c' : '#000',
            fontWeight: 700, fontSize: 15, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8,
          }}
        >
          {isRunning
            ? <><RefreshCw size={16} style={{ animation: 'spin 1s linear infinite' }} /> 優化中... {progress}%</>
            : <><Play size={16} /> 開始策略優化</>
          }
        </button>

        {/* ── Progress Bar ─────────────────────────────────────────────── */}
        {isRunning && (
          <div>
            <div style={{ width: '100%', height: 4, background: '#2b2b43', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', width: `${progress}%`, background: '#f0b90b', borderRadius: 2, transition: 'width 0.3s ease' }} />
            </div>
            <div style={{ fontSize: 11, color: '#848e9c', marginTop: 6, textAlign: 'center' }}>{progressText}</div>
          </div>
        )}

        {/* ── 即時日誌窗格 ─────────────────────────────────────────────── */}
        {logs.length > 0 && (
          <div style={{ background: '#0d1017', border: '1px solid #2b2b43', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{
              padding: '8px 14px', borderBottom: '1px solid #2b2b43',
              display: 'flex', alignItems: 'center', gap: 8,
            }}>
              <Terminal size={13} color="#848e9c" />
              <span style={{ fontSize: 12, color: '#848e9c', fontWeight: 600 }}>優化日誌</span>
              <button
                onClick={() => setLogs([])}
                style={{
                  marginLeft: 'auto', fontSize: 10, color: '#555', background: 'none',
                  border: 'none', cursor: 'pointer', padding: '2px 6px',
                }}
              >
                清除
              </button>
            </div>
            <div style={{
              height: 180, overflowY: 'auto', padding: '10px 14px',
              fontFamily: 'monospace', fontSize: 11, lineHeight: 1.7,
              display: 'flex', flexDirection: 'column', gap: 1,
            }}>
              {logs.map((log, i) => (
                <div key={i} style={{
                  color: log.startsWith('❌') ? '#ef5350'
                       : log.startsWith('✅') ? '#26a69a'
                       : log.startsWith('▶')  ? '#f0b90b'
                       : '#848e9c',
                }}>
                  {log}
                </div>
              ))}
              <div ref={logEndRef} />
            </div>
          </div>
        )}

        {/* ── Results Table ────────────────────────────────────────────── */}
        {results.length > 0 && (
          <div style={{ background: '#1e222d', border: '1px solid #2b2b43', borderRadius: 8, overflow: 'hidden' }}>
            <div style={{ padding: '12px 16px', borderBottom: '1px solid #2b2b43', display: 'flex', alignItems: 'center', gap: 8 }}>
              <BarChart2 size={14} color="#f0b90b" />
              <span style={{ fontWeight: 700, fontSize: 13 }}>優化結果排行</span>
              <span style={{ fontSize: 11, color: '#848e9c' }}>點選查看詳細分析</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2b2b43' }}>
                    {['排名','參數','總盈利%','MDD%','盈虧比','勝率%','交易數','夏普'].map(h => (
                      <th key={h} style={{ padding: '8px 12px', textAlign: h === '排名' || h === '參數' ? 'left' : 'right', color: '#848e9c', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const isSelected = selectedResult?.rank === r.rank
                    return (
                      <tr
                        key={r.rank}
                        onClick={() => setSelectedResult(r)}
                        style={{
                          borderBottom: '1px solid #1e2328', cursor: 'pointer',
                          background: isSelected ? 'rgba(240,185,11,0.08)' : 'transparent',
                        }}
                        onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)' }}
                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = isSelected ? 'rgba(240,185,11,0.08)' : 'transparent' }}
                      >
                        <td style={{ padding: '8px 12px' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 22, height: 22, borderRadius: '50%', fontSize: 11, fontWeight: 700,
                            background: r.rank === 1 ? '#f0b90b' : r.rank === 2 ? '#848e9c' : r.rank === 3 ? '#cd7f32' : '#2b2b43',
                            color: r.rank <= 3 ? '#000' : '#d1d4dc',
                          }}>{r.rank}</span>
                        </td>
                        <td style={{ padding: '8px 12px' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {Object.entries(r.params).filter(([k]) => !k.startsWith('_')).map(([k, v]) => (
                              <span key={k} style={{ fontSize: 10, padding: '2px 6px', background: '#2b2b43', borderRadius: 3, color: '#d1d4dc' }}>
                                {k}: {typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(3)) : v}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 700, color: r.profit_pct >= 0 ? '#26a69a' : '#ef5350' }}>
                          {r.profit_pct >= 0 ? '+' : ''}{r.profit_pct.toFixed(2)}%
                        </td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#ef5350' }}>{r.max_drawdown.toFixed(2)}%</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#d1d4dc' }}>{r.profit_factor.toFixed(2)}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#d1d4dc' }}>{r.win_rate.toFixed(1)}%</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#848e9c' }}>{r.total_trades}</td>
                        <td style={{ padding: '8px 12px', textAlign: 'right', color: '#848e9c' }}>{r.sharpe_ratio.toFixed(2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Selected Result Detail ───────────────────────────────────── */}
        {selectedResult && (
          <div style={{ background: '#1e222d', border: '1px solid #2b2b43', borderRadius: 8, padding: 16, display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <TrendingUp size={14} color="#f0b90b" />
                <span style={{ fontWeight: 700, fontSize: 13 }}>第 {selectedResult.rank} 名詳細分析</span>
              </div>
              <button
                onClick={() => setShowExportModal(true)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 6, padding: '6px 12px',
                  background: copiedCode ? 'rgba(38,166,154,0.15)' : 'rgba(240,185,11,0.1)',
                  border: `1px solid ${copiedCode ? 'rgba(38,166,154,0.3)' : 'rgba(240,185,11,0.3)'}`,
                  borderRadius: 4, color: copiedCode ? '#26a69a' : '#f0b90b',
                  fontSize: 12, cursor: 'pointer', fontWeight: 600,
                }}
              >
                {copiedCode ? <Check size={13} /> : <Copy size={13} />}
                {copiedCode ? '已複製！' : '複製優化代碼'}
              </button>
            </div>

            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8 }}>
              <MetricBadge label="總盈利" value={`${selectedResult.profit_pct >= 0 ? '+' : ''}${selectedResult.profit_pct.toFixed(2)}%`} highlight={selectedResult.profit_pct > 0} />
              <MetricBadge label="MDD" value={`${selectedResult.max_drawdown.toFixed(2)}%`} />
              <MetricBadge label="盈虧比" value={selectedResult.profit_factor.toFixed(2)} highlight={selectedResult.profit_factor > 1.5} />
              <MetricBadge label="勝率" value={`${selectedResult.win_rate.toFixed(1)}%`} highlight={selectedResult.win_rate > 50} />
              <MetricBadge label="交易數" value={String(selectedResult.total_trades)} />
              <MetricBadge label="夏普" value={selectedResult.sharpe_ratio.toFixed(2)} highlight={selectedResult.sharpe_ratio > 1} />
              <MetricBadge label="最終資產" value={`$${selectedResult.final_equity.toFixed(0)}`} />
              <MetricBadge label="毛利/毛損" value={`${selectedResult.gross_profit.toFixed(0)} / ${selectedResult.gross_loss.toFixed(0)}`} />
            </div>

            <div>
              <div style={{ fontSize: 11, color: '#848e9c', marginBottom: 8, fontWeight: 600 }}>資產曲線</div>
              <div style={{ background: '#131722', borderRadius: 6, border: '1px solid #2b2b43', overflow: 'hidden' }}>
                <EquityCurve data={selectedResult.equity_curve} />
              </div>
            </div>

            <MonthlyBarChart data={selectedResult.monthly_pnl} />

            <div>
              <div style={{ fontSize: 11, color: '#848e9c', marginBottom: 8, fontWeight: 600 }}>最佳參數值</div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                {Object.entries(selectedResult.params)
                  .filter(([k]) => !k.startsWith('_'))
                  .map(([k, v]) => (
                    <div key={k} style={{ padding: '6px 12px', background: 'rgba(240,185,11,0.1)', border: '1px solid rgba(240,185,11,0.25)', borderRadius: 4 }}>
                      <span style={{ fontSize: 11, color: '#848e9c' }}>{k}: </span>
                      <span style={{ fontSize: 13, fontWeight: 700, color: '#f0b90b' }}>
                        {typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(4)) : String(v)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>

      <style>{`
        @keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
      `}</style>
    </div>
  )
}
