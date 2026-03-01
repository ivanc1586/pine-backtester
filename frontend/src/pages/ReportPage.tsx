// =============================================================================
// ReportPage.tsx  v1.0.0
// -----------------------------------------------------------------------------
// 完整報告頁面 /report/:id
// 從 /api/strategies/:id 取得資料，顯示：
//   - 回測設定（標的、週期、日期範圍、初始資金、手續費）
//   - 核心績效指標
//   - 資金曲線 (Equity Curve)
//   - 回撤曲線 (Drawdown Curve)
//   - 月度盈虧柱狀圖 (Monthly PnL)
//   - 詳細統計（交易統計 + 最佳化參數 + 交易明細列表）
// =============================================================================

import React, { useEffect, useState } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, TrendingUp, TrendingDown, Activity, BarChart2, Calendar, DollarSign, Percent, Hash } from 'lucide-react'

const API_BASE = ((import.meta as any).env?.VITE_API_URL ?? '').replace(/\/$/, '')

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface TradeRecord {
  entry_time?: string
  exit_time?: string
  side?: string
  pnl?: number
  entry_price?: number
  exit_price?: number
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
  // settings
  initial_capital?: number
  commission_type?: string
  commission_value?: number
  // core metrics
  profit_pct: number
  win_rate: number
  max_drawdown: number
  profit_factor: number
  sharpe_ratio: number
  total_trades: number
  final_equity: number
  gross_profit: number
  gross_loss: number
  // chart data
  equity_curve: number[]
  monthly_pnl: Record<string, number>
  trades: TradeRecord[]
  params: Record<string, number>
  rank?: number
}

// ---------------------------------------------------------------------------
// SVG Equity Curve
// ---------------------------------------------------------------------------
function EquityCurve({ data }: { data: number[] }) {
  if (!data || data.length < 2) return (
    <div className="h-48 flex items-center justify-center text-gray-500 text-sm">無資金曲線資料</div>
  )
  const W = 800, H = 200, PL = 60, PR = 12, PT = 12, PB = 28
  const chartW = W - PL - PR
  const chartH = H - PT - PB
  const minV = Math.min(...data)
  const maxV = Math.max(...data)
  const range = maxV - minV || 1
  const toX = (i: number) => PL + (i / (data.length - 1)) * chartW
  const toY = (v: number) => PT + (1 - (v - minV) / range) * chartH
  const pts = data.map((v, i) => `${toX(i)},${toY(v)}`).join(' ')
  const fillPts = `${PL},${PT + chartH} ${pts} ${PL + chartW},${PT + chartH}`
  const isPositive = data[data.length - 1] >= data[0]
  const color = isPositive ? '#26a69a' : '#ef5350'
  const yTicks = Array.from({ length: 5 }, (_, i) => {
    const v = minV + (range * i) / 4
    return { v, y: toY(v) }
  })
  const xTicks = [0, 0.25, 0.5, 0.75, 1].map(frac => {
    const i = Math.min(Math.floor(frac * (data.length - 1)), data.length - 1)
    return { x: toX(i), label: `${i + 1}` }
  })
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 200 }}>
      <defs>
        <linearGradient id="eq-grad-r" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.35" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      {yTicks.map(({ v, y }, i) => (
        <g key={i}>
          <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#2a2a3a" strokeWidth="0.5" />
          <text x={PL - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#666">
            {v >= 10000 ? `${(v / 1000).toFixed(0)}k` : v.toFixed(0)}
          </text>
        </g>
      ))}
      <polygon points={fillPts} fill="url(#eq-grad-r)" />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="2" />
      {xTicks.map(({ x, label }, i) => (
        <text key={i} x={x} y={H - 6} textAnchor="middle" fontSize="9" fill="#555">{label}</text>
      ))}
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Drawdown Curve
// ---------------------------------------------------------------------------
function DrawdownCurve({ data }: { data: number[] }) {
  if (!data || data.length < 2) return (
    <div className="h-36 flex items-center justify-center text-gray-500 text-sm">無回撤資料</div>
  )
  // compute running max and drawdown %
  const dd: number[] = []
  let peak = data[0]
  for (const v of data) {
    if (v > peak) peak = v
    dd.push(peak > 0 ? ((v - peak) / peak) * 100 : 0)
  }
  const W = 800, H = 150, PL = 52, PR = 12, PT = 8, PB = 24
  const chartW = W - PL - PR
  const chartH = H - PT - PB
  const minV = Math.min(...dd)
  const maxV = 0
  const range = maxV - minV || 1
  const toX = (i: number) => PL + (i / (dd.length - 1)) * chartW
  const toY = (v: number) => PT + (1 - (v - minV) / range) * chartH
  const pts = dd.map((v, i) => `${toX(i)},${toY(v)}`).join(' ')
  const fillPts = `${PL},${toY(0)} ${pts} ${PL + chartW},${toY(0)}`
  const yTicks = [0, -25, -50, -75, -100].filter(v => v >= minV - 5)
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 150 }}>
      <defs>
        <linearGradient id="dd-grad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ef5350" stopOpacity="0.05" />
          <stop offset="100%" stopColor="#ef5350" stopOpacity="0.4" />
        </linearGradient>
      </defs>
      {yTicks.map((v, i) => (
        <g key={i}>
          <line x1={PL} y1={toY(v)} x2={W - PR} y2={toY(v)} stroke="#2a2a3a" strokeWidth="0.5" />
          <text x={PL - 4} y={toY(v) + 4} textAnchor="end" fontSize="9" fill="#666">{v}%</text>
        </g>
      ))}
      <polygon points={fillPts} fill="url(#dd-grad)" />
      <polyline points={pts} fill="none" stroke="#ef5350" strokeWidth="1.5" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Monthly PnL Bar Chart
// ---------------------------------------------------------------------------
function MonthlyBarChart({ data, initialCapital }: { data: Record<string, number>; initialCapital?: number }) {
  const entries = Object.entries(data).sort(([a], [b]) => a.localeCompare(b))
  if (entries.length === 0) return (
    <div className="h-32 flex items-center justify-center text-gray-500 text-sm">無月度資料</div>
  )
  const values = entries.map(([, v]) => v)
  const maxAbs = Math.max(...values.map(Math.abs), 1)
  const barW = Math.max(8, Math.min(32, Math.floor(740 / entries.length) - 3))
  const H = 130, midY = 65, maxBarH = 55
  const [tooltip, setTooltip] = React.useState<{ x: number; y: number; text: string } | null>(null)
  return (
    <div className="relative">
      <svg viewBox={`0 0 ${Math.max(740, entries.length * (barW + 3))} ${H + 30}`} className="w-full overflow-visible">
        <line x1="0" y1={midY} x2="100%" y2={midY} stroke="#444" strokeWidth="1" />
        {entries.map(([month, val], i) => {
          const x = i * (barW + 3) + 1
          const barH = Math.abs(val) / maxAbs * maxBarH
          const y = val >= 0 ? midY - barH : midY
          const color = val >= 0 ? '#26a69a' : '#ef5350'
          const monthLabel = month.slice(5)
          const year = month.slice(0, 4)
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
              <rect x={x} y={y} width={barW} height={Math.max(barH, 1)} fill={color} opacity="0.85" rx="2" />
              <text x={x + barW / 2} y={H + 12} textAnchor="middle" fontSize="8" fill="#666">{monthLabel}</text>
              {showYear && (
                <text x={x + barW / 2} y={H + 24} textAnchor="middle" fontSize="8" fill="#888">{year}</text>
              )}
            </g>
          )
        })}
      </svg>
      {tooltip && (
        <div className="absolute z-10 bg-gray-900 border border-gray-600 text-white text-xs px-2 py-1 rounded pointer-events-none whitespace-pre"
          style={{ left: tooltip.x, top: tooltip.y - 36, transform: 'translateX(-50%)' }}>
          {tooltip.text}
        </div>
      )}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Metric Card
// ---------------------------------------------------------------------------
function MetricCard({ label, value, sub, color }: { label: string; value: string; sub?: string; color?: string }) {
  return (
    <div style={{
      background: 'rgba(255,255,255,0.04)',
      border: '1px solid #2b2b43',
      borderRadius: 8,
      padding: '14px 16px',
    }}>
      <div style={{ fontSize: 11, color: '#848e9c', marginBottom: 4 }}>{label}</div>
      <div style={{ fontSize: 20, fontWeight: 700, color: color ?? '#d1d4dc' }}>{value}</div>
      {sub && <div style={{ fontSize: 10, color: '#666', marginTop: 2 }}>{sub}</div>}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------
export default function ReportPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const [data, setData] = useState<ReportData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!id) { setError('無效的報告 ID'); setLoading(false); return }
    // Check sessionStorage first (for OptimizePage inline results not yet persisted)
    const cached = sessionStorage.getItem(`report_${id}`)
    if (cached) {
      try {
        setData(JSON.parse(cached))
        setLoading(false)
        return
      } catch (_) {}
    }
    // Fetch from backend
    fetch(`${API_BASE}/api/strategies/${id}`)
      .then(r => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`)
        return r.json()
      })
      .then((d: ReportData) => { setData(d); setLoading(false) })
      .catch(err => { setError(`載入失敗：${err.message}`); setLoading(false) })
  }, [id])

  const card: React.CSSProperties = {
    background: '#1e222d',
    border: '1px solid #2b2b43',
    borderRadius: 12,
    padding: '20px 24px',
    marginBottom: 20,
  }

  if (loading) return (
    <div style={{ minHeight: '100vh', background: '#131722', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
      <div style={{ color: '#848e9c', fontSize: 16 }}>載入報告中...</div>
    </div>
  )

  if (error || !data) return (
    <div style={{ minHeight: '100vh', background: '#131722', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
      <div style={{ color: '#ef5350', fontSize: 16 }}>{error || '找不到報告'}</div>
      <button onClick={() => navigate('/')} style={{ color: '#848e9c', cursor: 'pointer', background: 'none', border: 'none', fontSize: 14 }}>← 返回首頁</button>
    </div>
  )

  const profitColor = data.profit_pct >= 0 ? '#26a69a' : '#ef5350'
  const winTrades = data.trades ? data.trades.filter(t => (t.pnl ?? 0) > 0).length : 0
  const lossTrades = data.trades ? data.trades.filter(t => (t.pnl ?? 0) <= 0).length : 0
  const avgWin = winTrades > 0
    ? (data.trades.filter(t => (t.pnl ?? 0) > 0).reduce((s, t) => s + (t.pnl ?? 0), 0) / winTrades)
    : 0
  const avgLoss = lossTrades > 0
    ? (data.trades.filter(t => (t.pnl ?? 0) <= 0).reduce((s, t) => s + (t.pnl ?? 0), 0) / lossTrades)
    : 0

  return (
    <div style={{ minHeight: '100vh', background: '#131722', color: '#d1d4dc', fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif' }}>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 20px' }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, marginBottom: 24 }}>
          <button
            onClick={() => navigate(-1)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: 'rgba(255,255,255,0.06)', border: '1px solid #2b2b43', borderRadius: 8, padding: '8px 14px', color: '#848e9c', cursor: 'pointer', fontSize: 13 }}
          >
            <ArrowLeft size={14} /> 返回
          </button>
          <div>
            <h1 style={{ fontSize: 22, fontWeight: 700, color: '#d1d4dc', margin: 0 }}>{data.name}</h1>
            <div style={{ fontSize: 12, color: '#848e9c', marginTop: 3 }}>
              {data.type === 'activity' ? '自動儲存（優化第一名）' : '手動儲存策略'} · 儲存於 {data.saved_at ? new Date(data.saved_at).toLocaleString('zh-TW') : '-'}
            </div>
          </div>
        </div>

        {/* ── 1. 回測設定 ── */}
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#848e9c', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <Calendar size={14} /> 回測設定
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 12 }}>
            {[
              { label: '測試標的', value: data.symbol },
              { label: '市場類型', value: data.market_type === 'futures' ? '期貨' : '現貨' },
              { label: '週期', value: data.interval },
              { label: '開始日期', value: data.start_date || '-' },
              { label: '結束日期', value: data.end_date || '-' },
              { label: '初始資金', value: data.initial_capital != null ? `$${data.initial_capital.toLocaleString()}` : '-' },
              { label: '手續費', value: data.commission_value != null ? `${(data.commission_value * 100).toFixed(3)}%` : '-' },
            ].map(({ label, value }) => (
              <div key={label} style={{ background: 'rgba(255,255,255,0.03)', border: '1px solid #2b2b43', borderRadius: 6, padding: '10px 12px' }}>
                <div style={{ fontSize: 10, color: '#666', marginBottom: 3 }}>{label}</div>
                <div style={{ fontSize: 13, fontWeight: 600, color: '#d1d4dc' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ── 2. 核心績效指標 ── */}
        <div style={card}>
          <div style={{ fontSize: 13, fontWeight: 600, color: '#848e9c', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
            <TrendingUp size={14} /> 核心績效指標
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 12 }}>
            <MetricCard label="淨利潤 %" value={`${data.profit_pct >= 0 ? '+' : ''}${data.profit_pct.toFixed(2)}%`} color={profitColor} />
            <MetricCard label="最終資金" value={`$${(data.final_equity ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} color={profitColor} />
            <MetricCard label="總盈利" value={`$${(data.gross_profit ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} color="#26a69a" />
            <MetricCard label="總虧損" value={`$${(data.gross_loss ?? 0).toLocaleString(undefined, { maximumFractionDigits: 0 })}`} color="#ef5350" />
            <MetricCard label="最大回撤 (MDD)" value={`${(data.max_drawdown * 100).toFixed(2)}%`} color="#ef5350" />
            <MetricCard label="盈虧比" value={(data.profit_factor ?? 0).toFixed(2)} />
            <MetricCard label="夏普比率" value={(data.sharpe_ratio ?? 0).toFixed(2)} />
            <MetricCard label="勝率" value={`${(data.win_rate * 100).toFixed(1)}%`} />
            <MetricCard label="總交易筆數" value={String(data.total_trades)} />
          </div>
        </div>

        {/* ── 3. 資金曲線 ── */}
        {data.equity_curve && data.equity_curve.length > 1 && (
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#848e9c', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Activity size={14} /> 資金曲線 (Equity Curve)
            </div>
            <EquityCurve data={data.equity_curve} />
          </div>
        )}

        {/* ── 4. 回撤曲線 ── */}
        {data.equity_curve && data.equity_curve.length > 1 && (
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#848e9c', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              <TrendingDown size={14} /> 回撤曲線 (Drawdown)
            </div>
            <DrawdownCurve data={data.equity_curve} />
          </div>
        )}

        {/* ── 5. 月度盈虧 ── */}
        {data.monthly_pnl && Object.keys(data.monthly_pnl).length > 0 && (
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#848e9c', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              <BarChart2 size={14} /> 月度盈虧 (Monthly PnL)
            </div>
            <MonthlyBarChart data={data.monthly_pnl} initialCapital={data.initial_capital} />
          </div>
        )}

        {/* ── 6. 詳細資訊（TV 風格）── */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 20 }}>

          {/* 交易統計 */}
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#848e9c', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Hash size={14} /> 交易統計
            </div>
            {[
              ['總交易次數', String(data.total_trades)],
              ['獲利交易數', `${winTrades} (${data.total_trades > 0 ? (winTrades / data.total_trades * 100).toFixed(1) : 0}%)`],
              ['虧損交易數', `${lossTrades} (${data.total_trades > 0 ? (lossTrades / data.total_trades * 100).toFixed(1) : 0}%)`],
              ['平均獲利', `$${avgWin.toFixed(2)}`],
              ['平均虧損', `$${avgLoss.toFixed(2)}`],
              ['總盈利', `$${(data.gross_profit ?? 0).toFixed(2)}`],
              ['總虧損', `$${(data.gross_loss ?? 0).toFixed(2)}`],
              ['盈虧比', (data.profit_factor ?? 0).toFixed(3)],
              ['夏普比率', (data.sharpe_ratio ?? 0).toFixed(3)],
              ['最大回撤', `${(data.max_drawdown * 100).toFixed(2)}%`],
            ].map(([label, value]) => (
              <div key={label} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #1e2130', fontSize: 12 }}>
                <span style={{ color: '#848e9c' }}>{label}</span>
                <span style={{ color: '#d1d4dc', fontWeight: 500 }}>{value}</span>
              </div>
            ))}
          </div>

          {/* 最佳化參數 */}
          <div style={card}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#848e9c', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              <Percent size={14} /> 最佳化參數
            </div>
            {data.params && Object.keys(data.params).length > 0 ? (
              Object.entries(data.params).map(([key, val]) => (
                <div key={key} style={{ display: 'flex', justifyContent: 'space-between', padding: '7px 0', borderBottom: '1px solid #1e2130', fontSize: 12 }}>
                  <span style={{ color: '#848e9c' }}>{key}</span>
                  <span style={{ color: '#f0b90b', fontWeight: 600 }}>{typeof val === 'number' ? val.toLocaleString() : String(val)}</span>
                </div>
              ))
            ) : (
              <div style={{ color: '#555', fontSize: 12 }}>無參數資料</div>
            )}
          </div>
        </div>

        {/* ── 7. 交易明細列表 ── */}
        {data.trades && data.trades.length > 0 && (
          <div style={{ ...card, marginTop: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: '#848e9c', marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
              <DollarSign size={14} /> 交易明細
              <span style={{ fontSize: 11, background: 'rgba(255,255,255,0.08)', padding: '2px 8px', borderRadius: 20, marginLeft: 4 }}>
                {data.trades.length} 筆
              </span>
            </div>
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 11 }}>
                <thead>
                  <tr style={{ background: 'rgba(255,255,255,0.04)' }}>
                    {['#', '方向', '進場時間', '出場時間', '進場價', '出場價', '盈虧'].map(h => (
                      <th key={h} style={{ padding: '8px 10px', textAlign: 'left', color: '#848e9c', fontWeight: 500, borderBottom: '1px solid #2b2b43', whiteSpace: 'nowrap' }}>{h}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {data.trades.slice(0, 200).map((t, i) => {
                    const pnlColor = (t.pnl ?? 0) > 0 ? '#26a69a' : (t.pnl ?? 0) < 0 ? '#ef5350' : '#848e9c'
                    return (
                      <tr key={i} style={{ borderBottom: '1px solid #1e2130' }}>
                        <td style={{ padding: '7px 10px', color: '#555' }}>{i + 1}</td>
                        <td style={{ padding: '7px 10px' }}>
                          <span style={{
                            padding: '2px 7px', borderRadius: 4, fontSize: 10, fontWeight: 600,
                            background: t.side === 'long' ? 'rgba(38,166,154,0.15)' : 'rgba(239,83,80,0.15)',
                            color: t.side === 'long' ? '#26a69a' : '#ef5350',
                          }}>
                            {t.side === 'long' ? '多' : t.side === 'short' ? '空' : t.side ?? '-'}
                          </span>
                        </td>
                        <td style={{ padding: '7px 10px', color: '#d1d4dc', whiteSpace: 'nowrap' }}>{t.entry_time ?? '-'}</td>
                        <td style={{ padding: '7px 10px', color: '#d1d4dc', whiteSpace: 'nowrap' }}>{t.exit_time ?? '-'}</td>
                        <td style={{ padding: '7px 10px', color: '#d1d4dc' }}>{t.entry_price != null ? t.entry_price.toLocaleString() : '-'}</td>
                        <td style={{ padding: '7px 10px', color: '#d1d4dc' }}>{t.exit_price != null ? t.exit_price.toLocaleString() : '-'}</td>
                        <td style={{ padding: '7px 10px', color: pnlColor, fontWeight: 600 }}>
                          {t.pnl != null ? `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}` : '-'}
                        </td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
              {data.trades.length > 200 && (
                <div style={{ textAlign: 'center', padding: '12px 0', color: '#555', fontSize: 11 }}>
                  僅顯示前 200 筆，共 {data.trades.length} 筆
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}
