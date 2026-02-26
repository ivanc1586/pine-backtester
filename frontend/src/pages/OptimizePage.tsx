// =============================================================================
// 修改歷程記錄
// -----------------------------------------------------------------------------
// v2.0.0 - 2026-02-26 - 策略優化頁面（全新重寫）
// v2.1.0 - 2026-02-26 - 移除 lightweight-charts，改用 Canvas 繪製資產曲線
// v2.2.0 - 2026-02-26 - 移除初始資金/手續費/倉位欄位（改由 Pine Script 自動解析）
//                     - 風格對齊 ChartPage 深色 inline style
// v2.3.0 - 2026-02-26 - 還原 21:33 版本（深色 inline style，無外部圖表庫）
// =============================================================================

import { useState, useRef, useCallback, useEffect } from 'react'
import {
  Play, Sparkles, ChevronDown, ChevronUp, Settings2,
  Copy, Check, TrendingUp, BarChart2,
  Zap, AlertCircle, RefreshCw, Target
} from 'lucide-react'
import PageHeader from '../components/PageHeader'

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
  title: string
  enabled: boolean
  min_val: number
  max_val: number
  step: number
  is_int: boolean
  default_val: number
}

interface OptimizeResult {
  rank: number
  params: Record<string, number>
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
  trades: Trade[]
  equity_curve: number[]
}

interface Trade {
  entry_time: string
  exit_time: string
  entry_price: number
  exit_price: number
  side: 'long' | 'short'
  pnl: number
  pnl_pct: number
}

const SORT_OPTIONS = [
  { value: 'profit_pct', label: '最大盈利 %' },
  { value: 'win_rate', label: '最高勝率' },
  { value: 'profit_factor', label: '最高盈虧比' },
  { value: 'max_drawdown', label: '最低 MDD' },
  { value: 'sharpe_ratio', label: '最高夏普比率' },
  { value: 'total_trades', label: '最多交易筆數' },
]

const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']
const SOURCES = ['binance', 'coingecko', 'coincap']
const POPULAR_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT'
]

// ---------------------------------------------------------------------------
// Styles
// ---------------------------------------------------------------------------

const S = {
  page: { minHeight: '100vh', background: '#131722', padding: '24px' } as React.CSSProperties,
  inner: { maxWidth: '1200px', margin: '0 auto', marginTop: '24px', display: 'flex', flexDirection: 'column' as const, gap: '16px' },
  card: { background: '#1e222d', border: '1px solid #2b2b43', borderRadius: '12px', overflow: 'hidden' } as React.CSSProperties,
  cardBody: { padding: '20px' } as React.CSSProperties,
  cardHeader: { width: '100%', padding: '16px 20px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', background: 'none', border: 'none', cursor: 'pointer', color: '#d1d4dc' } as React.CSSProperties,
  label: { display: 'block', fontSize: '11px', fontWeight: 600, color: '#848e9c', marginBottom: '6px', textTransform: 'uppercase' as const, letterSpacing: '0.5px' },
  input: { width: '100%', padding: '8px 12px', background: '#131722', border: '1px solid #2b2b43', borderRadius: '6px', color: '#d1d4dc', fontSize: '13px', boxSizing: 'border-box' as const, outline: 'none' } as React.CSSProperties,
  select: { width: '100%', padding: '8px 12px', background: '#131722', border: '1px solid #2b2b43', borderRadius: '6px', color: '#d1d4dc', fontSize: '13px', boxSizing: 'border-box' as const, outline: 'none' } as React.CSSProperties,
  grid2: { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '12px' } as React.CSSProperties,
  grid3: { display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: '12px' } as React.CSSProperties,
  sectionTitle: { fontSize: '13px', fontWeight: 600, color: '#d1d4dc', display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '16px' } as React.CSSProperties,
  badge: { fontSize: '11px', padding: '2px 8px', borderRadius: '99px', background: 'rgba(38,166,154,0.15)', color: '#26a69a' } as React.CSSProperties,
  errorBox: { display: 'flex', alignItems: 'center', gap: '8px', padding: '12px 16px', background: 'rgba(239,83,80,0.1)', border: '1px solid rgba(239,83,80,0.3)', borderRadius: '8px', color: '#ef5350', fontSize: '13px' } as React.CSSProperties,
  btnPrimary: { width: '100%', padding: '14px', background: '#2962ff', border: 'none', borderRadius: '8px', color: '#fff', fontSize: '15px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' } as React.CSSProperties,
  btnDisabled: { opacity: 0.5, cursor: 'not-allowed' } as React.CSSProperties,
  btnSecondary: { padding: '7px 14px', background: 'rgba(38,166,154,0.15)', border: '1px solid rgba(38,166,154,0.3)', borderRadius: '6px', color: '#26a69a', fontSize: '12px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' } as React.CSSProperties,
  metricBox: { textAlign: 'center' as const, padding: '10px 8px', background: '#131722', border: '1px solid #2b2b43', borderRadius: '8px' },
  metricLabel: { fontSize: '10px', color: '#848e9c', fontWeight: 600, textTransform: 'uppercase' as const, letterSpacing: '0.3px' },
  metricValue: { fontSize: '14px', fontWeight: 700, color: '#d1d4dc', marginTop: '2px' },
  tableHeader: { padding: '10px 14px', textAlign: 'left' as const, fontSize: '11px', fontWeight: 600, color: '#848e9c', borderBottom: '1px solid #2b2b43', textTransform: 'uppercase' as const },
  tableCell: { padding: '10px 14px', fontSize: '12px', color: '#d1d4dc', borderBottom: '1px solid #1e222d', verticalAlign: 'middle' as const },
  paramCard: (enabled: boolean) => ({ padding: '14px', borderRadius: '8px', border: `1px solid ${enabled ? '#2962ff44' : '#2b2b43'}`, background: enabled ? 'rgba(41,98,255,0.07)' : '#131722' }) as React.CSSProperties,
}

// ---------------------------------------------------------------------------
// Canvas Equity Chart
// ---------------------------------------------------------------------------

function EquityChart({ data }: { data: number[] }) {
  const canvasRef = useRef<HTMLCanvasElement>(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || data.length < 2) return
    const dpr = window.devicePixelRatio || 1
    const W = canvas.offsetWidth
    const H = canvas.offsetHeight
    canvas.width = W * dpr
    canvas.height = H * dpr
    const ctx = canvas.getContext('2d')!
    ctx.scale(dpr, dpr)

    const min = Math.min(...data)
    const max = Math.max(...data)
    const range = max - min || 1
    const padL = 64, padR = 12, padT = 12, padB = 28
    const W2 = W - padL - padR
    const H2 = H - padT - padB

    ctx.clearRect(0, 0, W, H)

    // Grid lines
    ctx.strokeStyle = 'rgba(43,43,67,0.8)'
    ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = padT + (H2 / 4) * i
      ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke()
      const val = max - (range / 4) * i
      ctx.fillStyle = '#848e9c'
      ctx.font = '10px sans-serif'
      ctx.textAlign = 'right'
      ctx.fillText(val >= 1000 ? `$${(val / 1000).toFixed(1)}k` : `$${val.toFixed(0)}`, padL - 4, y + 4)
    }

    // Gradient fill
    const toX = (i: number) => padL + (i / (data.length - 1)) * W2
    const toY = (v: number) => padT + H2 - ((v - min) / range) * H2
    const grad = ctx.createLinearGradient(0, padT, 0, padT + H2)
    grad.addColorStop(0, 'rgba(41,98,255,0.35)')
    grad.addColorStop(1, 'rgba(41,98,255,0.02)')
    ctx.beginPath()
    ctx.moveTo(toX(0), toY(data[0]))
    data.forEach((v, i) => { if (i > 0) ctx.lineTo(toX(i), toY(v)) })
    ctx.lineTo(toX(data.length - 1), padT + H2)
    ctx.lineTo(toX(0), padT + H2)
    ctx.closePath()
    ctx.fillStyle = grad
    ctx.fill()

    // Line
    ctx.beginPath()
    ctx.strokeStyle = '#2962ff'
    ctx.lineWidth = 2
    ctx.lineJoin = 'round'
    ctx.moveTo(toX(0), toY(data[0]))
    data.forEach((v, i) => { if (i > 0) ctx.lineTo(toX(i), toY(v)) })
    ctx.stroke()
  }, [data])

  return (
    <canvas
      ref={canvasRef}
      style={{ width: '100%', height: '200px', display: 'block', borderRadius: '8px', background: '#131722' }}
    />
  )
}

// ---------------------------------------------------------------------------
// Monthly bar chart
// ---------------------------------------------------------------------------

function MonthlyBarChart({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort(([a], [b]) => a.localeCompare(b))
  if (!entries.length) return null
  const vals = entries.map(([, v]) => v)
  const maxAbs = Math.max(...vals.map(Math.abs), 1)
  return (
    <div style={{ marginTop: '16px' }}>
      <div style={{ fontSize: '11px', color: '#848e9c', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px' }}>每月績效</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '72px', overflowX: 'auto', paddingBottom: '4px' }}>
        {entries.map(([month, pnl]) => {
          const pct = (pnl / maxAbs) * 100
          const isPos = pnl >= 0
          return (
            <div key={month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: '28px' }}>
              <div style={{ height: '52px', display: 'flex', alignItems: 'flex-end', justifyContent: 'center', width: '100%' }}>
                <div
                  title={`${month}: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`}
                  style={{
                    width: '20px',
                    height: `${Math.max(3, Math.abs(pct) * 0.52)}px`,
                    background: isPos ? '#26a69a' : '#ef5350',
                    borderRadius: '2px',
                  }}
                />
              </div>
              <div style={{ fontSize: '9px', color: '#848e9c', marginTop: '2px' }}>{month.slice(5)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function OptimizePage() {
  // Pine Script
  const [pineScript, setPineScript] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [detectedParams, setDetectedParams] = useState<DetectedParam[]>([])
  const [paramRanges, setParamRanges] = useState<ParamRange[]>([])
  const [parseError, setParseError] = useState('')

  // Market settings
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setIntervalVal] = useState('1h')
  const [source, setSource] = useState('binance')
  const [startDate, setStartDate] = useState('2023-01-01')
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0])
  const [sortBy, setSortBy] = useState('profit_pct')
  const [nTrials, setNTrials] = useState(100)

  // Optimization state
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState('')
  const [results, setResults] = useState<OptimizeResult[]>([])
  const [selectedResult, setSelectedResult] = useState<OptimizeResult | null>(null)
  const [copiedCode, setCopiedCode] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // UI state
  const [showSettings, setShowSettings] = useState(true)
  const [showScript, setShowScript] = useState(true)

  // ---------------------------------------------------------------------------
  // Parse Pine Script inputs
  // ---------------------------------------------------------------------------

  const parsePineScript = useCallback(async () => {
    if (!pineScript.trim()) { setParseError('請先貼入 Pine Script 代碼'); return }
    setIsParsing(true); setParseError('')
    try {
      const res = await fetch('/api/optimize/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pine_script: pineScript }),
      })
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setDetectedParams(data.params)
      const ranges: ParamRange[] = data.params
        .filter((p: DetectedParam) => p.type === 'int' || p.type === 'float')
        .map((p: DetectedParam) => {
          const defVal = typeof p.default === 'number' ? p.default : 1
          return {
            name: p.name, title: p.title, enabled: true,
            min_val: p.min_val ?? Math.max(1, Math.floor(defVal * 0.5)),
            max_val: p.max_val ?? Math.ceil(defVal * 2),
            step: p.step ?? (p.type === 'int' ? 1 : 0.1),
            is_int: p.type === 'int', default_val: defVal,
          }
        })
      setParamRanges(ranges)
      if (data.params.length === 0) setParseError('未偵測到任何 input 參數')
    } catch (err: any) {
      setParseError(`解析失敗：${err.message}`)
    } finally {
      setIsParsing(false)
    }
  }, [pineScript])

  const updateRange = (name: string, field: keyof ParamRange, value: any) => {
    setParamRanges(prev => prev.map(p => p.name === name ? { ...p, [field]: value } : p))
  }

  // ---------------------------------------------------------------------------
  // Run optimization
  // ---------------------------------------------------------------------------

  const runOptimization = async () => {
    if (!pineScript.trim()) { setErrorMsg('請先貼入 Pine Script 代碼並解析參數'); return }
    const enabledRanges = paramRanges.filter(p => p.enabled)
    if (enabledRanges.length === 0) { setErrorMsg('請至少勾選一個參數進行優化'); return }

    setIsRunning(true); setProgress(0); setProgressText('正在初始化...')
    setResults([]); setSelectedResult(null); setErrorMsg('')

    try {
      const res = await fetch('/api/optimize/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pine_script: pineScript,
          symbol, interval, source,
          start_date: startDate,
          end_date: endDate,
          param_ranges: enabledRanges.map(p => ({
            name: p.name, min_val: p.min_val, max_val: p.max_val,
            step: p.step, is_int: p.is_int,
          })),
          sort_by: sortBy,
          n_trials: nTrials,
          top_n: 10,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || '優化請求失敗')
      }

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
            } else if (data.type === 'result') {
              setResults(data.results); setProgress(100)
              setProgressText(`優化完成！共 ${data.results.length} 個最佳組合`)
            } else if (data.type === 'error') {
              throw new Error(data.message)
            }
          } catch { /* ignore malformed SSE */ }
        }
      }
    } catch (err: any) {
      setErrorMsg(`優化失敗：${err.message}`)
    } finally {
      setIsRunning(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Copy optimized code
  // ---------------------------------------------------------------------------

  const copyOptimizedCode = useCallback(() => {
    if (!selectedResult) return
    let code = pineScript
    Object.entries(selectedResult.params).forEach(([name, val]) => {
      const pattern = new RegExp(`(${name}\\s*=\\s*input\\.(?:int|float)\\s*\\()[^)]*\\)`, 'g')
      code = code.replace(pattern, (match) =>
        match.replace(/defval\s*=\s*[\d.]+|^(\s*\()[\d.]+/, (m) =>
          m.includes('defval') ? `defval = ${val}` : m.replace(/[\d.]+/, String(val))
        )
      )
    })
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(true); setTimeout(() => setCopiedCode(false), 2500)
    })
  }, [selectedResult, pineScript])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div style={S.page}>
      <div style={{ maxWidth: '1200px', margin: '0 auto' }}>
        <PageHeader
          title="策略優化"
          subtitle="AI 自動解析 Pine Script 參數，Optuna 智能搜尋最佳組合"
          icon={<Target style={{ width: '28px', height: '28px' }} />}
        />
      </div>

      <div style={S.inner}>

        {/* -- Pine Script Input -- */}
        <div style={S.card}>
          <button style={S.cardHeader} onClick={() => setShowScript(!showScript)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Zap style={{ width: '16px', height: '16px', color: '#f0b90b' }} />
              <span style={{ fontWeight: 600, fontSize: '13px' }}>貼入 Pine Script</span>
              {detectedParams.filter(p => p.type === 'int' || p.type === 'float').length > 0 && (
                <span style={S.badge}>
                  已偵測 {detectedParams.filter(p => p.type === 'int' || p.type === 'float').length} 個可優化參數
                </span>
              )}
            </div>
            {showScript
              ? <ChevronUp style={{ width: '16px', height: '16px', color: '#848e9c' }} />
              : <ChevronDown style={{ width: '16px', height: '16px', color: '#848e9c' }} />}
          </button>

          {showScript && (
            <div style={{ padding: '0 20px 20px', borderTop: '1px solid #2b2b43', paddingTop: '16px' }}>
              <textarea
                value={pineScript}
                onChange={(e) => { setPineScript(e.target.value); setDetectedParams([]); setParamRanges([]) }}
                placeholder={'//@version=5\nstrategy("My Strategy", overlay=true, initial_capital=10000, commission_value=0.1)\nfastLength = input.int(9, title="Fast EMA", minval=2, maxval=50)\n// ... 策略邏輯'}
                style={{
                  ...S.input,
                  height: '160px',
                  fontFamily: 'monospace',
                  fontSize: '12px',
                  color: '#26a69a',
                  resize: 'vertical',
                  marginBottom: '12px',
                }}
              />
              {parseError && (
                <div style={{ ...S.errorBox, marginBottom: '12px' }}>
                  <AlertCircle style={{ width: '14px', height: '14px', flexShrink: 0 }} />
                  {parseError}
                </div>
              )}
              <button
                onClick={parsePineScript}
                disabled={isParsing || !pineScript.trim()}
                style={{
                  padding: '8px 18px', background: '#2962ff', border: 'none', borderRadius: '6px',
                  color: '#fff', fontSize: '13px', fontWeight: 600, cursor: 'pointer',
                  display: 'flex', alignItems: 'center', gap: '6px',
                  ...(isParsing || !pineScript.trim() ? S.btnDisabled : {}),
                }}
              >
                {isParsing
                  ? <><RefreshCw style={{ width: '13px', height: '13px' }} /> 解析中...</>
                  : <><Sparkles style={{ width: '13px', height: '13px' }} /> AI 自動解析參數</>}
              </button>
            </div>
          )}
        </div>

        {/* -- Detected Params -- */}
        {paramRanges.length > 0 && (
          <div style={S.card}>
            <div style={{ padding: '20px' }}>
              <div style={S.sectionTitle}>
                <Settings2 style={{ width: '15px', height: '15px', color: '#2962ff' }} />
                參數優化設定
                <span style={{ fontSize: '11px', color: '#848e9c', fontWeight: 400 }}>（勾選要優化的參數並設定範圍）</span>
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {paramRanges.map((p) => (
                  <div key={p.name} style={S.paramCard(p.enabled)}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: p.enabled ? '12px' : '0' }}>
                      <input
                        type="checkbox" checked={p.enabled}
                        onChange={(e) => updateRange(p.name, 'enabled', e.target.checked)}
                        style={{ width: '14px', height: '14px', accentColor: '#2962ff' }}
                      />
                      <span style={{ color: '#d1d4dc', fontWeight: 600, fontSize: '13px' }}>{p.title}</span>
                      <span style={{ color: '#848e9c', fontSize: '11px' }}>({p.name})</span>
                      <span style={{ marginLeft: 'auto', fontSize: '11px', color: '#848e9c' }}>預設: {p.default_val}</span>
                    </div>
                    {p.enabled && (
                      <div style={S.grid3}>
                        {[
                          { field: 'min_val' as const, label: '最小值' },
                          { field: 'max_val' as const, label: '最大值' },
                          { field: 'step' as const, label: '步長' },
                        ].map(({ field, label }) => (
                          <div key={field}>
                            <label style={S.label}>{label}</label>
                            <input
                              type="number" value={p[field] as number}
                              step={p.is_int ? 1 : 0.01}
                              min={field === 'step' ? (p.is_int ? 1 : 0.01) : undefined}
                              onChange={(e) => updateRange(p.name, field, parseFloat(e.target.value))}
                              style={S.input}
                            />
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* -- Market & Optimize Settings -- */}
        <div style={S.card}>
          <button style={S.cardHeader} onClick={() => setShowSettings(!showSettings)}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
              <Settings2 style={{ width: '16px', height: '16px', color: '#2962ff' }} />
              <span style={{ fontWeight: 600, fontSize: '13px' }}>市場與優化設定</span>
            </div>
            {showSettings
              ? <ChevronUp style={{ width: '16px', height: '16px', color: '#848e9c' }} />
              : <ChevronDown style={{ width: '16px', height: '16px', color: '#848e9c' }} />}
          </button>

          {showSettings && (
            <div style={{ padding: '0 20px 20px', borderTop: '1px solid #2b2b43', paddingTop: '16px', display: 'flex', flexDirection: 'column', gap: '14px' }}>
              <div style={S.grid3}>
                <div>
                  <label style={S.label}>交易對</label>
                  <select value={symbol} onChange={(e) => setSymbol(e.target.value)} style={S.select}>
                    {POPULAR_SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.label}>時間框架</label>
                  <select value={interval} onChange={(e) => setIntervalVal(e.target.value)} style={S.select}>
                    {INTERVALS.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.label}>資料來源</label>
                  <select value={source} onChange={(e) => setSource(e.target.value)} style={S.select}>
                    {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              <div style={S.grid2}>
                <div>
                  <label style={S.label}>開始日期</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={S.input} />
                </div>
                <div>
                  <label style={S.label}>結束日期</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={S.input} />
                </div>
              </div>

              <div style={S.grid2}>
                <div>
                  <label style={S.label}>優化目標</label>
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={S.select}>
                    {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={S.label}>試驗次數 (Trials)</label>
                  <input
                    type="number" value={nTrials} min={10} max={2000} step={10}
                    onChange={(e) => setNTrials(Number(e.target.value))}
                    style={S.input}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* -- Error -- */}
        {errorMsg && (
          <div style={S.errorBox}>
            <AlertCircle style={{ width: '14px', height: '14px', flexShrink: 0 }} />
            {errorMsg}
          </div>
        )}

        {/* -- Run Button -- */}
        <button
          onClick={runOptimization}
          disabled={isRunning}
          style={{ ...S.btnPrimary, ...(isRunning ? S.btnDisabled : {}) }}
        >
          {isRunning
            ? <><RefreshCw style={{ width: '16px', height: '16px' }} /> 優化中... {progress}%</>
            : <><Play style={{ width: '16px', height: '16px' }} /> 開始策略優化</>}
        </button>

        {/* -- Progress Bar -- */}
        {isRunning && (
          <div>
            <div style={{ width: '100%', background: '#2b2b43', borderRadius: '99px', height: '6px', overflow: 'hidden', marginBottom: '8px' }}>
              <div style={{ height: '100%', background: '#2962ff', borderRadius: '99px', width: `${progress}%`, transition: 'width 0.3s' }} />
            </div>
            <div style={{ textAlign: 'center', fontSize: '12px', color: '#848e9c' }}>{progressText}</div>
          </div>
        )}

        {/* -- Results Table -- */}
        {results.length > 0 && (
          <div style={S.card}>
            <div style={{ padding: '16px 20px', borderBottom: '1px solid #2b2b43', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: '#d1d4dc' }}>
                <BarChart2 style={{ width: '15px', height: '15px', color: '#2962ff' }} />
                前 {results.length} 名最佳參數組合
              </div>
              <span style={{ fontSize: '11px', color: '#848e9c' }}>點擊列查看詳細</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: '#131722' }}>
                    {['排名', '參數', '總盈利%', 'MDD%', '盈虧比', '勝率%', '交易數', '夏普'].map(h => (
                      <th key={h} style={S.tableHeader}>{h}</th>
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
                          cursor: 'pointer',
                          background: isSelected ? 'rgba(41,98,255,0.1)' : 'transparent',
                        }}
                        onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.03)' }}
                        onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                      >
                        <td style={S.tableCell}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: '24px', height: '24px', borderRadius: '50%', fontSize: '11px', fontWeight: 700,
                            background: r.rank === 1 ? '#f0b90b' : r.rank === 2 ? '#848e9c' : r.rank === 3 ? '#cd7f32' : '#2b2b43',
                            color: r.rank <= 3 ? '#131722' : '#d1d4dc',
                          }}>{r.rank}</span>
                        </td>
                        <td style={S.tableCell}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px' }}>
                            {Object.entries(r.params).filter(([k]) => !k.startsWith('_')).map(([k, v]) => (
                              <span key={k} style={{ fontSize: '11px', padding: '2px 6px', background: '#2b2b43', borderRadius: '4px', color: '#d1d4dc' }}>
                                {k}: {typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(3)) : v}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td style={{ ...S.tableCell, color: r.profit_pct >= 0 ? '#26a69a' : '#ef5350', fontWeight: 600 }}>
                          {r.profit_pct >= 0 ? '+' : ''}{r.profit_pct.toFixed(2)}%
                        </td>
                        <td style={{ ...S.tableCell, color: '#ef5350' }}>{r.max_drawdown.toFixed(2)}%</td>
                        <td style={S.tableCell}>{r.profit_factor.toFixed(2)}</td>
                        <td style={S.tableCell}>{r.win_rate.toFixed(1)}%</td>
                        <td style={S.tableCell}>{r.total_trades}</td>
                        <td style={S.tableCell}>{r.sharpe_ratio.toFixed(2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* -- Selected Result Detail -- */}
        {selectedResult && (
          <div style={S.card}>
            <div style={{ padding: '20px' }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13px', fontWeight: 600, color: '#d1d4dc' }}>
                  <TrendingUp style={{ width: '15px', height: '15px', color: '#2962ff' }} />
                  第 {selectedResult.rank} 名詳細分析
                </div>
                <button onClick={copyOptimizedCode} style={S.btnSecondary}>
                  {copiedCode
                    ? <><Check style={{ width: '13px', height: '13px' }} /> 已複製！</>
                    : <><Copy style={{ width: '13px', height: '13px' }} /> 複製優化代碼</>}
                </button>
              </div>

              {/* Metrics */}
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: '8px', marginBottom: '16px' }}>
                {[
                  { label: '總盈利', value: `${selectedResult.profit_pct >= 0 ? '+' : ''}${selectedResult.profit_pct.toFixed(2)}%`, color: selectedResult.profit_pct >= 0 ? '#26a69a' : '#ef5350' },
                  { label: '最終資產', value: `$${selectedResult.final_equity.toFixed(0)}`, color: '#d1d4dc' },
                  { label: 'MDD', value: `${selectedResult.max_drawdown.toFixed(2)}%`, color: '#ef5350' },
                  { label: '盈虧比', value: selectedResult.profit_factor.toFixed(2), color: selectedResult.profit_factor > 1.5 ? '#26a69a' : '#d1d4dc' },
                  { label: '勝率', value: `${selectedResult.win_rate.toFixed(1)}%`, color: selectedResult.win_rate > 50 ? '#26a69a' : '#d1d4dc' },
                  { label: '交易數', value: String(selectedResult.total_trades), color: '#d1d4dc' },
                  { label: '夏普', value: selectedResult.sharpe_ratio.toFixed(2), color: selectedResult.sharpe_ratio > 1 ? '#26a69a' : '#d1d4dc' },
                  { label: '毛利/毛損', value: `${selectedResult.gross_profit.toFixed(0)}/${selectedResult.gross_loss.toFixed(0)}`, color: '#d1d4dc' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={S.metricBox}>
                    <div style={S.metricLabel}>{label}</div>
                    <div style={{ ...S.metricValue, color }}>{value}</div>
                  </div>
                ))}
              </div>

              {/* Equity curve */}
              <div style={{ marginBottom: '4px', fontSize: '11px', color: '#848e9c', fontWeight: 600, textTransform: 'uppercase' }}>資產曲線</div>
              <EquityChart data={selectedResult.equity_curve} />

              {/* Monthly PnL */}
              <MonthlyBarChart data={selectedResult.monthly_pnl} />

              {/* Best params */}
              <div style={{ marginTop: '16px' }}>
                <div style={{ fontSize: '11px', color: '#848e9c', fontWeight: 600, textTransform: 'uppercase', marginBottom: '8px' }}>最佳參數值</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
                  {Object.entries(selectedResult.params)
                    .filter(([k]) => !k.startsWith('_'))
                    .map(([k, v]) => (
                      <div key={k} style={{ padding: '8px 14px', background: 'rgba(41,98,255,0.12)', border: '1px solid rgba(41,98,255,0.3)', borderRadius: '8px' }}>
                        <span style={{ color: '#848e9c', fontSize: '11px' }}>{k}: </span>
                        <span style={{ color: '#d1d4dc', fontWeight: 700, fontSize: '13px' }}>
                          {typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(4)) : String(v)}
                        </span>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
