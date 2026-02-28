// HomePage.tsx
// v2.0.0 - 2026-02-28
// 首頁：市場概覽（主流幣走勢+價格漲跌）、策略概覽表格、最近優化活動

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import {
  TrendingUp, Plus, Edit2, Trash2, Clock, CheckCircle,
  BarChart2, Activity
} from 'lucide-react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
interface MarketTicker {
  symbol: string
  label: string
  pair: string
  candles: Candle[]
  latest_price: number
  change_pct: number
  loading: boolean
  error?: string
}
interface SavedReport {
  id?: string
  rank?: number
  symbol?: string
  market_type?: string
  interval?: string
  start_date?: string
  end_date?: string
  strategy_name?: string
  saved_at?: string
  profit_pct?: number
  win_rate?: number
  max_drawdown?: number
  sharpe_ratio?: number
  total_trades?: number
  profit_factor?: number
  final_equity?: number
  gross_profit?: number
  gross_loss?: number
  params?: Record<string, number>
  monthly_pnl?: Record<string, number>
  equity_curve?: number[]
}

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const MARKET_SYMBOLS = [
  { symbol: 'BTCUSDT', label: 'BTC', pair: 'BTC / USD' },
  { symbol: 'ETHUSDT', label: 'ETH', pair: 'ETH / USD' },
  { symbol: 'SOLUSDT', label: 'SOL', pair: 'SOL / USD' },
  { symbol: 'BNBUSDT', label: 'BNB', pair: 'BNB / USD' },
]

// API_BASE: 只取到 origin，不含 /api/optimize
const _envUrl = ((import.meta as any).env?.VITE_API_URL ?? '').replace(/\/$/, '')
const API_BASE = _envUrl || 'http://localhost:8000'

// ---------------------------------------------------------------------------
// Mini spark line chart
// ---------------------------------------------------------------------------
function SparkLine({ candles, isUp }: { candles: Candle[]; isUp: boolean }) {
  if (!candles || candles.length < 2) return <div className="h-12 w-full" />
  const closes = candles.map(c => c.c)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const range = max - min || 1
  const W = 160, H = 48
  const pts = closes.map((v, i) => `${(i / (closes.length - 1)) * W},${H - ((v - min) / range) * H}`).join(' ')
  const color = isUp ? '#ef5350' : '#26a69a'
  const fillPts = `0,${H} ${pts} ${W},${H}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12" preserveAspectRatio="none">
      <defs>
        <linearGradient id={`sg-${isUp}`} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={fillPts} fill={`url(#sg-${isUp})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// K線圖 Modal
// ---------------------------------------------------------------------------
function CandlestickChart({ candles, symbol, onClose }: { candles: Candle[]; symbol: string; onClose: () => void }) {
  if (!candles || candles.length === 0) return null
  const W = 900, H = 360, PL = 60, PR = 20, PT = 20, PB = 40
  const chartW = W - PL - PR
  const chartH = H - PT - PB
  const visibleCandles = candles.slice(-120)
  const highs = visibleCandles.map(c => c.h)
  const lows = visibleCandles.map(c => c.l)
  const minP = Math.min(...lows)
  const maxP = Math.max(...highs)
  const range = maxP - minP || 1
  const candleW = Math.max(3, Math.floor(chartW / visibleCandles.length) - 1)
  const toX = (i: number) => PL + (i + 0.5) * (chartW / visibleCandles.length)
  const toY = (v: number) => PT + (1 - (v - minP) / range) * chartH
  const yTicks = Array.from({ length: 6 }, (_, i) => {
    const v = minP + (range * i) / 5
    return { v, y: toY(v) }
  })
  const xStep = Math.max(1, Math.floor(visibleCandles.length / 8))
  const xTicks = visibleCandles
    .map((c, i) => ({ i, label: new Date(c.t).toLocaleDateString('zh-TW', { month: 'numeric', day: 'numeric' }) }))
    .filter((_, i) => i % xStep === 0)

  return (
    <div className="fixed inset-0 z-50 bg-black/80 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-gray-900 rounded-xl p-4 w-full max-w-5xl" onClick={e => e.stopPropagation()}>
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-white font-bold text-lg">{symbol} K 線圖</h3>
          <button onClick={onClose} className="text-gray-400 hover:text-white text-xl">✕</button>
        </div>
        <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 360 }}>
          {yTicks.map(({ v, y }, i) => (
            <g key={i}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#1e1e2e" strokeWidth="1" />
              <text x={PL - 4} y={y + 4} textAnchor="end" fontSize="10" fill="#666">
                {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(2)}
              </text>
            </g>
          ))}
          {visibleCandles.map((c, i) => {
            const x = toX(i)
            const isUp = c.c >= c.o
            const color = isUp ? '#26a69a' : '#ef5350'
            const bodyTop = toY(Math.max(c.o, c.c))
            const bodyH = Math.max(1, Math.abs(toY(c.o) - toY(c.c)))
            return (
              <g key={i}>
                <line x1={x} y1={toY(c.h)} x2={x} y2={toY(c.l)} stroke={color} strokeWidth="1" />
                <rect x={x - candleW / 2} y={bodyTop} width={candleW} height={bodyH} fill={color} />
              </g>
            )
          })}
          {xTicks.map(({ i, label }) => (
            <text key={i} x={toX(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#555">{label}</text>
          ))}
        </svg>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mini equity curve for strategy row
// ---------------------------------------------------------------------------
function MiniEquity({ data }: { data?: number[] }) {
  if (!data || data.length < 2) return <div className="h-8 bg-gray-800 rounded" />
  const W = 80, H = 28
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * H}`).join(' ')
  const color = data[data.length - 1] >= data[0] ? '#26a69a' : '#ef5350'
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: 80, height: 28 }}>
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Report Detail Modal
// ---------------------------------------------------------------------------
function ReportModal({ report, onClose }: { report: SavedReport; onClose: () => void }) {
  // win_rate: 後端回傳 0~100 的百分比值（與 OptimizePage 結果表一致）
  // max_drawdown: 後端回傳 0~100 的百分比值
  const metrics = [
    { label: '盈利率', value: `${(report.profit_pct ?? 0).toFixed(2)}%`, color: (report.profit_pct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400' },
    { label: '勝率', value: `${(report.win_rate ?? 0).toFixed(1)}%`, color: 'text-blue-400' },
    { label: 'MDD', value: `${(report.max_drawdown ?? 0).toFixed(2)}%`, color: 'text-red-400' },
    { label: '夏普', value: (report.sharpe_ratio ?? 0).toFixed(3), color: 'text-yellow-400' },
    { label: '交易次數', value: String(report.total_trades ?? 0), color: 'text-gray-300' },
    { label: '盈利因子', value: (report.profit_factor ?? 0).toFixed(2), color: 'text-purple-400' },
    { label: '最終資金', value: `$${(report.final_equity ?? 0).toLocaleString()}`, color: 'text-gray-300' },
    { label: '總盈利', value: `$${(report.gross_profit ?? 0).toFixed(2)}`, color: 'text-green-400' },
    { label: '總虧損', value: `$${(report.gross_loss ?? 0).toFixed(2)}`, color: 'text-red-400' },
  ]
  const eq = report.equity_curve ?? []
  const eqMin = eq.length > 0 ? Math.min(...eq) : 0
  const eqMax = eq.length > 0 ? Math.max(...eq) : 1
  const eqRange = eqMax - eqMin || 1
  const EW = 800, EH = 160, EPL = 48, EPR = 8, EPT = 8, EPB = 24
  const eqPts = eq.map((v, i) => `${EPL + (i / Math.max(eq.length - 1, 1)) * (EW - EPL - EPR)},${EPT + (1 - (v - eqMin) / eqRange) * (EH - EPT - EPB)}`).join(' ')
  const eqColor = eq.length > 1 && eq[eq.length - 1] >= eq[0] ? '#26a69a' : '#ef5350'

  return (
    <div className="fixed inset-0 z-50 bg-black/80 overflow-y-auto" onClick={onClose}>
      <div className="min-h-screen flex items-start justify-center p-4 py-8">
        <div className="bg-gray-900 rounded-xl w-full max-w-4xl" onClick={e => e.stopPropagation()}>
          <div className="flex justify-between items-center p-5 border-b border-gray-700">
            <div>
              <h2 className="text-white text-xl font-bold">{report.strategy_name || '策略報告'}</h2>
              <p className="text-gray-400 text-sm mt-1">
                {report.symbol} {report.market_type === 'futures' ? '永續合約' : '現貨'} · {report.interval} ·{' '}
                {report.start_date} ~ {report.end_date}
              </p>
              {report.saved_at && (
                <p className="text-gray-600 text-xs mt-0.5">儲存於 {new Date(report.saved_at).toLocaleString('zh-TW')}</p>
              )}
            </div>
            <button onClick={onClose} className="text-gray-400 hover:text-white text-2xl">✕</button>
          </div>
          <div className="p-5 space-y-6">
            <div className="grid grid-cols-3 gap-3">
              {metrics.map(m => (
                <div key={m.label} className="bg-gray-800 rounded-lg p-3">
                  <div className="text-gray-500 text-xs mb-1">{m.label}</div>
                  <div className={`text-lg font-bold ${m.color}`}>{m.value}</div>
                </div>
              ))}
            </div>
            {eq.length > 1 && (
              <div>
                <h3 className="text-gray-300 text-sm font-semibold mb-2">資產曲線</h3>
                <div className="bg-gray-800 rounded-lg p-3">
                  <svg viewBox={`0 0 ${EW} ${EH}`} className="w-full" style={{ height: 160 }}>
                    <polyline points={eqPts} fill="none" stroke={eqColor} strokeWidth="1.5" />
                    <line x1={EPL} y1={EPT + (EH - EPT - EPB) / 2} x2={EW - EPR} y2={EPT + (EH - EPT - EPB) / 2}
                      stroke="#444" strokeWidth="0.5" strokeDasharray="4,3" />
                  </svg>
                </div>
              </div>
            )}
            {report.params && Object.keys(report.params).length > 0 && (
              <div>
                <h3 className="text-gray-300 text-sm font-semibold mb-2">最佳參數</h3>
                <div className="bg-gray-800 rounded-lg p-3 grid grid-cols-2 gap-2">
                  {Object.entries(report.params).map(([k, v]) => (
                    <div key={k} className="flex justify-between items-center">
                      <span className="text-gray-400 text-sm">{k}</span>
                      <span className="text-white font-mono text-sm">{typeof v === 'number' ? v.toFixed(Number.isInteger(v) ? 0 : 4) : String(v)}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Strategy icon by index
// ---------------------------------------------------------------------------
function StrategyIcon({ index }: { index: number }) {
  const icons = [
    <svg key="0" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><path d="M13 10V3L4 14h7v7l9-11h-7z"/></svg>,
    <svg key="1" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><polyline points="22 7 13.5 15.5 8.5 10.5 2 17"/><polyline points="16 7 22 7 22 13"/></svg>,
    <svg key="2" viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" strokeWidth="2"><rect x="2" y="3" width="4" height="18"/><rect x="10" y="8" width="4" height="13"/><rect x="18" y="5" width="4" height="16"/></svg>,
  ]
  const colors = ['#f0b90b', '#26a69a', '#9b59b6', '#e67e22', '#3498db']
  const bgColors = ['rgba(240,185,11,0.15)', 'rgba(38,166,154,0.15)', 'rgba(155,89,182,0.15)', 'rgba(230,126,34,0.15)', 'rgba(52,152,219,0.15)']
  const i = index % icons.length
  const c = index % colors.length
  return (
    <div style={{
      width: 32, height: 32, borderRadius: 8, display: 'flex', alignItems: 'center', justifyContent: 'center',
      background: bgColors[c], color: colors[c], flexShrink: 0,
    }}>
      {icons[i]}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Win rate bar
// ---------------------------------------------------------------------------
function WinRateBar({ pct }: { pct: number }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
      <span style={{ fontSize: 13, fontWeight: 600, color: '#d1d4dc', minWidth: 36 }}>{pct.toFixed(0)}%</span>
      <div style={{ flex: 1, height: 4, background: '#2b2b43', borderRadius: 2, minWidth: 60 }}>
        <div style={{ height: '100%', width: `${Math.min(pct, 100)}%`, background: '#3b82f6', borderRadius: 2 }} />
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HomePage component
// ---------------------------------------------------------------------------
export default function HomePage() {
  const navigate = useNavigate()
  const [tickers, setTickers] = useState<MarketTicker[]>(
    MARKET_SYMBOLS.map(s => ({ ...s, candles: [], latest_price: 0, change_pct: 0, loading: true }))
  )
  const [reports, setReports] = useState<SavedReport[]>([])
  const [reportsLoading, setReportsLoading] = useState(true)
  const [selectedCandle, setSelectedCandle] = useState<{ symbol: string; candles: Candle[] } | null>(null)
  const [selectedReport, setSelectedReport] = useState<SavedReport | null>(null)

  // ── 市場資料（打正確路徑 /api/optimize/candles）──
  useEffect(() => {
    MARKET_SYMBOLS.forEach(async ({ symbol, label }, idx) => {
      try {
        const res = await fetch(`${API_BASE}/api/optimize/candles?symbol=${symbol}&interval=1h&limit=48`)
        if (!res.ok) throw new Error(res.statusText)
        const data = await res.json()
        setTickers(prev => prev.map((t, i) => i === idx
          ? { ...t, candles: data.candles, latest_price: data.latest_price, change_pct: data.change_pct, loading: false }
          : t
        ))
      } catch (e) {
        setTickers(prev => prev.map((t, i) => i === idx
          ? { ...t, loading: false, error: String(e) }
          : t
        ))
      }
    })
  }, [])

  // ── 讀取報告 ──
  useEffect(() => {
    fetch(`${API_BASE}/api/optimize/reports?limit=20`)
      .then(r => r.json())
      .then(data => { setReports(data.reports ?? []); setReportsLoading(false) })
      .catch(() => setReportsLoading(false))
  }, [])

  const formatPrice = (p: number) => {
    if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 })
    if (p >= 1) return p.toFixed(4)
    return p.toFixed(6)
  }

  // 最近 5 筆活動
  const recentActivity = [...reports]
    .sort((a, b) => new Date(b.saved_at ?? 0).getTime() - new Date(a.saved_at ?? 0).getTime())
    .slice(0, 5)

  return (
    <div style={{ minHeight: '100vh', background: '#0b0e17', color: '#d1d4dc', padding: '24px 24px' }}>

      {/* ── 市場概覽 ── */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <Activity size={18} color="#26a69a" />
            <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>市場概覽</span>
            <span style={{ fontSize: 10, padding: '2px 7px', borderRadius: 10, background: 'rgba(38,166,154,0.15)', color: '#26a69a', border: '1px solid rgba(38,166,154,0.3)', fontWeight: 600 }}>+ LIVE</span>
          </div>
          <button
            style={{ fontSize: 12, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}
            onClick={() => {/* TODO: navigate to market page */}}
          >
            查看所有市場
          </button>
        </div>

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
          {tickers.map((ticker, idx) => {
            const isDown = ticker.change_pct < 0
            return (
              <div
                key={ticker.symbol}
                style={{
                  background: '#131722', border: '1px solid #1e2330', borderRadius: 12,
                  padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.2s',
                }}
                onClick={() => !ticker.loading && ticker.candles.length > 0 &&
                  setSelectedCandle({ symbol: ticker.symbol, candles: ticker.candles })}
                onMouseEnter={e => (e.currentTarget as HTMLElement).style.borderColor = '#2b3347'}
                onMouseLeave={e => (e.currentTarget as HTMLElement).style.borderColor = '#1e2330'}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
                  <span style={{ fontSize: 11, color: '#848e9c' }}>{ticker.pair}</span>
                  <span style={{ fontSize: 11, fontWeight: 700, color: isDown ? '#ef5350' : '#26a69a' }}>
                    {isDown ? '' : '+'}{ticker.change_pct.toFixed(2)}%
                  </span>
                </div>
                <div style={{ fontSize: 22, fontWeight: 700, color: '#fff', marginBottom: 8, fontFamily: 'monospace' }}>
                  {ticker.loading ? '...' : `$${formatPrice(ticker.latest_price)}`}
                </div>
                {ticker.loading ? (
                  <div style={{ height: 48, background: '#1e222d', borderRadius: 4 }} />
                ) : (
                  <SparkLine candles={ticker.candles} isUp={!isDown} />
                )}
              </div>
            )
          })}
        </div>
      </section>

      {/* ── 策略概覽 ── */}
      <section style={{ marginBottom: 32 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <BarChart2 size={18} color="#9b59b6" />
            <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>策略概覽</span>
          </div>
          <button
            onClick={() => navigate('/optimize')}
            style={{
              display: 'flex', alignItems: 'center', gap: 6,
              padding: '6px 14px', borderRadius: 6, border: '1px solid rgba(240,185,11,0.35)',
              background: 'rgba(240,185,11,0.1)', color: '#f0b90b',
              fontSize: 12, cursor: 'pointer', fontWeight: 600,
            }}
          >
            <Plus size={13} /> 新增策略
          </button>
        </div>

        <div style={{ background: '#131722', border: '1px solid #1e2330', borderRadius: 12, overflow: 'hidden' }}>
          {/* Table header */}
          <div style={{
            display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr',
            padding: '10px 20px', borderBottom: '1px solid #1e2330',
            fontSize: 11, color: '#848e9c', fontWeight: 600,
          }}>
            <span>策略名稱</span>
            <span>狀態</span>
            <span>勝率</span>
            <span>淨利率</span>
            <span>最大回撤</span>
            <span style={{ textAlign: 'right' }}>操作</span>
          </div>

          {reportsLoading ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#848e9c', fontSize: 13 }}>載入中...</div>
          ) : reports.length === 0 ? (
            <div style={{ padding: 40, textAlign: 'center', color: '#848e9c', fontSize: 13 }}>
              尚無策略記錄。<button onClick={() => navigate('/optimize')} style={{ color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontSize: 13 }}>前往優化頁面</button>執行第一次回測！
            </div>
          ) : (
            reports.map((r, idx) => {
              const isPos = (r.profit_pct ?? 0) >= 0
              const stratName = r.strategy_name || `${r.symbol} ${r.interval}`
              const subLabel = `${r.symbol} · ${r.interval}`
              return (
                <div
                  key={idx}
                  style={{
                    display: 'grid', gridTemplateColumns: '2fr 1fr 1fr 1fr 1fr 1fr',
                    padding: '14px 20px', borderBottom: '1px solid #0f1219',
                    alignItems: 'center', cursor: 'pointer', transition: 'background 0.15s',
                  }}
                  onClick={() => setSelectedReport(r)}
                  onMouseEnter={e => (e.currentTarget as HTMLElement).style.background = 'rgba(255,255,255,0.025)'}
                  onMouseLeave={e => (e.currentTarget as HTMLElement).style.background = 'transparent'}
                >
                  {/* 策略名稱 */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <StrategyIcon index={idx} />
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e3eb' }}>{stratName}</div>
                      <div style={{ fontSize: 11, color: '#848e9c', marginTop: 1 }}>{subLabel}</div>
                    </div>
                  </div>

                  {/* 狀態 */}
                  <div>
                    <span style={{
                      fontSize: 10, padding: '3px 9px', borderRadius: 4, fontWeight: 700,
                      border: '1px solid #2b3347', color: '#848e9c', background: '#1a1e2b',
                      letterSpacing: '0.05em',
                    }}>
                      BACKTEST
                    </span>
                  </div>

                  {/* 勝率 */}
                  <div>
                    <WinRateBar pct={r.win_rate ?? 0} />
                  </div>

                  {/* 淨利率 */}
                  <div style={{ fontSize: 13, fontWeight: 700, color: isPos ? '#26a69a' : '#ef5350' }}>
                    {isPos ? '+' : ''}{(r.profit_pct ?? 0).toFixed(2)}%
                  </div>

                  {/* 最大回撤 */}
                  <div style={{ fontSize: 13, fontWeight: 600, color: '#ef5350' }}>
                    -{(r.max_drawdown ?? 0).toFixed(1)}%
                  </div>

                  {/* 操作 */}
                  <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 6 }} onClick={e => e.stopPropagation()}>
                    <button
                      title="查看報告"
                      onClick={() => setSelectedReport(r)}
                      style={{ padding: '5px 7px', borderRadius: 5, border: '1px solid #2b3347', background: '#1a1e2b', color: '#848e9c', cursor: 'pointer' }}
                    >
                      <Edit2 size={13} />
                    </button>
                    <button
                      title="刪除"
                      style={{ padding: '5px 7px', borderRadius: 5, border: '1px solid rgba(239,83,80,0.3)', background: 'rgba(239,83,80,0.08)', color: '#ef5350', cursor: 'pointer' }}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              )
            })
          )}
        </div>
      </section>

      {/* ── 最近優化活動 ── */}
      <section>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 16 }}>
          <Clock size={18} color="#f0b90b" />
          <span style={{ fontSize: 16, fontWeight: 700, color: '#fff' }}>最近優化活動</span>
        </div>

        <div style={{ background: '#131722', border: '1px solid #1e2330', borderRadius: 12, overflow: 'hidden' }}>
          {reportsLoading ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#848e9c', fontSize: 13 }}>載入中...</div>
          ) : recentActivity.length === 0 ? (
            <div style={{ padding: 32, textAlign: 'center', color: '#848e9c', fontSize: 13 }}>尚無優化記錄</div>
          ) : (
            recentActivity.map((r, idx) => {
              const isPos = (r.profit_pct ?? 0) >= 0
              const dateStr = r.saved_at
                ? new Date(r.saved_at).toLocaleDateString('zh-TW', { year: 'numeric', month: 'numeric', day: 'numeric' })
                : ''
              return (
                <div
                  key={idx}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '16px 20px', borderBottom: idx < recentActivity.length - 1 ? '1px solid #0f1219' : 'none',
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                    <div style={{
                      width: 32, height: 32, borderRadius: '50%', background: 'rgba(38,166,154,0.15)',
                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}>
                      <CheckCircle size={16} color="#26a69a" />
                    </div>
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: '#e0e3eb' }}>
                        {r.symbol} · {r.interval} · 完成
                      </div>
                      <div style={{ fontSize: 11, color: '#848e9c', marginTop: 2 }}>
                        {dateStr} · 淨利率 <span style={{ color: isPos ? '#26a69a' : '#ef5350', fontWeight: 600 }}>
                          {isPos ? '+' : ''}{(r.profit_pct ?? 0).toFixed(2)}%
                        </span>
                      </div>
                    </div>
                  </div>
                  <button
                    onClick={() => setSelectedReport(r)}
                    style={{ fontSize: 12, color: '#3b82f6', background: 'none', border: 'none', cursor: 'pointer', fontWeight: 500 }}
                  >
                    查看報告
                  </button>
                </div>
              )
            })
          )}
        </div>
      </section>

      {/* K線圖 Modal */}
      {selectedCandle && (
        <CandlestickChart
          candles={selectedCandle.candles}
          symbol={selectedCandle.symbol}
          onClose={() => setSelectedCandle(null)}
        />
      )}

      {/* Report Modal */}
      {selectedReport && (
        <ReportModal report={selectedReport} onClose={() => setSelectedReport(null)} />
      )}
    </div>
  )
}
