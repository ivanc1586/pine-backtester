// OptimizePage v2.1 — dark theme aligned with ChartPage
// Changes: removed lightweight-charts, inline dark style, removed capital/commission/quantity fields

import { useState, useRef, useCallback } from 'react'
import PageHeader from '../components/PageHeader'
import { Target } from 'lucide-react'

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
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT',
]

function MonthlyBarChart({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort(([a], [b]) => a.localeCompare(b))
  if (!entries.length) return null
  const vals = entries.map(([, v]) => v)
  const maxAbs = Math.max(...vals.map(Math.abs), 1)
  return (
    <div style={{ marginTop: 16 }}>
      <div style={{ fontSize: 11, color: '#848e9c', marginBottom: 8, fontWeight: 600 }}>每月績效</div>
      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 4, height: 80, overflowX: 'auto', paddingBottom: 4 }}>
        {entries.map(([month, pnl]) => {
          const pct = (Math.abs(pnl) / maxAbs) * 56
          const isPos = pnl >= 0
          return (
            <div key={month} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', minWidth: 28 }}>
              <div style={{ height: 64, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}>
                <div
                  style={{ width: 20, height: Math.max(3, pct), background: isPos ? '#26a69a' : '#ef5350', borderRadius: 2 }}
                  title={`${month}: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`}
                />
              </div>
              <div style={{ fontSize: 9, color: '#848e9c', marginTop: 2 }}>{month.slice(5)}</div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

function EquityCanvas({ curve }: { curve: number[] }) {
  const draw = useCallback((el: HTMLCanvasElement | null) => {
    if (!el || curve.length < 2) return
    const dpr = window.devicePixelRatio || 1
    const W = el.clientWidth, H = el.clientHeight
    el.width = W * dpr; el.height = H * dpr
    const ctx = el.getContext('2d')!
    ctx.scale(dpr, dpr)
    const min = Math.min(...curve), max = Math.max(...curve)
    const range = max - min || 1
    const pad = { top: 12, right: 12, bottom: 24, left: 56 }
    const cw = W - pad.left - pad.right, ch = H - pad.top - pad.bottom
    ctx.strokeStyle = '#1e2328'; ctx.lineWidth = 1
    for (let i = 0; i <= 4; i++) {
      const y = pad.top + (ch / 4) * i
      ctx.beginPath(); ctx.moveTo(pad.left, y); ctx.lineTo(W - pad.right, y); ctx.stroke()
      const val = max - (range / 4) * i
      ctx.fillStyle = '#848e9c'; ctx.font = '10px Helvetica Neue'; ctx.textAlign = 'right'
      ctx.fillText(val >= 1000 ? `${(val / 1000).toFixed(1)}K` : val.toFixed(0), pad.left - 4, y + 4)
    }
    const grad = ctx.createLinearGradient(0, pad.top, 0, pad.top + ch)
    grad.addColorStop(0, 'rgba(139,92,246,0.35)'); grad.addColorStop(1, 'rgba(139,92,246,0.02)')
    ctx.beginPath()
    curve.forEach((v, i) => {
      const x = pad.left + (i / (curve.length - 1)) * cw
      const y = pad.top + ch - ((v - min) / range) * ch
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.lineTo(pad.left + cw, pad.top + ch); ctx.lineTo(pad.left, pad.top + ch)
    ctx.closePath(); ctx.fillStyle = grad; ctx.fill()
    ctx.beginPath(); ctx.strokeStyle = '#8b5cf6'; ctx.lineWidth = 2
    curve.forEach((v, i) => {
      const x = pad.left + (i / (curve.length - 1)) * cw
      const y = pad.top + ch - ((v - min) / range) * ch
      i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y)
    })
    ctx.stroke()
  }, [curve])
  return <canvas ref={draw} style={{ width: '100%', height: 180, display: 'block', borderRadius: 4 }} />
}

const inputStyle: React.CSSProperties = {
  width: '100%', padding: '4px 8px', background: '#131722',
  border: '1px solid #2b2b43', borderRadius: 4,
  color: '#d1d4dc', fontSize: 12, outline: 'none', boxSizing: 'border-box',
}
const sectionStyle: React.CSSProperties = {
  background: '#1e222d', border: '1px solid #2b2b43', borderRadius: 6, marginBottom: 12, overflow: 'hidden',
}
const sectionHeaderStyle: React.CSSProperties = {
  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  padding: '8px 14px', borderBottom: '1px solid #2b2b43', cursor: 'pointer', userSelect: 'none',
}
const labelStyle: React.CSSProperties = { fontSize: 11, color: '#848e9c', marginBottom: 4, display: 'block' }

export default function OptimizePage() {
  const [pineScript, setPineScript] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [detectedParams, setDetectedParams] = useState<DetectedParam[]>([])
  const [paramRanges, setParamRanges] = useState<ParamRange[]>([])
  const [parseError, setParseError] = useState('')
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setIntervalVal] = useState('1h')
  const [source, setSource] = useState('binance')
  const [startDate, setStartDate] = useState('2023-01-01')
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0])
  const [sortBy, setSortBy] = useState('profit_pct')
  const [nTrials, setNTrials] = useState(100)
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState('')
  const [results, setResults] = useState<OptimizeResult[]>([])
  const [selectedResult, setSelectedResult] = useState<OptimizeResult | null>(null)
  const [copiedCode, setCopiedCode] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')
  const [showScript, setShowScript] = useState(true)
  const [showSettings, setShowSettings] = useState(true)

  const parsePineScript = useCallback(async () => {
    if (!pineScript.trim()) { setParseError('請先貼入 Pine Script 代碼'); return }
    setIsParsing(true); setParseError('')
    try {
      const res = await fetch('/api/optimize/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pine_script: pineScript }),
      })
      if (!res.ok) {
        const text = await res.text()
        throw new Error(`HTTP ${res.status}: ${text.slice(0, 200)}`)
      }
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
      if (data.params.length === 0) setParseError('未偵測到 input 參數，請確認含有 input.int / input.float 宣告')
    } catch (err: any) {
      setParseError(`解析失敗：${err.message}`)
    } finally {
      setIsParsing(false)
    }
  }, [pineScript])

  const updateRange = (name: string, field: keyof ParamRange, value: any) =>
    setParamRanges(prev => prev.map(p => p.name === name ? { ...p, [field]: value } : p))

  const runOptimization = async () => {
    if (!pineScript.trim()) { setErrorMsg('請先貼入 Pine Script 代碼並解析參數'); return }
    const enabledRanges = paramRanges.filter(p => p.enabled)
    if (enabledRanges.length === 0) { setErrorMsg('請至少勾選一個參數進行優化'); return }
    setIsRunning(true); setProgress(0); setProgressText('正在初始化...'); setResults([]); setSelectedResult(null); setErrorMsg('')
    try {
      const res = await fetch('/api/optimize/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pine_script: pineScript, symbol, interval, source,
          start_date: startDate, end_date: endDate,
          param_ranges: enabledRanges.map(p => ({ name: p.name, min_val: p.min_val, max_val: p.max_val, step: p.step, is_int: p.is_int })),
          sort_by: sortBy, n_trials: nTrials, top_n: 10,
        }),
      })
      if (!res.ok) { const e = await res.json(); throw new Error(e.detail || '優化請求失敗') }
      const reader = res.body?.getReader()
      if (!reader) throw new Error('無法讀取串流回應')
      const decoder = new TextDecoder(); let buffer = ''
      while (true) {
        const { done, value } = await reader.read(); if (done) break
        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n'); buffer = lines.pop() || ''
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim(); if (!payload) continue
          try {
            const data = JSON.parse(payload)
            if (data.type === 'progress') { setProgress(data.progress); setProgressText(`已完成 ${data.completed} / ${data.total} 次試驗`) }
            else if (data.type === 'result') { setResults(data.results); setProgress(100); setProgressText(`優化完成！共 ${data.results.length} 個最佳組合`) }
            else if (data.type === 'error') throw new Error(data.message)
          } catch (_) {}
        }
      }
    } catch (err: any) {
      setErrorMsg(`優化失敗：${err.message}`)
    } finally {
      setIsRunning(false)
    }
  }

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
    navigator.clipboard.writeText(code).then(() => { setCopiedCode(true); setTimeout(() => setCopiedCode(false), 2500) })
  }, [selectedResult, pineScript])

  return (
    <div style={{ display: 'flex', flexDirection: 'column', minHeight: '100vh', background: '#131722', color: '#d1d4dc' }}>
      <PageHeader title="策略優化" subtitle="AI 解析 Pine Script 參數 · Optuna 搜尋最佳組合" icon={<Target style={{ width: 20, height: 20 }} />} />
      <div style={{ flex: 1, padding: '16px', maxWidth: 960, margin: '0 auto', width: '100%' }}>

        <div style={sectionStyle}>
          <div style={sectionHeaderStyle} onClick={() => setShowScript(v => !v)}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#d1d4dc' }}>
              貼入 Pine Script
              {detectedParams.filter(p => p.type === 'int' || p.type === 'float').length > 0 &&
                <span style={{ marginLeft: 8, fontSize: 11, color: '#26a69a' }}>
                  ✓ 已偵測 {detectedParams.filter(p => p.type === 'int' || p.type === 'float').length} 個可優化參數
                </span>
              }
            </span>
            <span style={{ color: '#848e9c', fontSize: 12 }}>{showScript ? '▲' : '▼'}</span>
          </div>
          {showScript && (
            <div style={{ padding: '12px 14px' }}>
              <textarea
                value={pineScript}
                onChange={(e) => { setPineScript(e.target.value); setDetectedParams([]); setParamRanges([]) }}
                placeholder={'//@version=5\nstrategy("My Strategy", overlay=true)\nfastLength = input.int(9, title="Fast EMA", minval=2, maxval=50)\n// ...'}
                style={{ ...inputStyle, height: 180, resize: 'vertical', fontFamily: 'monospace', color: '#26a69a', fontSize: 12 }}
              />
              {parseError && <div style={{ marginTop: 8, fontSize: 12, color: '#ef5350' }}>⚠ {parseError}</div>}
              <button
                onClick={parsePineScript}
                disabled={isParsing || !pineScript.trim()}
                style={{
                  marginTop: 10, padding: '6px 16px', fontSize: 12, fontWeight: 700,
                  background: isParsing || !pineScript.trim() ? '#2b2b43' : '#8b5cf6',
                  color: isParsing || !pineScript.trim() ? '#848e9c' : '#fff',
                  border: 'none', borderRadius: 4, cursor: isParsing || !pineScript.trim() ? 'not-allowed' : 'pointer',
                }}
              >
                {isParsing ? '解析中...' : '✦ AI 自動解析參數'}
              </button>
            </div>
          )}
        </div>

        {paramRanges.length > 0 && (
          <div style={sectionStyle}>
            <div style={{ ...sectionHeaderStyle, cursor: 'default' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#d1d4dc' }}>參數優化設定</span>
              <span style={{ fontSize: 11, color: '#848e9c' }}>勾選要優化的參數並設定範圍</span>
            </div>
            <div style={{ padding: '8px 14px 14px' }}>
              {paramRanges.map((p) => (
                <div key={p.name} style={{
                  padding: '10px 12px', borderRadius: 4, marginBottom: 8,
                  background: p.enabled ? 'rgba(139,92,246,0.08)' : '#131722',
                  border: `1px solid ${p.enabled ? 'rgba(139,92,246,0.3)' : '#2b2b43'}`,
                }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: p.enabled ? 10 : 0 }}>
                    <input type="checkbox" checked={p.enabled} onChange={(e) => updateRange(p.name, 'enabled', e.target.checked)} style={{ accentColor: '#8b5cf6', width: 14, height: 14 }} />
                    <span style={{ fontSize: 13, color: '#d1d4dc', fontWeight: 600 }}>{p.title}</span>
                    <span style={{ fontSize: 11, color: '#848e9c' }}>({p.name})</span>
                    <span style={{ marginLeft: 'auto', fontSize: 11, color: '#848e9c' }}>預設: {p.default_val}</span>
                  </div>
                  {p.enabled && (
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 8 }}>
                      {(['min_val', 'max_val', 'step'] as const).map((field) => (
                        <div key={field}>
                          <label style={labelStyle}>{{ min_val: '最小值', max_val: '最大值', step: '步長' }[field]}</label>
                          <input type="number" value={p[field]} step={p.is_int ? 1 : 0.01} onChange={(e) => updateRange(p.name, field, parseFloat(e.target.value))} style={inputStyle} />
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        <div style={sectionStyle}>
          <div style={sectionHeaderStyle} onClick={() => setShowSettings(v => !v)}>
            <span style={{ fontSize: 13, fontWeight: 700, color: '#d1d4dc' }}>市場與優化設定</span>
            <span style={{ color: '#848e9c', fontSize: 12 }}>{showSettings ? '▲' : '▼'}</span>
          </div>
          {showSettings && (
            <div style={{ padding: '12px 14px 16px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>交易對</label>
                  <select value={symbol} onChange={(e) => setSymbol(e.target.value)} style={inputStyle}>
                    {POPULAR_SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>時間框架</label>
                  <select value={interval} onChange={(e) => setIntervalVal(e.target.value)} style={inputStyle}>
                    {INTERVALS.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>資料來源</label>
                  <select value={source} onChange={(e) => setSource(e.target.value)} style={inputStyle}>
                    {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12, marginBottom: 12 }}>
                <div>
                  <label style={labelStyle}>開始日期</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} style={inputStyle} />
                </div>
                <div>
                  <label style={labelStyle}>結束日期</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} style={inputStyle} />
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                <div>
                  <label style={labelStyle}>優化目標</label>
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)} style={inputStyle}>
                    {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label style={labelStyle}>試驗次數 (Trials)</label>
                  <input type="number" value={nTrials} min={10} max={2000} step={10} onChange={(e) => setNTrials(Number(e.target.value))} style={inputStyle} />
                </div>
              </div>
            </div>
          )}
        </div>

        {errorMsg && (
          <div style={{ padding: '8px 12px', background: 'rgba(239,83,80,0.1)', border: '1px solid rgba(239,83,80,0.3)', borderRadius: 4, marginBottom: 12, fontSize: 12, color: '#ef5350' }}>
            ⚠ {errorMsg}
          </div>
        )}

        <button
          onClick={runOptimization}
          disabled={isRunning}
          style={{
            width: '100%', padding: '10px 0', marginBottom: 16,
            background: isRunning ? '#2b2b43' : '#8b5cf6',
            color: isRunning ? '#848e9c' : '#fff',
            border: 'none', borderRadius: 4, fontSize: 14, fontWeight: 700,
            cursor: isRunning ? 'not-allowed' : 'pointer',
          }}
        >
          {isRunning ? `優化中... ${progress}%` : '▶ 開始策略優化'}
        </button>

        {isRunning && (
          <div style={{ marginBottom: 16 }}>
            <div style={{ height: 4, background: '#2b2b43', borderRadius: 2, overflow: 'hidden', marginBottom: 6 }}>
              <div style={{ height: '100%', width: `${progress}%`, background: '#8b5cf6', transition: 'width 0.3s', borderRadius: 2 }} />
            </div>
            <div style={{ textAlign: 'center', fontSize: 11, color: '#848e9c' }}>{progressText}</div>
          </div>
        )}

        {results.length > 0 && (
          <div style={sectionStyle}>
            <div style={{ ...sectionHeaderStyle, cursor: 'default' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#d1d4dc' }}>前 {results.length} 名最佳參數組合</span>
              <span style={{ fontSize: 11, color: '#848e9c' }}>點擊列查看詳細圖表</span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
                <thead>
                  <tr style={{ borderBottom: '1px solid #2b2b43' }}>
                    {['排名', '參數', '盈利%', 'MDD%', '盈虧比', '勝率%', '交易數', '夏普'].map(h => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: h === '排名' || h === '參數' ? 'left' : 'right', color: '#848e9c', fontWeight: 600 }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const isSelected = selectedResult?.rank === r.rank
                    return (
                      <tr key={r.rank} onClick={() => setSelectedResult(r)}
                        style={{ borderBottom: '1px solid #1e2328', cursor: 'pointer', background: isSelected ? 'rgba(139,92,246,0.15)' : 'transparent' }}
                        onMouseEnter={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = '#2b2b43' }}
                        onMouseLeave={e => { if (!isSelected) (e.currentTarget as HTMLElement).style.background = 'transparent' }}
                      >
                        <td style={{ padding: '7px 10px' }}>
                          <span style={{
                            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                            width: 22, height: 22, borderRadius: '50%', fontSize: 11, fontWeight: 700,
                            background: r.rank === 1 ? '#f0b90b' : r.rank === 2 ? '#9e9e9e' : r.rank === 3 ? '#cd7f32' : '#2b2b43',
                            color: r.rank <= 3 ? '#000' : '#d1d4dc',
                          }}>{r.rank}</span>
                        </td>
                        <td style={{ padding: '7px 10px' }}>
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4 }}>
                            {Object.entries(r.params).filter(([k]) => !k.startsWith('_') && k !== 'quantity').map(([k, v]) => (
                              <span key={k} style={{ fontSize: 11, padding: '2px 6px', background: '#131722', border: '1px solid #2b2b43', borderRadius: 3, color: '#d1d4dc' }}>
                                {k}: {typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(3)) : v}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', fontWeight: 700, color: r.profit_pct >= 0 ? '#26a69a' : '#ef5350' }}>
                          {r.profit_pct >= 0 ? '+' : ''}{r.profit_pct.toFixed(2)}%
                        </td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', color: '#ef5350' }}>{r.max_drawdown.toFixed(2)}%</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', color: '#d1d4dc' }}>{r.profit_factor.toFixed(2)}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', color: '#d1d4dc' }}>{r.win_rate.toFixed(1)}%</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', color: '#848e9c' }}>{r.total_trades}</td>
                        <td style={{ padding: '7px 10px', textAlign: 'right', color: '#848e9c' }}>{r.sharpe_ratio.toFixed(2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {selectedResult && (
          <div style={sectionStyle}>
            <div style={{ ...sectionHeaderStyle, cursor: 'default' }}>
              <span style={{ fontSize: 13, fontWeight: 700, color: '#d1d4dc' }}>第 {selectedResult.rank} 名詳細分析</span>
              <button onClick={copyOptimizedCode} style={{
                padding: '4px 12px', fontSize: 11, fontWeight: 700,
                background: copiedCode ? 'rgba(38,166,154,0.2)' : 'rgba(139,92,246,0.2)',
                color: copiedCode ? '#26a69a' : '#8b5cf6',
                border: `1px solid ${copiedCode ? 'rgba(38,166,154,0.4)' : 'rgba(139,92,246,0.4)'}`,
                borderRadius: 4, cursor: 'pointer',
              }}>
                {copiedCode ? '✓ 已複製' : '複製優化代碼'}
              </button>
            </div>
            <div style={{ padding: '12px 14px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 8, marginBottom: 16 }}>
                {[
                  { label: '總盈利', value: `${selectedResult.profit_pct >= 0 ? '+' : ''}${selectedResult.profit_pct.toFixed(2)}%`, color: selectedResult.profit_pct >= 0 ? '#26a69a' : '#ef5350' },
                  { label: '最終資產', value: `$${selectedResult.final_equity.toFixed(0)}`, color: '#d1d4dc' },
                  { label: 'MDD', value: `${selectedResult.max_drawdown.toFixed(2)}%`, color: '#ef5350' },
                  { label: '盈虧比', value: selectedResult.profit_factor.toFixed(2), color: selectedResult.profit_factor >= 1.5 ? '#26a69a' : '#d1d4dc' },
                  { label: '勝率', value: `${selectedResult.win_rate.toFixed(1)}%`, color: selectedResult.win_rate >= 50 ? '#26a69a' : '#d1d4dc' },
                  { label: '交易數', value: String(selectedResult.total_trades), color: '#d1d4dc' },
                  { label: '夏普', value: selectedResult.sharpe_ratio.toFixed(2), color: selectedResult.sharpe_ratio >= 1 ? '#26a69a' : '#d1d4dc' },
                  { label: '毛利/毛損', value: `${selectedResult.gross_profit.toFixed(0)}/${selectedResult.gross_loss.toFixed(0)}`, color: '#848e9c' },
                ].map(({ label, value, color }) => (
                  <div key={label} style={{ background: '#131722', border: '1px solid #2b2b43', borderRadius: 4, padding: '8px 10px', textAlign: 'center' }}>
                    <div style={{ fontSize: 10, color: '#848e9c', marginBottom: 2 }}>{label}</div>
                    <div style={{ fontSize: 13, fontWeight: 700, color }}>{value}</div>
                  </div>
                ))}
              </div>
              {selectedResult.equity_curve.length > 1 && (
                <div style={{ marginBottom: 12 }}>
                  <div style={{ fontSize: 11, color: '#848e9c', marginBottom: 6, fontWeight: 600 }}>資產曲線</div>
                  <EquityCanvas curve={selectedResult.equity_curve} />
                </div>
              )}
              <MonthlyBarChart data={selectedResult.monthly_pnl} />
              <div style={{ marginTop: 16 }}>
                <div style={{ fontSize: 11, color: '#848e9c', marginBottom: 8, fontWeight: 600 }}>最佳參數值</div>
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                  {Object.entries(selectedResult.params)
                    .filter(([k]) => !k.startsWith('_') && k !== 'quantity')
                    .map(([k, v]) => (
                      <div key={k} style={{ padding: '6px 12px', background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 4 }}>
                        <span style={{ fontSize: 11, color: '#848e9c' }}>{k}: </span>
                        <span style={{ fontSize: 13, fontWeight: 700, color: '#d1d4dc' }}>
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
