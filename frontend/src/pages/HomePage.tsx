// HomePage.tsx
// v1.0.0 - 2026-02-28
// 首頁：市場概覽（主流幣走勢+價格漲跌）、策略概覽、近期優化策略

import React, { useEffect, useState, useRef, useCallback } from 'react'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }
interface MarketTicker {
  symbol: string
  label: string
  candles: Candle[]
  latest_price: number
  change_pct: number
  loading: boolean
  error?: string
}
interface SavedReport {
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
  { symbol: 'BTCUSDT', label: 'BTC' },
  { symbol: 'ETHUSDT', label: 'ETH' },
  { symbol: 'SOLUSDT', label: 'SOL' },
  { symbol: 'BNBUSDT', label: 'BNB' },
  { symbol: 'XRPUSDT', label: 'XRP' },
  { symbol: 'DOGEUSDT', label: 'DOGE' },
]
const API_BASE = ((import.meta as any).env?.VITE_API_URL ?? '') + '/api/optimize'

// ---------------------------------------------------------------------------
// Mini spark line chart
// ---------------------------------------------------------------------------
function SparkLine({ candles, color }: { candles: Candle[]; color: string }) {
  if (!candles || candles.length < 2) return <div className="h-12 w-full bg-gray-800 rounded animate-pulse" />
  const closes = candles.map(c => c.c)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const range = max - min || 1
  const W = 160, H = 48
  const pts = closes.map((v, i) => `${(i / (closes.length - 1)) * W},${H - ((v - min) / range) * H}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12 cursor-pointer">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// K線圖元件（點進去顯示）
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

  // Y axis ticks
  const yTicks = Array.from({ length: 6 }, (_, i) => {
    const v = minP + (range * i) / 5
    return { v, y: toY(v) }
  })
  // X axis ticks
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
          {/* Grid */}
          {yTicks.map(({ v, y }, i) => (
            <g key={i}>
              <line x1={PL} y1={y} x2={W - PR} y2={y} stroke="#1e1e2e" strokeWidth="1" />
              <text x={PL - 4} y={y + 4} textAnchor="end" fontSize="10" fill="#666">
                {v >= 1000 ? `${(v / 1000).toFixed(1)}k` : v.toFixed(2)}
              </text>
            </g>
          ))}
          {/* Candles */}
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
          {/* X labels */}
          {xTicks.map(({ i, label }) => (
            <text key={i} x={toX(i)} y={H - 8} textAnchor="middle" fontSize="9" fill="#555">{label}</text>
          ))}
        </svg>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Mini equity curve for report card
// ---------------------------------------------------------------------------
function MiniEquity({ data }: { data?: number[] }) {
  if (!data || data.length < 2) return <div className="h-8 bg-gray-800 rounded" />
  const W = 120, H = 32
  const min = Math.min(...data), max = Math.max(...data)
  const range = max - min || 1
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * W},${H - ((v - min) / range) * H}`).join(' ')
  const color = data[data.length - 1] >= data[0] ? '#26a69a' : '#ef5350'
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-8">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

// ---------------------------------------------------------------------------
// Report Detail Modal (完整報告視窗)
// ---------------------------------------------------------------------------
function ReportModal({ report, onClose }: { report: SavedReport; onClose: () => void }) {
  const metrics = [
    { label: '盈利率', value: `${(report.profit_pct ?? 0).toFixed(2)}%`, color: (report.profit_pct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400' },
    { label: '勝率', value: `${((report.win_rate ?? 0) * 100).toFixed(1)}%`, color: 'text-blue-400' },
    { label: 'MDD', value: `${((report.max_drawdown ?? 0) * 100).toFixed(2)}%`, color: 'text-red-400' },
    { label: '夏普', value: (report.sharpe_ratio ?? 0).toFixed(3), color: 'text-yellow-400' },
    { label: '交易次數', value: report.total_trades ?? 0, color: 'text-gray-300' },
    { label: '盈利因子', value: (report.profit_factor ?? 0).toFixed(2), color: 'text-purple-400' },
    { label: '最終資金', value: `$${(report.final_equity ?? 0).toLocaleString()}`, color: 'text-gray-300' },
    { label: '總盈利', value: `$${(report.gross_profit ?? 0).toFixed(2)}`, color: 'text-green-400' },
    { label: '總虧損', value: `$${(report.gross_loss ?? 0).toFixed(2)}`, color: 'text-red-400' },
  ]

  // Equity curve
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
          {/* Header */}
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
            {/* Metrics grid */}
            <div className="grid grid-cols-3 gap-3">
              {metrics.map(m => (
                <div key={m.label} className="bg-gray-800 rounded-lg p-3">
                  <div className="text-gray-500 text-xs mb-1">{m.label}</div>
                  <div className={`text-lg font-bold ${m.color}`}>{m.value}</div>
                </div>
              ))}
            </div>

            {/* Equity curve */}
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

            {/* Monthly PnL */}
            {report.monthly_pnl && Object.keys(report.monthly_pnl).length > 0 && (
              <div>
                <h3 className="text-gray-300 text-sm font-semibold mb-2">每月績效</h3>
                <div className="bg-gray-800 rounded-lg p-3 overflow-x-auto">
                  <div className="flex gap-1 min-w-max">
                    {Object.entries(report.monthly_pnl).sort(([a], [b]) => a.localeCompare(b)).map(([month, val]) => {
                      const isPos = val >= 0
                      return (
                        <div key={month} className="flex flex-col items-center gap-0.5" title={`${month}: ${val >= 0 ? '+' : ''}${val.toFixed(2)}`}>
                          <div className={`text-xs ${isPos ? 'text-green-400' : 'text-red-400'}`}>
                            {isPos ? '+' : ''}{val.toFixed(0)}
                          </div>
                          <div className={`w-6 rounded-sm ${isPos ? 'bg-green-500' : 'bg-red-500'}`}
                            style={{ height: `${Math.max(4, Math.abs(val) / Math.max(...Object.values(report.monthly_pnl!).map(Math.abs), 1) * 40)}px` }} />
                          <div className="text-gray-600 text-xs">{month.slice(5)}</div>
                          <div className="text-gray-700 text-xs">{month.slice(0, 4)}</div>
                        </div>
                      )
                    })}
                  </div>
                </div>
              </div>
            )}

            {/* Parameters */}
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

            {/* TV-style detailed stats */}
            <div>
              <h3 className="text-gray-300 text-sm font-semibold mb-2">詳細統計</h3>
              <div className="bg-gray-800 rounded-lg divide-y divide-gray-700">
                {[
                  ['淨利潤', `$${((report.final_equity ?? 10000) - 10000).toFixed(2)}`],
                  ['總盈利', `$${(report.gross_profit ?? 0).toFixed(2)}`],
                  ['總虧損', `$${(report.gross_loss ?? 0).toFixed(2)}`],
                  ['盈利因子', (report.profit_factor ?? 0).toFixed(3)],
                  ['最大回撤', `${((report.max_drawdown ?? 0) * 100).toFixed(2)}%`],
                  ['夏普比率', (report.sharpe_ratio ?? 0).toFixed(3)],
                  ['勝率', `${((report.win_rate ?? 0) * 100).toFixed(2)}%`],
                  ['交易次數', report.total_trades ?? 0],
                  ['回測期間', `${report.start_date} ~ ${report.end_date}`],
                  ['交易對', `${report.symbol} (${report.market_type === 'futures' ? '期貨' : '現貨'})`],
                  ['時間週期', report.interval ?? '-'],
                ].map(([label, value]) => (
                  <div key={String(label)} className="flex justify-between px-4 py-2.5">
                    <span className="text-gray-400 text-sm">{label}</span>
                    <span className="text-white text-sm font-medium">{value}</span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// HomePage component
// ---------------------------------------------------------------------------
export default function HomePage() {
  const [tickers, setTickers] = useState<MarketTicker[]>(
    MARKET_SYMBOLS.map(s => ({ ...s, candles: [], latest_price: 0, change_pct: 0, loading: true }))
  )
  const [reports, setReports] = useState<SavedReport[]>([])
  const [reportsLoading, setReportsLoading] = useState(true)
  const [selectedCandle, setSelectedCandle] = useState<{ symbol: string; candles: Candle[] } | null>(null)
  const [selectedReport, setSelectedReport] = useState<SavedReport | null>(null)

  // Fetch market data
  useEffect(() => {
    MARKET_SYMBOLS.forEach(async ({ symbol, label }, idx) => {
      try {
        const res = await fetch(`${API_BASE}/candles?symbol=${symbol}&interval=1h&limit=48`)
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

  // Fetch reports
  useEffect(() => {
    fetch(`${API_BASE}/reports?limit=10`)
      .then(r => r.json())
      .then(data => { setReports(data.reports ?? []); setReportsLoading(false) })
      .catch(() => setReportsLoading(false))
  }, [])

  const formatPrice = (p: number) => {
    if (p >= 1000) return p.toLocaleString('en-US', { maximumFractionDigits: 2 })
    if (p >= 1) return p.toFixed(4)
    return p.toFixed(6)
  }

  return (
    <div className="min-h-screen bg-gray-950 text-white p-6 space-y-8">
      {/* -- 市場概覽 -- */}
      <section>
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <span className="w-1 h-5 bg-blue-500 rounded-full inline-block" />
          市場概覽
        </h2>
        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
          {tickers.map(ticker => {
            const isUp = ticker.change_pct >= 0
            const color = isUp ? '#26a69a' : '#ef5350'
            return (
              <div key={ticker.symbol}
                className="bg-gray-900 border border-gray-800 rounded-xl p-3 cursor-pointer hover:border-gray-600 transition-all"
                onClick={() => !ticker.loading && ticker.candles.length > 0 &&
                  setSelectedCandle({ symbol: ticker.symbol, candles: ticker.candles })}>
                <div className="flex justify-between items-start mb-2">
                  <span className="text-white font-bold text-sm">{ticker.label}</span>
                  <span className={`text-xs font-semibold ${isUp ? 'text-green-400' : 'text-red-400'}`}>
                    {isUp ? '+' : ''}{ticker.change_pct.toFixed(2)}%
                  </span>
                </div>
                {ticker.loading ? (
                  <div className="h-12 bg-gray-800 rounded animate-pulse mb-2" />
                ) : (
                  <SparkLine candles={ticker.candles} color={color} />
                )}
                <div className="text-white font-mono text-sm mt-1">
                  {ticker.loading ? '載入中...' : `$${formatPrice(ticker.latest_price)}`}
                </div>
                <div className="text-gray-600 text-xs mt-0.5">點擊查看 K 線</div>
              </div>
            )
          })}
        </div>
      </section>

      {/* -- 近期優化策略 -- */}
      <section>
        <h2 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
          <span className="w-1 h-5 bg-purple-500 rounded-full inline-block" />
          近期優化策略
        </h2>
        {reportsLoading ? (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {[1,2,3].map(i => <div key={i} className="bg-gray-900 rounded-xl h-40 animate-pulse" />)}
          </div>
        ) : reports.length === 0 ? (
          <div className="bg-gray-900 border border-gray-800 rounded-xl p-8 text-center text-gray-500">
            尚無優化記錄。前往優化頁面執行第一次回測！
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {reports.map((r, i) => {
              const isPos = (r.profit_pct ?? 0) >= 0
              return (
                <div key={i}
                  className="bg-gray-900 border border-gray-800 rounded-xl p-4 cursor-pointer hover:border-gray-600 transition-all"
                  onClick={() => setSelectedReport(r)}>
                  <div className="flex justify-between items-start mb-3">
                    <div>
                      <div className="text-white font-semibold text-sm">{r.strategy_name || r.symbol}</div>
                      <div className="text-gray-500 text-xs mt-0.5">
                        {r.symbol} {r.market_type === 'futures' ? '永續' : '現貨'} · {r.interval}
                      </div>
                    </div>
                    <div className={`text-lg font-bold ${isPos ? 'text-green-400' : 'text-red-400'}`}>
                      {isPos ? '+' : ''}{(r.profit_pct ?? 0).toFixed(2)}%
                    </div>
                  </div>
                  <MiniEquity data={r.equity_curve} />
                  <div className="grid grid-cols-4 gap-1 mt-3">
                    <div className="text-center">
                      <div className="text-gray-500 text-xs">MDD</div>
                      <div className="text-red-400 text-xs font-semibold">{((r.max_drawdown ?? 0) * 100).toFixed(1)}%</div>
                    </div>
                    <div className="text-center">
                      <div className="text-gray-500 text-xs">勝率</div>
                      <div className="text-blue-400 text-xs font-semibold">{((r.win_rate ?? 0) * 100).toFixed(1)}%</div>
                    </div>
                    <div className="text-center">
                      <div className="text-gray-500 text-xs">交易數</div>
                      <div className="text-gray-300 text-xs font-semibold">{r.total_trades ?? 0}</div>
                    </div>
                    <div className="text-center">
                      <div className="text-gray-500 text-xs">夏普</div>
                      <div className="text-yellow-400 text-xs font-semibold">{(r.sharpe_ratio ?? 0).toFixed(2)}</div>
                    </div>
                  </div>
                  <div className="text-gray-700 text-xs mt-2 text-right">
                    {r.start_date} ~ {r.end_date}
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </section>

      {/* K線圖 modal */}
      {selectedCandle && (
        <CandlestickChart
          candles={selectedCandle.candles}
          symbol={selectedCandle.symbol}
          onClose={() => setSelectedCandle(null)}
        />
      )}

      {/* Report modal */}
      {selectedReport && (
        <ReportModal report={selectedReport} onClose={() => setSelectedReport(null)} />
      )}
    </div>
  )
}
