// ================================================================
// ReportPage.tsx  v2.0.0
// ----------------------------------------------------------------
// TradingView 風格詳細報告頁面 /report/:id
// 資料來源：GET /api/strategies/:id
//
// 分頁架構：
//   Tab 1 — 績效總覽   (核心指標卡片 + 多空分析)
//   Tab 2 — 資金曲線   (Equity Curve + Drawdown 疊加)
//   Tab 3 — 月度分析   (年度/月度熱力圖 + 柱狀圖)
//   Tab 4 — 交易明細   (完整交易列表，可排序)
//   Tab 5 — 策略設定   (參數 + 回測設定)
// ================================================================

import React, { useEffect, useState, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft, TrendingUp, TrendingDown, Activity,
  BarChart2, Hash, DollarSign, Percent, ChevronUp,
  ChevronDown, ChevronsUpDown, Calendar
} from 'lucide-react'

const API_BASE = ((import.meta as any).env?.VITE_API_URL ?? '').replace(/\/$/, '')

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
// Utility helpers
// ================================================================
function fmt(n: number | undefined | null, decimals = 2) {
  if (n == null || isNaN(n)) return '—'
  return n.toFixed(decimals)
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
// SVG Equity + Drawdown Chart
// ================================================================
function EquityDrawdownChart({ equityData, trades }: { equityData: number[], trades: TradeRecord[] }) {
  if (!equityData || equityData.length < 2) {
    return <div className="h-64 flex items-center justify-center text-gray-500 text-sm">無資金曲線資料</div>
  }

  const W = 900, H = 260, PL = 72, PR = 16, PT = 16, PB = 32
  const chartW = W - PL - PR
  const chartH = H - PT - PB

  // Equity
  const minE = Math.min(...equityData)
  const maxE = Math.max(...equityData)
  const rangeE = maxE - minE || 1
  const toX = (i: number) => PL + (i / (equityData.length - 1)) * chartW
  const toY = (v: number) => PT + (1 - (v - minE) / rangeE) * chartH
  const equityPts = equityData.map((v, i) => `${toX(i)},${toY(v)}`).join(' ')
  const fillPts = `${PL},${PT + chartH} ${equityPts} ${PL + chartW},${PT + chartH}`

  const isPositive = equityData[equityData.length - 1] >= equityData[0]
  const lineColor = isPositive ? '#26a69a' : '#ef5350'

  // Drawdown overlay (compute running max drawdown per point)
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

  // Y axis ticks
  const yTicks = Array.from({ length: 5 }, (_, i) => minE + (rangeE / 4) * i)

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto">
      <defs>
        <linearGradient id="eq-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={lineColor} stopOpacity="0.18" />
          <stop offset="100%" stopColor={lineColor} stopOpacity="0.0" />
        </linearGradient>
        <linearGradient id="dd-grad" x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor="#ef5350" stopOpacity="0.0" />
          <stop offset="100%" stopColor="#ef5350" stopOpacity="0.25" />
        </linearGradient>
      </defs>
      {/* Grid */}
      {yTicks.map((val, i) => {
        const y = toY(val)
        return (
          <g key={i}>
            <line x1={PL} x2={PL + chartW} y1={y} y2={y} stroke="#e5e7eb" strokeWidth="0.8" />
            <text x={PL - 6} y={y + 4} textAnchor="end" fontSize="11" fill="#9ca3af">
              {val >= 1000 ? `${(val / 1000).toFixed(0)}k` : val.toFixed(0)}
            </text>
          </g>
        )
      })}
      {/* Drawdown fill */}
      <polygon points={ddFillPts} fill="url(#dd-grad)" />
      <polyline points={ddPts} fill="none" stroke="#ef5350" strokeWidth="1" strokeOpacity="0.5" strokeDasharray="3,2" />
      {/* Equity fill + line */}
      <polygon points={fillPts} fill="url(#eq-grad)" />
      <polyline points={equityPts} fill="none" stroke={lineColor} strokeWidth="2" />
      {/* Axes */}
      <line x1={PL} x2={PL + chartW} y1={PT + chartH} y2={PT + chartH} stroke="#d1d5db" strokeWidth="1" />
      <line x1={PL} x2={PL} y1={PT} y2={PT + chartH} stroke="#d1d5db" strokeWidth="1" />
      {/* Legend */}
      <line x1={PL + 4} x2={PL + 20} y1={PT + 10} y2={PT + 10} stroke={lineColor} strokeWidth="2" />
      <text x={PL + 24} y={PT + 14} fontSize="11" fill="#6b7280">資金曲線</text>
      <line x1={PL + 84} x2={PL + 100} y1={PT + 10} y2={PT + 10} stroke="#ef5350" strokeWidth="1.5" strokeDasharray="3,2" />
      <text x={PL + 104} y={PT + 14} fontSize="11" fill="#6b7280">回撤</text>
    </svg>
  )
}

// ================================================================
// Monthly PnL Chart + Heatmap
// ================================================================
const MONTHS = ['01','02','03','04','05','06','07','08','09','10','11','12']
const MONTH_LABELS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

function MonthlyHeatmap({ data }: { data: Record<string, number> }) {
  // Group by year
  const byYear: Record<string, Record<string, number>> = {}
  for (const [key, val] of Object.entries(data)) {
    const [year, month] = key.split('-')
    if (!byYear[year]) byYear[year] = {}
    byYear[year][month] = val
  }
  const years = Object.keys(byYear).sort()
  if (years.length === 0) return <div className="text-gray-500 text-sm">無月度資料</div>

  const allVals = Object.values(data)
  const maxAbs = Math.max(...allVals.map(Math.abs), 1)

  const cellColor = (val: number | undefined) => {
    if (val == null) return '#f3f4f6'
    const intensity = Math.min(Math.abs(val) / maxAbs, 1)
    if (val > 0) {
      const g = Math.round(150 + intensity * 55)
      const r = Math.round(220 - intensity * 80)
      return `rgb(${r},${g},${Math.round(150 - intensity * 50)})`
    } else {
      const r = Math.round(220)
      const g = Math.round(150 - intensity * 50)
      return `rgb(${r},${g},${Math.round(150 - intensity * 50)})`
    }
  }

  return (
    <div className="overflow-x-auto">
      <table className="text-xs border-collapse w-full">
        <thead>
          <tr>
            <th className="text-left p-2 text-gray-500 font-medium w-16">Year</th>
            {MONTH_LABELS.map((m, i) => (
              <th key={i} className="p-1 text-center text-gray-500 font-medium w-16">{m}</th>
            ))}
            <th className="p-2 text-center text-gray-500 font-medium w-20">Annual</th>
          </tr>
        </thead>
        <tbody>
          {years.map(year => {
            const yearData = byYear[year]
            const annualSum = Object.values(yearData).reduce((a, b) => a + b, 0)
            return (
              <tr key={year}>
                <td className="p-2 font-semibold text-gray-700">{year}</td>
                {MONTHS.map(m => {
                  const val = yearData[m]
                  return (
                    <td
                      key={m}
                      className="p-1 text-center rounded"
                      style={{ backgroundColor: cellColor(val) }}
                      title={val != null ? `${year}-${m}: ${fmtPct(val)}` : ''}
                    >
                      <span className={`font-medium ${val == null ? 'text-gray-300' : val >= 0 ? 'text-green-900' : 'text-red-900'}`}>
                        {val != null ? `${val >= 0 ? '+' : ''}${val.toFixed(1)}%` : ''}
                      </span>
                    </td>
                  )
                })}
                <td
                  className="p-1 text-center rounded font-semibold"
                  style={{ backgroundColor: cellColor(annualSum) }}
                >
                  <span className={annualSum >= 0 ? 'text-green-900' : 'text-red-900'}>
                    {fmtPct(annualSum)}
                  </span>
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
  const W = 900, H = 180, PL = 60, PR = 12, PT = 12, PB = 36
  const chartW = W - PL - PR
  const chartH = H - PT - PB
  const vals = entries.map(([, v]) => v)
  const maxAbs = Math.max(...vals.map(Math.abs), 1)
  const barW = (chartW / entries.length) * 0.65
  const spacing = chartW / entries.length
  const zeroY = PT + chartH / 2

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-auto mt-4">
      <line x1={PL} x2={PL + chartW} y1={zeroY} y2={zeroY} stroke="#9ca3af" strokeWidth="1" />
      <line x1={PL} x2={PL} y1={PT} y2={PT + chartH} stroke="#d1d5db" strokeWidth="1" />
      {entries.map(([month, val], i) => {
        const x = PL + i * spacing + (spacing - barW) / 2
        const barH = Math.max((Math.abs(val) / maxAbs) * (chartH / 2), 1)
        const y = val >= 0 ? zeroY - barH : zeroY
        return (
          <g key={month}>
            <rect x={x} y={y} width={barW} height={barH} fill={val >= 0 ? '#26a69a' : '#ef5350'} rx="1" />
            {entries.length <= 24 && (
              <text x={x + barW / 2} y={PT + chartH + 22} textAnchor="middle" fontSize="9" fill="#9ca3af">
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
// Metric Card
// ================================================================
function MetricCard({ label, value, sub, positive, neutral = false }: {
  label: string
  value: string
  sub?: string
  positive?: boolean
  neutral?: boolean
}) {
  const valueColor = neutral
    ? 'text-gray-800'
    : positive === undefined
      ? 'text-gray-800'
      : positive ? 'text-emerald-600' : 'text-red-500'
  return (
    <div className="bg-white border border-gray-200 rounded-lg p-4">
      <div className="text-xs text-gray-500 mb-1 font-medium uppercase tracking-wide">{label}</div>
      <div className={`text-xl font-bold ${valueColor}`}>{value}</div>
      {sub && <div className="text-xs text-gray-400 mt-0.5">{sub}</div>}
    </div>
  )
}

// ================================================================
// Stats Row (TV-style two-column row)
// ================================================================
function StatsRow({ label, all, long, short, highlight = false }: {
  label: string
  all: string
  long?: string
  short?: string
  highlight?: boolean
}) {
  return (
    <tr className={highlight ? 'bg-gray-50' : ''}>
      <td className="py-2 px-3 text-sm text-gray-600 border-b border-gray-100">{label}</td>
      <td className="py-2 px-3 text-sm font-medium text-right border-b border-gray-100">{all}</td>
      {long !== undefined && (
        <td className="py-2 px-3 text-sm text-right text-emerald-600 border-b border-gray-100">{long}</td>
      )}
      {short !== undefined && (
        <td className="py-2 px-3 text-sm text-right text-red-500 border-b border-gray-100">{short}</td>
      )}
    </tr>
  )
}

// ================================================================
// Trade Table with sorting
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
    if (sortField !== field) return <ChevronsUpDown className="w-3 h-3 inline ml-1 text-gray-300" />
    return sortDir === 'asc'
      ? <ChevronUp className="w-3 h-3 inline ml-1 text-blue-500" />
      : <ChevronDown className="w-3 h-3 inline ml-1 text-blue-500" />
  }

  const thClass = "py-2 px-3 text-left text-xs font-semibold text-gray-500 uppercase tracking-wide cursor-pointer select-none hover:text-gray-700 border-b-2 border-gray-200"

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm min-w-[700px]">
        <thead className="bg-gray-50">
          <tr>
            <th className={thClass} onClick={() => handleSort('idx')}>#<SortIcon field="idx" /></th>
            <th className={thClass} onClick={() => handleSort('entry_time')}>進場時間<SortIcon field="entry_time" /></th>
            <th className={thClass}>出場時間</th>
            <th className={thClass} onClick={() => handleSort('side')}>方向<SortIcon field="side" /></th>
            <th className="py-2 px-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide border-b-2 border-gray-200">進場價</th>
            <th className="py-2 px-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide border-b-2 border-gray-200">出場價</th>
            <th className={`${thClass} text-right`} onClick={() => handleSort('pnl')}>盈虧<SortIcon field="pnl" /></th>
            <th className={`${thClass} text-right`} onClick={() => handleSort('pnl_pct')}>盈虧%<SortIcon field="pnl_pct" /></th>
            <th className={`${thClass} text-right`} onClick={() => handleSort('cum_profit')}>累積損益<SortIcon field="cum_profit" /></th>
            <th className="py-2 px-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide border-b-2 border-gray-200">Run-up</th>
            <th className="py-2 px-3 text-right text-xs font-semibold text-gray-500 uppercase tracking-wide border-b-2 border-gray-200">Drawdown</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((trade, i) => {
            const win = (trade.pnl ?? 0) > 0
            const lose = (trade.pnl ?? 0) < 0
            return (
              <tr key={i} className="border-b border-gray-100 hover:bg-blue-50 transition-colors">
                <td className="py-2 px-3 text-gray-400">{trade._idx}</td>
                <td className="py-2 px-3 text-gray-700 tabular-nums">{trade.entry_time ?? '—'}</td>
                <td className="py-2 px-3 text-gray-700 tabular-nums">{trade.exit_time ?? '—'}</td>
                <td className="py-2 px-3">
                  <span className={`px-2 py-0.5 rounded text-xs font-semibold ${
                    trade.side === 'short' ? 'bg-red-100 text-red-700' : 'bg-emerald-100 text-emerald-700'
                  }`}>
                    {trade.side === 'short' ? 'Short' : 'Long'}
                  </span>
                </td>
                <td className="py-2 px-3 text-right tabular-nums">{trade.entry_price?.toFixed(2) ?? '—'}</td>
                <td className="py-2 px-3 text-right tabular-nums">{trade.exit_price?.toFixed(2) ?? '—'}</td>
                <td className={`py-2 px-3 text-right tabular-nums font-medium ${win ? 'text-emerald-600' : lose ? 'text-red-500' : 'text-gray-600'}`}>
                  {trade.pnl != null ? fmtMoney(trade.pnl) : '—'}
                </td>
                <td className={`py-2 px-3 text-right tabular-nums ${win ? 'text-emerald-600' : lose ? 'text-red-500' : 'text-gray-600'}`}>
                  {trade.pnl_pct != null ? fmtPct(trade.pnl_pct) : '—'}
                </td>
                <td className={`py-2 px-3 text-right tabular-nums ${(trade.cum_profit ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
                  {trade.cum_profit != null ? fmtMoney(trade.cum_profit) : '—'}
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-emerald-600">
                  {trade.run_up != null ? fmtMoney(trade.run_up) : '—'}
                </td>
                <td className="py-2 px-3 text-right tabular-nums text-red-500">
                  {trade.drawdown != null ? fmtMoney(trade.drawdown) : '—'}
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
// Tab Button
// ================================================================
function TabBtn({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`px-4 py-2.5 text-sm font-medium border-b-2 transition-colors whitespace-nowrap ${
        active
          ? 'border-blue-500 text-blue-600'
          : 'border-transparent text-gray-500 hover:text-gray-700 hover:border-gray-300'
      }`}
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

    const avgWin = winTrades.length > 0
      ? winTrades.reduce((s, t) => s + (t.pnl ?? 0), 0) / winTrades.length : 0
    const avgLoss = loseTrades.length > 0
      ? loseTrades.reduce((s, t) => s + (t.pnl ?? 0), 0) / loseTrades.length : 0

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
      longNetProfit, shortNetProfit, longWinRate, shortWinRate,
      longPF, shortPF
    }
  }, [data])

  if (loading) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="flex items-center gap-3 text-gray-500">
          <div className="w-5 h-5 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
          載入報告中...
        </div>
      </div>
    )
  }

  if (!data || !derived) {
    return (
      <div className="min-h-screen bg-gray-50 flex items-center justify-center">
        <div className="text-center">
          <div className="text-red-500 text-lg font-semibold mb-2">無法載入報告</div>
          <button onClick={() => navigate(-1)} className="text-blue-500 text-sm hover:underline">返回</button>
        </div>
      </div>
    )
  }

  const netProfit = data.final_equity - (data.initial_capital ?? data.final_equity - (data.gross_profit + data.gross_loss))

  return (
    <div className="min-h-screen bg-gray-50">
      {/* ── Header ── */}
      <div className="bg-white border-b border-gray-200 sticky top-0 z-10">
        <div className="max-w-7xl mx-auto px-4 py-3 flex items-center gap-4">
          <button
            onClick={() => navigate(-1)}
            className="p-1.5 hover:bg-gray-100 rounded-lg transition-colors"
          >
            <ArrowLeft className="w-5 h-5 text-gray-600" />
          </button>
          <div className="flex-1 min-w-0">
            <h1 className="text-lg font-bold text-gray-900 truncate">{data.name}</h1>
            <p className="text-xs text-gray-500">
              {data.symbol} · {data.interval} · {data.start_date} – {data.end_date}
              {data.rank != null && <span className="ml-2 text-blue-500 font-medium">Rank #{data.rank}</span>}
            </p>
          </div>
          <div className="text-right hidden sm:block">
            <div className={`text-xl font-bold ${data.profit_pct >= 0 ? 'text-emerald-600' : 'text-red-500'}`}>
              {fmtPct(data.profit_pct)}
            </div>
            <div className="text-xs text-gray-400">總報酬率</div>
          </div>
        </div>

        {/* ── Tabs ── */}
        <div className="max-w-7xl mx-auto px-4 flex gap-0 overflow-x-auto">
          <TabBtn active={activeTab === 'overview'} onClick={() => setActiveTab('overview')}>績效總覽</TabBtn>
          <TabBtn active={activeTab === 'equity'} onClick={() => setActiveTab('equity')}>資金曲線</TabBtn>
          <TabBtn active={activeTab === 'monthly'} onClick={() => setActiveTab('monthly')}>月度分析</TabBtn>
          <TabBtn active={activeTab === 'trades'} onClick={() => setActiveTab('trades')}>
            交易明細 <span className="ml-1 bg-gray-200 text-gray-600 text-xs px-1.5 py-0.5 rounded-full">{data.total_trades}</span>
          </TabBtn>
          <TabBtn active={activeTab === 'settings'} onClick={() => setActiveTab('settings')}>策略設定</TabBtn>
        </div>
      </div>

      <div className="max-w-7xl mx-auto px-4 py-6">

        {/* ════════════════════════════════════════════════
            Tab 1: 績效總覽
        ════════════════════════════════════════════════ */}
        {activeTab === 'overview' && (
          <div className="space-y-6">
            {/* Top metric cards */}
            <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
              <MetricCard
                label="淨利"
                value={fmtMoney(netProfit)}
                sub={fmtPct(data.profit_pct)}
                positive={netProfit >= 0}
              />
              <MetricCard
                label="最大回撤"
                value={`${data.max_drawdown.toFixed(2)}%`}
                positive={false}
              />
              <MetricCard
                label="獲利因子"
                value={fmt(data.profit_factor)}
                positive={data.profit_factor >= 1}
              />
              <MetricCard
                label="勝率"
                value={`${fmt(data.win_rate)}%`}
                positive={data.win_rate >= 50}
              />
              <MetricCard
                label="夏普比率"
                value={fmt(data.sharpe_ratio)}
                positive={data.sharpe_ratio >= 1}
              />
              <MetricCard
                label="總交易次數"
                value={data.total_trades.toString()}
                neutral
              />
            </div>

            {/* Mini equity preview */}
            <div className="bg-white border border-gray-200 rounded-lg p-4">
              <EquityDrawdownChart equityData={data.equity_curve} trades={data.trades} />
            </div>

            {/* Detailed stats table — TV style */}
            <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
                <h2 className="font-semibold text-gray-800">詳細績效統計</h2>
                <div className="flex gap-4 text-xs text-gray-500">
                  <span className="font-medium text-gray-700">全部</span>
                  <span className="text-emerald-600 font-medium">多單</span>
                  <span className="text-red-500 font-medium">空單</span>
                </div>
              </div>
              <table className="w-full">
                <thead>
                  <tr className="bg-gray-50">
                    <th className="py-2 px-3 text-left text-xs text-gray-500 font-medium w-1/2">指標</th>
                    <th className="py-2 px-3 text-right text-xs text-gray-700 font-semibold">全部</th>
                    <th className="py-2 px-3 text-right text-xs text-emerald-600 font-semibold">多單</th>
                    <th className="py-2 px-3 text-right text-xs text-red-500 font-semibold">空單</th>
                  </tr>
                </thead>
                <tbody>
                  <StatsRow
                    label="淨利"
                    all={fmtMoney(netProfit)}
                    long={fmtMoney(derived.longNetProfit)}
                    short={fmtMoney(derived.shortNetProfit)}
                    highlight
                  />
                  <StatsRow
                    label="總獲利"
                    all={fmtMoney(data.gross_profit)}
                    long={fmtMoney(derived.longGrossProfit)}
                    short={fmtMoney(derived.shortGrossProfit)}
                  />
                  <StatsRow
                    label="總虧損"
                    all={fmtMoney(data.gross_loss)}
                    long={fmtMoney(derived.longGrossLoss)}
                    short={fmtMoney(derived.shortGrossLoss)}
                  />
                  <StatsRow
                    label="獲利因子"
                    all={fmt(data.profit_factor)}
                    long={fmt(derived.longPF)}
                    short={fmt(derived.shortPF)}
                    highlight
                  />
                  <StatsRow
                    label="最大回撤"
                    all={`${fmt(data.max_drawdown)}%`}
                    long="—"
                    short="—"
                  />
                  <StatsRow
                    label="夏普比率"
                    all={fmt(data.sharpe_ratio)}
                    long="—"
                    short="—"
                    highlight
                  />
                  <StatsRow
                    label="總交易次數"
                    all={data.total_trades.toString()}
                    long={derived.longTrades.length.toString()}
                    short={derived.shortTrades.length.toString()}
                  />
                  <StatsRow
                    label="獲利交易"
                    all={derived.winTrades.length.toString()}
                    long={derived.longWin.length.toString()}
                    short={derived.shortWin.length.toString()}
                    highlight
                  />
                  <StatsRow
                    label="虧損交易"
                    all={derived.loseTrades.length.toString()}
                    long={(derived.longTrades.length - derived.longWin.length).toString()}
                    short={(derived.shortTrades.length - derived.shortWin.length).toString()}
                  />
                  <StatsRow
                    label="勝率"
                    all={`${fmt(data.win_rate)}%`}
                    long={`${fmt(derived.longWinRate)}%`}
                    short={`${fmt(derived.shortWinRate)}%`}
                    highlight
                  />
                  <StatsRow
                    label="平均獲利"
                    all={fmtMoney(derived.avgWin)}
                    long="—"
                    short="—"
                  />
                  <StatsRow
                    label="平均虧損"
                    all={fmtMoney(derived.avgLoss)}
                    long="—"
                    short="—"
                    highlight
                  />
                  <StatsRow
                    label="最終權益"
                    all={`$${data.final_equity.toLocaleString()}`}
                    long="—"
                    short="—"
                  />
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════
            Tab 2: 資金曲線
        ════════════════════════════════════════════════ */}
        {activeTab === 'equity' && (
          <div className="space-y-4">
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <div className="flex items-center justify-between mb-4">
                <h2 className="font-semibold text-gray-800">資金曲線 + 回撤</h2>
                <div className="flex gap-4 text-xs text-gray-500">
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-6 h-0.5 bg-emerald-500 rounded" />
                    資金曲線
                  </span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-6 h-0.5 bg-red-400 rounded border-dashed border-t border-red-400" />
                    回撤
                  </span>
                </div>
              </div>
              <EquityDrawdownChart equityData={data.equity_curve} trades={data.trades} />
            </div>

            {/* Summary under chart */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <MetricCard label="初始資金" value={`$${(data.initial_capital ?? 10000).toLocaleString()}`} neutral />
              <MetricCard label="最終權益" value={`$${data.final_equity.toLocaleString()}`} positive={data.final_equity >= (data.initial_capital ?? 0)} />
              <MetricCard label="最大回撤" value={`${fmt(data.max_drawdown)}%`} positive={false} />
              <MetricCard label="回測K棒數" value={data.equity_curve.length.toString()} neutral />
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════
            Tab 3: 月度分析
        ════════════════════════════════════════════════ */}
        {activeTab === 'monthly' && (
          <div className="space-y-6">
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h2 className="font-semibold text-gray-800 mb-4">月度盈虧熱力圖</h2>
              <MonthlyHeatmap data={data.monthly_pnl} />
              <MonthlyBarChart data={data.monthly_pnl} />
            </div>
          </div>
        )}

        {/* ════════════════════════════════════════════════
            Tab 4: 交易明細
        ════════════════════════════════════════════════ */}
        {activeTab === 'trades' && (
          <div className="bg-white border border-gray-200 rounded-lg overflow-hidden">
            <div className="px-4 py-3 border-b border-gray-200 flex items-center justify-between">
              <h2 className="font-semibold text-gray-800">交易明細</h2>
              <span className="text-sm text-gray-500">{data.total_trades} 筆交易 · 點擊欄位標題可排序</span>
            </div>
            <TradeTable trades={data.trades} />
          </div>
        )}

        {/* ════════════════════════════════════════════════
            Tab 5: 策略設定
        ════════════════════════════════════════════════ */}
        {activeTab === 'settings' && (
          <div className="grid md:grid-cols-2 gap-6">
            {/* Backtest settings */}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h2 className="font-semibold text-gray-800 mb-4">回測設定</h2>
              <table className="w-full text-sm">
                <tbody>
                  {[
                    ['標的', data.symbol],
                    ['週期', data.interval],
                    ['市場類型', data.market_type],
                    ['測試開始', data.start_date],
                    ['測試結束', data.end_date],
                    ['初始資金', data.initial_capital != null ? `$${data.initial_capital.toLocaleString()}` : '—'],
                    ['手續費類型', data.commission_type ?? '—'],
                    ['手續費值', data.commission_value != null ? (data.commission_type === 'percent' ? `${data.commission_value}%` : `$${data.commission_value}`) : '—'],
                    ['儲存時間', new Date(data.saved_at).toLocaleString('zh-TW')],
                  ].map(([label, val]) => (
                    <tr key={label} className="border-b border-gray-100">
                      <td className="py-2.5 text-gray-500">{label}</td>
                      <td className="py-2.5 text-right font-medium text-gray-800">{val}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            {/* Strategy params */}
            <div className="bg-white border border-gray-200 rounded-lg p-6">
              <h2 className="font-semibold text-gray-800 mb-4">策略參數</h2>
              {Object.keys(data.params).length === 0 ? (
                <div className="text-gray-400 text-sm">無參數資料</div>
              ) : (
                <table className="w-full text-sm">
                  <tbody>
                    {Object.entries(data.params).map(([key, val]) => (
                      <tr key={key} className="border-b border-gray-100">
                        <td className="py-2.5 text-gray-500 font-mono">{key}</td>
                        <td className="py-2.5 text-right font-semibold text-blue-600">{val}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
