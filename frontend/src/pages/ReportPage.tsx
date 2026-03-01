// ================================================================
// ReportPage.tsx  v3.0.0 - 2026-03-01
// ----------------------------------------------------------------
// 暗色主題統一版 — 色票與 OptimizePage 完全一致
//   bg root:  #131722
//   card bg:  #1e222d
//   border:   #2b2b43
//   text:     #d1d4dc
//   muted:    #848e9c
//   green:    #26a69a
//   red:      #ef5350
//   gold:     #f0b90b
//
// 分頁架構（不變）：
//   Tab 1 — 績效總覽
//   Tab 2 — 資金曲線
//   Tab 3 — 月度分析
//   Tab 4 — 交易明細
//   Tab 5 — 策略設定
//
// #3 暫存：優先從 sessionStorage 讀取 temp report (key=report_{id})
// ================================================================

import React, { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, ChevronUp, ChevronDown, ChevronsUpDown } from 'lucide-react'

const API_BASE = ((import.meta as any).env?.VITE_API_URL ?? '').replace(/\/$/, '')

// ── colour tokens ────────────────────────────────────────────────
const C = {
  bg:      '#131722',
  card:    '#1e222d',
  border:  '#2b2b43',
  text:    '#d1d4dc',
  muted:   '#848e9c',
  green:   '#26a69a',
  red:     '#ef5350',
  gold:    '#f0b90b',
  blue:    '#2962ff',
  hover:   '#2a2e39',
}

// ================================================================
// Types
// ================================================================
interface TradeRecord {
  entry_time?: string
  exit_time?: string
  side?: string
  pnl?: number
  pnl_pct?: number
  entry_price?: number
  exit_price?: number
  contracts?: number
  cum_profit?: number
  run_up?: number
  drawdown?: number
}

interface ReportData {
  id: string
  name: string
  type: string
  symbol: string
  market_type: string
  interval: string
  start_date: string
  end_date: string
  saved_at: string
  initial_capital?: number
  commission_type?: string
  commission_value?: number
  profit_pct: number
  win_rate: number
  max_drawdown: number
  profit_factor: number
  sharpe_ratio: number
  total_trades: number
  final_equity: number
  gross_profit: number
  gross_loss: number
  equity_curve: number[]
  monthly_pnl: Record<string, number>
  trades: TradeRecord[]
  params: Record<string, number>
  rank?: number
}

type TabKey = 'overview' | 'equity' | 'monthly' | 'trades' | 'settings'

// ================================================================
// Helpers
// ================================================================
function fmt(n: number | undefined | null, d = 2) {
  if (n == null || isNaN(n)) return '—'
  return n.toFixed(d)
}
function fmtMoney(n: number | undefined | null) {
  if (n == null || isNaN(n)) return '—'
  return (n >= 0 ? '+' : '') + '$' + Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
}
function fmtPct(n: number | undefined | null) {
  if (n == null || isNaN(n)) return '—'
  return (n >= 0 ? '+' : '') + n.toFixed(2) + '%'
}

// ================================================================
// SVG Equity + Drawdown Chart (dark)
// ================================================================
function EquityDrawdownChart({ equityData }: { equityData: number[] }) {
  if (!equityData || equityData.length < 2) {
    return (
      <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center', color: C.muted, fontSize: 13 }}>
        無資金曲線資料
      </div>
    )
  }

  const W = 900, H = 240, PL = 72, PR = 16, PT = 16, PB = 32
  const chartW = W - PL - PR
  const chartH = H - PT - PB
  const minE = Math.min(...equityData)
  const maxE = Math.max(...equityData)
  const rangeE = maxE - minE || 1
  const toX = (i: number) => PL + (i / (equityData.length - 1)) * chartW
  const toY = (v: number) => PT + (1 - (v - minE) / rangeE) * chartH
  const equityPts = equityData.map((v, i) => `${toX(i)},${toY(v)}`).join(' ')
  const fillPts = `${PL},${PT + chartH} ${equityPts} ${PL + chartW},${PT + chartH}`
  const isPositive = equityData[equityData.length - 1] >= equityData[0]
  const lineColor = isPositive ? C.green : C.red

  const ddPcts: number[] = []
  let runMax = equityData[0]
  for (const v of equityData) {
    if (v > runMax) runMax = v
    ddPcts.push(runMax > 0 ? ((v - runMax) / runMax) * 100 : 0)
  }
  const minDD = Math.min(...ddPcts)
  const toYDD = (v: number) => PT + chartH - (Math.abs(v) / (Math.abs(minDD) || 1)) * (chartH * 0.3)
  const ddPts = ddPcts.map((v, i) => `${toX(i)},${toYDD(v)}`).join(' ')
  const ddFillPts = `${PL},${PT + chartH} ${ddPts} ${PL + chartW},${PT + chartH}`

  const yTicks = Array.from({ length: 5 }, (_, i) => minE + (rangeE / 4) * i)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto' }}>
      <defs>
        <linearGradient id="eq-grad-dark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.25" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0.02" />
        </linearGradient>
        <linearGradient id="dd-grad-dark" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={C.red} stopOpacity="0.0" />
          <stop offset="100%" stopColor={C.red} stopOpacity="0.3" />
        </linearGradient>
      </defs>
      {yTicks.map((val, i) => {
        const y = toY(val)
        return (
          <g key={i}>
            <line x1={PL} x2={PL + chartW} y1={y} y2={y} stroke={C.border} strokeWidth="0.8" />
            <text x={PL - 6} y={y + 4} textAnchor="end" fontSize="11" fill={C.muted}>
              {val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val.toFixed(0)}
            </text>
          </g>
        )
      })}
      <polygon points={ddFillPts} fill="url(#dd-grad-dark)" />
      <polyline points={ddPts} fill="none" stroke={C.red} strokeWidth="1" strokeOpacity="0.5" strokeDasharray="3,2" />
      <polygon points={fillPts} fill="url(#eq-grad-dark)" />
      <polyline points={equityPts} fill="none" stroke={lineColor} strokeWidth="2" />
      <line x1={PL} x2={PL + chartW} y1={PT + chartH} y2={PT + chartH} stroke={C.border} strokeWidth="1" />
      <line x1={PL} x2={PL} y1={PT} y2={PT + chartH} stroke={C.border} strokeWidth="1" />
      <line x1={PL + 4} x2={PL + 20} y1={PT + 10} y2={PT + 10} stroke={lineColor} strokeWidth="2" />
      <text x={PL + 24} y={PT + 14} fontSize="11" fill={C.muted}>資金曲線</text>
      <line x1={PL + 84} x2={PL + 100} y1={PT + 10} y2={PT + 10} stroke={C.red} strokeWidth="1.5" strokeDasharray="3,2" />
      <text x={PL + 104} y={PT + 14} fontSize="11" fill={C.muted}>回撤</text>
    </svg>
  )
}

// ================================================================
// Monthly Heatmap (dark)
// ================================================================
const MONTHS = ['01','02','03','04','05','06','07','08','09','10','11','12']
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function MonthlyHeatmap({ data }: { data: Record<string, number> }) {
  const byYear: Record<string, Record<string, number>> = {}
  for (const [key, val] of Object.entries(data)) {
    const [year, month] = key.split('-')
    if (!byYear[year]) byYear[year] = {}
    byYear[year][month] = val
  }
  const years = Object.keys(byYear).sort()
  if (years.length === 0) return <div style={{ color: C.muted, fontSize: 13 }}>無月度資料</div>

  const allVals = Object.values(data)
  const maxAbs = Math.max(...allVals.map(Math.abs), 1)

  const cellBg = (val: number | undefined) => {
    if (val == null) return C.card
    const intensity = Math.min(Math.abs(val) / maxAbs, 1)
    if (val > 0) return `rgba(38,166,154,${0.15 + intensity * 0.55})`
    return `rgba(239,83,80,${0.15 + intensity * 0.55})`
  }
  const cellText = (val: number | undefined) => {
    if (val == null) return C.border
    return val >= 0 ? C.green : C.red
  }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ borderCollapse: 'collapse', width: '100%', fontSize: 12 }}>
        <thead>
          <tr>
            <th style={{ textAlign: 'left', padding: '6px 8px', color: C.muted, fontWeight: 500, width: 56 }}>Year</th>
            {MONTH_LABELS.map((m, i) => (
              <th key={i} style={{ padding: '6px 4px', textAlign: 'center', color: C.muted, fontWeight: 500, minWidth: 56 }}>{m}</th>
            ))}
            <th style={{ padding: '6px 8px', textAlign: 'center', color: C.muted, fontWeight: 500, minWidth: 72 }}>Annual</th>
          </tr>
        </thead>
        <tbody>
          {years.map(year => {
            const yearData = byYear[year]
            const annualSum = Object.values(yearData).reduce((a, b) => a + b, 0)
            return (
              <tr key={year}>
                <td style={{ padding: '4px 8px', fontWeight: 600, color: C.text }}>{year}</td>
                {MONTHS.map(m => {
                  const val = yearData[m]
                  return (
                    <td key={m} style={{ padding: '3px', textAlign: 'center' }}>
                      <div style={{
                        background: cellBg(val), borderRadius: 4, padding: '3px 2px',
                        color: cellText(val), fontWeight: 500, fontSize: 11,
                      }}>
                        {val != null ? `${val >= 0 ? '+' : ''}${val.toFixed(1)}%` : ''}
                      </div>
                    </td>
                  )
                })}
                <td style={{ padding: '3px' }}>
                  <div style={{
                    background: cellBg(annualSum), borderRadius: 4, padding: '3px 4px',
                    color: cellText(annualSum), fontWeight: 700, fontSize: 11, textAlign: 'center',
                  }}>
                    {fmtPct(annualSum)}
                  </div>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function MonthlyBarChart({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort()
  if (entries.length === 0) return null
  const W = 900, H = 160, PL = 56, PR = 12, PT = 12, PB = 32
  const chartW = W - PL - PR
  const chartH = H - PT - PB
  const vals = entries.map(([, v]) => v)
  const maxAbs = Math.max(...vals.map(Math.abs), 1)
  const barW = (chartW / entries.length) * 0.65
  const spacing = chartW / entries.length
  const zeroY = PT + chartH / 2

  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 'auto', marginTop: 16 }}>
      <line x1={PL} x2={PL + chartW} y1={zeroY} y2={zeroY} stroke={C.border} strokeWidth="1" />
      <line x1={PL} x2={PL} y1={PT} y2={PT + chartH} stroke={C.border} strokeWidth="1" />
      {entries.map(([month, val], i) => {
        const x = PL + i * spacing + (spacing - barW) / 2
        const barH = Math.max((Math.abs(val) / maxAbs) * (chartH / 2), 1)
        const y = val >= 0 ? zeroY - barH : zeroY
        return (
          <g key={month}>
            <rect x={x} y={y} width={barW} height={barH} fill={val >= 0 ? C.green : C.red} rx="1" />
            {entries.length <= 24 && (
              <text x={x + barW / 2} y={PT + chartH + 22} textAnchor="middle" fontSize="9" fill={C.muted}>
                {month.slice(2).replace('-', '/')}
              </text>
            )}
          </g>
        )
      })}
    </svg>
  )
}

// ================================================================
// Metric Card (dark)
// ================================================================
function MetricCard({ label, value, sub, color }: {
  label: string; value: string; sub?: string; color?: string
}) {
  return (
    <div style={{
      background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
      padding: '14px 16px',
    }}>
      <div style={{ fontSize: 11, color: C.muted, marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em', fontWeight: 500 }}>
        {label}
      </div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color ?? C.text }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ================================================================
// Stats Row (dark)
// ================================================================
function StatsRow({ label, all, long, short, highlight }: {
  label: string; all: string; long?: string; short?: string; highlight?: boolean
}) {
  return (
    <tr style={{ background: highlight ? 'rgba(43,43,67,0.4)' : 'transparent' }}>
      <td style={{ padding: '8px 12px', fontSize: 13, color: C.muted, borderBottom: `1px solid ${C.border}` }}>{label}</td>
      <td style={{ padding: '8px 12px', fontSize: 13, fontWeight: 500, textAlign: 'right', color: C.text, borderBottom: `1px solid ${C.border}` }}>{all}</td>
      {long !== undefined && (
        <td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right', color: C.green, borderBottom: `1px solid ${C.border}` }}>{long}</td>
      )}
      {short !== undefined && (
        <td style={{ padding: '8px 12px', fontSize: 13, textAlign: 'right', color: C.red, borderBottom: `1px solid ${C.border}` }}>{short}</td>
      )}
    </tr>
  )
}

// ================================================================
// Trade Table (dark)
// ================================================================
type SortField = 'idx' | 'entry_time' | 'side' | 'pnl' | 'pnl_pct' | 'cum_profit'
type SortDir = 'asc' | 'desc'

function TradeTable({ trades }: { trades: TradeRecord[] }) {
  const [sortField, setSortField] = useState<SortField>('idx')
  const [sortDir, setSortDir] = useState<SortDir>('asc')

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('asc') }
  }

  const sorted = useMemo(() => {
    const arr = trades.map((t, i) => ({ ...t, _idx: i + 1 }))
    arr.sort((a, b) => {
      let av: any, bv: any
      if (sortField === 'idx') { av = a._idx; bv = b._idx }
      else if (sortField === 'entry_time') { av = a.entry_time ?? ''; bv = b.entry_time ?? '' }
      else if (sortField === 'side') { av = a.side ?? ''; bv = b.side ?? '' }
      else if (sortField === 'pnl') { av = a.pnl ?? 0; bv = b.pnl ?? 0 }
      else if (sortField === 'pnl_pct') { av = a.pnl_pct ?? 0; bv = b.pnl_pct ?? 0 }
      else if (sortField === 'cum_profit') { av = a.cum_profit ?? 0; bv = b.cum_profit ?? 0 }
      else { av = 0; bv = 0 }
      return sortDir === 'asc' ? (av > bv ? 1 : -1) : (av < bv ? 1 : -1)
    })
    return arr
  }, [trades, sortField, sortDir])

  const SortIcon = ({ field }: { field: SortField }) => {
    if (sortField !== field) return <ChevronsUpDown style={{ width: 12, height: 12, display: 'inline', marginLeft: 4, color: C.border }} />
    return sortDir === 'asc'
      ? <ChevronUp style={{ width: 12, height: 12, display: 'inline', marginLeft: 4, color: C.blue }} />
      : <ChevronDown style={{ width: 12, height: 12, display: 'inline', marginLeft: 4, color: C.blue }} />
  }

  const thStyle: React.CSSProperties = {
    padding: '8px 12px', textAlign: 'left', fontSize: 11, fontWeight: 600,
    color: C.muted, textTransform: 'uppercase', letterSpacing: '0.05em',
    borderBottom: `2px solid ${C.border}`, cursor: 'pointer', userSelect: 'none',
    background: C.hover, whiteSpace: 'nowrap',
  }
  const thRightStyle: React.CSSProperties = { ...thStyle, textAlign: 'right' }

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13, minWidth: 700 }}>
        <thead>
          <tr>
            <th style={thStyle} onClick={() => handleSort('idx')}># <SortIcon field="idx" /></th>
            <th style={thStyle} onClick={() => handleSort('entry_time')}>進場時間 <SortIcon field="entry_time" /></th>
            <th style={thStyle}>出場時間</th>
            <th style={thStyle} onClick={() => handleSort('side')}>方向 <SortIcon field="side" /></th>
            <th style={thRightStyle}>進場價</th>
            <th style={thRightStyle}>出場價</th>
            <th style={thRightStyle} onClick={() => handleSort('pnl')}>盈虧 <SortIcon field="pnl" /></th>
            <th style={thRightStyle} onClick={() => handleSort('pnl_pct')}>盈虧% <SortIcon field="pnl_pct" /></th>
            <th style={thRightStyle} onClick={() => handleSort('cum_profit')}>累積損益 <SortIcon field="cum_profit" /></th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((trade, i) => {
            const win = (trade.pnl ?? 0) > 0
            const lose = (trade.pnl ?? 0) < 0
            const pnlColor = win ? C.green : lose ? C.red : C.text
            return (
              <tr key={i} style={{ borderBottom: `1px solid ${C.border}` }}
                onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <td style={{ padding: '7px 12px', color: C.muted }}>{trade._idx}</td>
                <td style={{ padding: '7px 12px', color: C.text, fontVariantNumeric: 'tabular-nums' }}>{trade.entry_time ?? '—'}</td>
                <td style={{ padding: '7px 12px', color: C.text, fontVariantNumeric: 'tabular-nums' }}>{trade.exit_time ?? '—'}</td>
                <td style={{ padding: '7px 12px' }}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 4, fontSize: 11, fontWeight: 600,
                    background: trade.side === 'short' ? 'rgba(239,83,80,0.15)' : 'rgba(38,166,154,0.15)',
                    color: trade.side === 'short' ? C.red : C.green,
                  }}>
                    {trade.side === 'short' ? 'Short' : 'Long'}
                  </span>
                </td>
                <td style={{ padding: '7px 12px', textAlign: 'right', color: C.text, fontVariantNumeric: 'tabular-nums' }}>{trade.entry_price?.toFixed(2) ?? '—'}</td>
                <td style={{ padding: '7px 12px', textAlign: 'right', color: C.text, fontVariantNumeric: 'tabular-nums' }}>{trade.exit_price?.toFixed(2) ?? '—'}</td>
                <td style={{ padding: '7px 12px', textAlign: 'right', color: pnlColor, fontWeight: 500, fontVariantNumeric: 'tabular-nums' }}>
                  {trade.pnl != null ? fmtMoney(trade.pnl) : '—'}
                </td>
                <td style={{ padding: '7px 12px', textAlign: 'right', color: pnlColor, fontVariantNumeric: 'tabular-nums' }}>
                  {trade.pnl_pct != null ? fmtPct(trade.pnl_pct) : '—'}
                </td>
                <td style={{ padding: '7px 12px', textAlign: 'right', color: (trade.cum_profit ?? 0) >= 0 ? C.green : C.red, fontVariantNumeric: 'tabular-nums' }}>
                  {trade.cum_profit != null ? fmtMoney(trade.cum_profit) : '—'}
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

// ================================================================
// Tab Button (dark)
// ================================================================
function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      style={{
        padding: '10px 16px', fontSize: 13, fontWeight: 500, background: 'transparent',
        border: 'none', borderBottom: `2px solid ${active ? C.blue : 'transparent'}`,
        color: active ? C.text : C.muted, cursor: 'pointer', whiteSpace: 'nowrap',
        transition: 'color 0.15s, border-color 0.15s',
      }}
      onMouseEnter={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = C.text }}
      onMouseLeave={e => { if (!active) (e.currentTarget as HTMLButtonElement).style.color = C.muted }}
    >
      {children}
    </button>
  )
}

// ================================================================
// Main Component
// ================================================================
export default function ReportPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [activeTab, setActiveTab] = useState<TabKey>('overview')

  useEffect(() => {
    if (!id) return
    setLoading(true)

    // #3 暫存：先從 sessionStorage 讀取 temp report
    try {
      const cached = sessionStorage.getItem(`report_${id}`)
      if (cached) {
        setData(JSON.parse(cached))
        setLoading(false)
        return
      }
    } catch {}

    fetch(`${API_BASE}/api/strategies/${id}`)
      .then(r => r.ok ? r.json() : Promise.reject(r.statusText))
      .then(json => setData(json))
      .catch(err => console.error('Failed to load report:', err))
      .finally(() => setLoading(false))
  }, [id])

  const derived = useMemo(() => {
    if (!data) return null
    const trades = data.trades ?? []
    const longTrades = trades.filter(t => (t.side ?? 'long') !== 'short')
    const shortTrades = trades.filter(t => t.side === 'short')
    const winTrades = trades.filter(t => (t.pnl ?? 0) > 0)
    const loseTrades = trades.filter(t => (t.pnl ?? 0) < 0)
    const longWin = longTrades.filter(t => (t.pnl ?? 0) > 0)
    const shortWin = shortTrades.filter(t => (t.pnl ?? 0) > 0)
    const avgWin = winTrades.length > 0 ? winTrades.reduce((s, t) => s + (t.pnl ?? 0), 0) / winTrades.length : 0
    const avgLoss = loseTrades.length > 0 ? loseTrades.reduce((s, t) => s + (t.pnl ?? 0), 0) / loseTrades.length : 0
    const longGrossProfit = longTrades.filter(t => (t.pnl ?? 0) > 0).reduce((s, t) => s + (t.pnl ?? 0), 0)
    const longGrossLoss = longTrades.filter(t => (t.pnl ?? 0) < 0).reduce((s, t) => s + (t.pnl ?? 0), 0)
    const shortGrossProfit = shortTrades.filter(t => (t.pnl ?? 0) > 0).reduce((s, t) => s + (t.pnl ?? 0), 0)
    const shortGrossLoss = shortTrades.filter(t => (t.pnl ?? 0) < 0).reduce((s, t) => s + (t.pnl ?? 0), 0)
    const longNetProfit = longGrossProfit + longGrossLoss
    const shortNetProfit = shortGrossProfit + shortGrossLoss
    const longWinRate = longTrades.length > 0 ? (longWin.length / longTrades.length) * 100 : 0
    const shortWinRate = shortTrades.length > 0 ? (shortWin.length / shortTrades.length) * 100 : 0
    const longPF = Math.abs(longGrossLoss) > 0 ? longGrossProfit / Math.abs(longGrossLoss) : 0
    const shortPF = Math.abs(shortGrossLoss) > 0 ? shortGrossProfit / Math.abs(shortGrossLoss) : 0
    return {
      trades, longTrades, shortTrades, winTrades, loseTrades,
      longWin, shortWin, avgWin, avgLoss,
      longGrossProfit, longGrossLoss, shortGrossProfit, shortGrossLoss,
      longNetProfit, shortNetProfit, longWinRate, shortWinRate, longPF, shortPF,
    }
  }, [data])

  const spinnerStyle: React.CSSProperties = {
    width: 20, height: 20, border: `2px solid ${C.border}`,
    borderTop: `2px solid ${C.blue}`, borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
  }

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
        <div style={{ display: 'flex', alignItems: 'center', gap: 12, color: C.muted }}>
          <div style={spinnerStyle} />
          載入報告中...
        </div>
      </div>
    )
  }

  if (!data || !derived) {
    return (
      <div style={{ minHeight: '100vh', background: C.bg, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{ color: C.red, fontSize: 16, fontWeight: 600, marginBottom: 8 }}>無法載入報告</div>
          <button onClick={() => navigate(-1)} style={{ color: C.blue, fontSize: 13, background: 'none', border: 'none', cursor: 'pointer' }}>返回</button>
        </div>
      </div>
    )
  }

  const initialCap = data.initial_capital ?? 10000
  const netProfit = data.final_equity - initialCap

  const sectionStyle: React.CSSProperties = {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 8,
  }
  const sectionHeaderStyle: React.CSSProperties = {
    padding: '12px 16px', borderBottom: `1px solid ${C.border}`,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'system-ui, -apple-system, sans-serif' }}>

      {/* ── Sticky Header ── */}
      <div style={{
        background: C.card, borderBottom: `1px solid ${C.border}`,
        position: 'sticky', top: 0, zIndex: 10,
      }}>
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '10px 16px', display: 'flex', alignItems: 'center', gap: 12 }}>
          <button
            onClick={() => navigate(-1)}
            style={{
              padding: '6px', background: 'none', border: 'none', cursor: 'pointer',
              borderRadius: 6, color: C.muted, display: 'flex', alignItems: 'center',
            }}
            onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
            onMouseLeave={e => (e.currentTarget.style.background = 'none')}
          >
            <ArrowLeft style={{ width: 18, height: 18 }} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 16, fontWeight: 700, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
              {data.name}
            </div>
            <div style={{ fontSize: 12, color: C.muted, marginTop: 2 }}>
              {data.symbol} · {data.interval} · {data.start_date} – {data.end_date}
              {data.rank != null && <span style={{ marginLeft: 8, color: C.gold, fontWeight: 600 }}>Rank #{data.rank}</span>}
            </div>
          </div>
          <div style={{ textAlign: 'right' }}>
            <div style={{ fontSize: 22, fontWeight: 700, color: data.profit_pct >= 0 ? C.green : C.red }}>
              {fmtPct(data.profit_pct)}
            </div>
            <div style={{ fontSize: 11, color: C.muted }}>總報酬率</div>
          </div>
        </div>

        {/* Tabs */}
        <div style={{ maxWidth: 1280, margin: '0 auto', padding: '0 16px', display: 'flex', gap: 0, overflowX: 'auto' }}>
          {(['overview','equity','monthly','trades','settings'] as TabKey[]).map(tab => {
            const labels: Record<TabKey, React.ReactNode> = {
              overview: '績效總覽',
              equity: '資金曲線',
              monthly: '月度分析',
              trades: <span>交易明細 <span style={{ marginLeft: 4, background: C.border, color: C.muted, fontSize: 11, padding: '1px 6px', borderRadius: 10 }}>{data.total_trades}</span></span>,
              settings: '策略設定',
            }
            return <TabBtn key={tab} active={activeTab === tab} onClick={() => setActiveTab(tab)}>{labels[tab]}</TabBtn>
          })}
        </div>
      </div>

      {/* ── Content ── */}
      <div style={{ maxWidth: 1280, margin: '0 auto', padding: '24px 16px' }}>

        {/* ═══ Tab 1: 績效總覽 ═══ */}
        {activeTab === 'overview' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            {/* KPI cards */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
              <MetricCard label="淨利" value={fmtMoney(netProfit)} sub={fmtPct(data.profit_pct)} color={netProfit >= 0 ? C.green : C.red} />
              <MetricCard label="最大回撤" value={`${fmt(data.max_drawdown)}%`} color={C.red} />
              <MetricCard label="獲利因子" value={fmt(data.profit_factor)} color={data.profit_factor >= 1 ? C.green : C.red} />
              <MetricCard label="勝率" value={`${fmt(data.win_rate)}%`} color={data.win_rate >= 50 ? C.green : C.red} />
              <MetricCard label="夏普比率" value={fmt(data.sharpe_ratio)} color={data.sharpe_ratio >= 1 ? C.green : C.muted} />
              <MetricCard label="總交易次數" value={data.total_trades.toString()} />
            </div>

            {/* Mini equity */}
            <div style={{ ...sectionStyle, padding: 16 }}>
              <EquityDrawdownChart equityData={data.equity_curve} />
            </div>

            {/* Detailed stats */}
            <div style={sectionStyle}>
              <div style={sectionHeaderStyle}>
                <span style={{ fontSize: 14, fontWeight: 600, color: C.text }}>詳細績效統計</span>
                <div style={{ display: 'flex', gap: 16, fontSize: 12 }}>
                  <span style={{ color: C.text, fontWeight: 600 }}>全部</span>
                  <span style={{ color: C.green, fontWeight: 600 }}>多單</span>
                  <span style={{ color: C.red, fontWeight: 600 }}>空單</span>
                </div>
              </div>
              <table style={{ width: '100%', borderCollapse: 'collapse' }}>
                <thead>
                  <tr style={{ background: C.hover }}>
                    <th style={{ padding: '8px 12px', textAlign: 'left', fontSize: 11, color: C.muted, fontWeight: 500, width: '50%' }}>指標</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: C.text, fontWeight: 600 }}>全部</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: C.green, fontWeight: 600 }}>多單</th>
                    <th style={{ padding: '8px 12px', textAlign: 'right', fontSize: 11, color: C.red, fontWeight: 600 }}>空單</th>
                  </tr>
                </thead>
                <tbody>
                  <StatsRow label="淨利" all={fmtMoney(netProfit)} long={fmtMoney(derived.longNetProfit)} short={fmtMoney(derived.shortNetProfit)} highlight />
                  <StatsRow label="總獲利" all={fmtMoney(data.gross_profit)} long={fmtMoney(derived.longGrossProfit)} short={fmtMoney(derived.shortGrossProfit)} />
                  <StatsRow label="總虧損" all={fmtMoney(data.gross_loss)} long={fmtMoney(derived.longGrossLoss)} short={fmtMoney(derived.shortGrossLoss)} />
                  <StatsRow label="獲利因子" all={fmt(data.profit_factor)} long={fmt(derived.longPF)} short={fmt(derived.shortPF)} highlight />
                  <StatsRow label="最大回撤" all={`${fmt(data.max_drawdown)}%`} long="—" short="—" />
                  <StatsRow label="夏普比率" all={fmt(data.sharpe_ratio)} long="—" short="—" highlight />
                  <StatsRow label="總交易次數" all={data.total_trades.toString()} long={derived.longTrades.length.toString()} short={derived.shortTrades.length.toString()} />
                  <StatsRow label="獲利交易" all={derived.winTrades.length.toString()} long={derived.longWin.length.toString()} short={derived.shortWin.length.toString()} highlight />
                  <StatsRow label="虧損交易" all={derived.loseTrades.length.toString()} long={(derived.longTrades.length - derived.longWin.length).toString()} short={(derived.shortTrades.length - derived.shortWin.length).toString()} />
                  <StatsRow label="勝率" all={`${fmt(data.win_rate)}%`} long={`${fmt(derived.longWinRate)}%`} short={`${fmt(derived.shortWinRate)}%`} highlight />
                  <StatsRow label="平均獲利" all={fmtMoney(derived.avgWin)} long="—" short="—" />
                  <StatsRow label="平均虧損" all={fmtMoney(derived.avgLoss)} long="—" short="—" highlight />
                  <StatsRow label="最終權益" all={`$${data.final_equity.toLocaleString()}`} long="—" short="—" />
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ═══ Tab 2: 資金曲線 ═══ */}
        {activeTab === 'equity' && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <div style={{ ...sectionStyle, padding: 20 }}>
              <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>資金曲線 + 回撤</span>
                <div style={{ display: 'flex', gap: 16, fontSize: 12, color: C.muted }}>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'inline-block', width: 24, height: 2, background: C.green, borderRadius: 1 }} />資金曲線
                  </span>
                  <span style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span style={{ display: 'inline-block', width: 24, height: 0, borderTop: `1.5px dashed ${C.red}` }} />回撤
                  </span>
                </div>
              </div>
              <EquityDrawdownChart equityData={data.equity_curve} />
            </div>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
              <MetricCard label="初始資金" value={`$${initialCap.toLocaleString()}`} />
              <MetricCard label="最終權益" value={`$${data.final_equity.toLocaleString()}`} color={data.final_equity >= initialCap ? C.green : C.red} />
              <MetricCard label="最大回撤" value={`${fmt(data.max_drawdown)}%`} color={C.red} />
              <MetricCard label="資金曲線點數" value={data.equity_curve.length.toString()} />
            </div>
          </div>
        )}

        {/* ═══ Tab 3: 月度分析 ═══ */}
        {activeTab === 'monthly' && (
          <div style={sectionStyle}>
            <div style={{ ...sectionHeaderStyle }}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>月度盈虧熱力圖</span>
            </div>
            <div style={{ padding: 16 }}>
              <MonthlyHeatmap data={data.monthly_pnl} />
              <MonthlyBarChart data={data.monthly_pnl} />
            </div>
          </div>
        )}

        {/* ═══ Tab 4: 交易明細 ═══ */}
        {activeTab === 'trades' && (
          <div style={sectionStyle}>
            <div style={sectionHeaderStyle}>
              <span style={{ fontSize: 14, fontWeight: 600 }}>交易明細</span>
              <span style={{ fontSize: 13, color: C.muted }}>{data.total_trades} 筆交易 · 點擊欄位標題可排序</span>
            </div>
            <TradeTable trades={data.trades} />
          </div>
        )}

        {/* ═══ Tab 5: 策略設定 ═══ */}
        {activeTab === 'settings' && (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))', gap: 16 }}>
            <div style={sectionStyle}>
              <div style={sectionHeaderStyle}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>回測設定</span>
              </div>
              <div style={{ padding: '0 4px' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <tbody>
                    {[
                      ['標的', data.symbol],
                      ['週期', data.interval],
                      ['市場類型', data.market_type],
                      ['測試開始', data.start_date],
                      ['測試結束', data.end_date],
                      ['初始資金', `$${initialCap.toLocaleString()}`],
                      ['手續費類型', data.commission_type ?? '—'],
                      ['手續費值', data.commission_value != null
                        ? (data.commission_type === 'percent' ? `${(data.commission_value * 100).toFixed(2)}%` : `$${data.commission_value}`)
                        : '—'],
                      ['儲存時間', data.saved_at ? new Date(data.saved_at).toLocaleString('zh-TW') : '—'],
                    ].map(([label, val]) => (
                      <tr key={label} style={{ borderBottom: `1px solid ${C.border}` }}>
                        <td style={{ padding: '10px 12px', color: C.muted }}>{label}</td>
                        <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 500, color: C.text }}>{val}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div style={sectionStyle}>
              <div style={sectionHeaderStyle}>
                <span style={{ fontSize: 14, fontWeight: 600 }}>策略參數</span>
              </div>
              <div style={{ padding: '0 4px' }}>
                {Object.keys(data.params).length === 0 ? (
                  <div style={{ padding: 16, color: C.muted, fontSize: 13 }}>無參數資料</div>
                ) : (
                  <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                    <tbody>
                      {Object.entries(data.params).map(([key, val]) => (
                        <tr key={key} style={{ borderBottom: `1px solid ${C.border}` }}>
                          <td style={{ padding: '10px 12px', color: C.muted, fontFamily: 'monospace' }}>{key}</td>
                          <td style={{ padding: '10px 12px', textAlign: 'right', fontWeight: 600, color: C.gold }}>{String(val)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
