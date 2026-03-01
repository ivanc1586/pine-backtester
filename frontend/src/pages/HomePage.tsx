// HomePage.tsx
// v1.4.0 - 2026-03-01
// 策略總覽點擊直接查看完整報告；近期回測活動加「看報告」按鈕

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStrategyStore, Strategy } from '../store/strategyStore'
import { Edit2, Trash2, Plus, FileText } from 'lucide-react'

// --------------------------------------------------------
// Types
// --------------------------------------------------------
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
interface Activity {
  id?: string
  name?: string
  symbol?: string
  interval?: string
  saved_at?: string
  profit_pct?: number
  win_rate?: number
  max_drawdown?: number
  total_trades?: number
  profit_factor?: number
  sharpe_ratio?: number
  type?: string
  // full report fields
  equity_curve?: number[]
  monthly_pnl?: Record<string, number>
  trades?: any[]
  params?: Record<string, number>
  final_equity?: number
  gross_profit?: number
  gross_loss?: number
  start_date?: string
  end_date?: string
  market_type?: string
  initial_capital?: number
  commission_value?: number
}

// --------------------------------------------------------
// Constants
// --------------------------------------------------------
const MARKET_SYMBOLS = [
  { symbol: 'BTCUSDT', label: 'BTC / USD' },
  { symbol: 'ETHUSDT', label: 'ETH / USD' },
  { symbol: 'SOLUSDT', label: 'SOL / USD' },
  { symbol: 'BNBUSDT', label: 'BNB / USD' },
]
const API_BASE = ((import.meta as any).env?.VITE_API_URL ?? '').replace(/\/$/, '')

// --------------------------------------------------------
// Mini spark line chart (24h)
// --------------------------------------------------------
function SparkLine({ candles, color }: { candles: Candle[]; color: string }) {
  if (!candles || candles.length < 2) return <div className="h-12 w-full bg-gray-800 rounded animate-pulse" />
  const closes = candles.map(c => c.c)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const range = max - min || 1
  const W = 160, H = 48
  const pts = closes.map((v, i) => `${(i / (closes.length - 1)) * W},${H - ((v - min) / range) * H}`).join(' ')
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full h-12">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  )
}

// --------------------------------------------------------
// MAIN COMPONENT
// --------------------------------------------------------
export default function HomePage() {
  const navigate = useNavigate()
  const { strategies, fetchStrategies, deleteStrategy } = useStrategyStore()
  const [tickers, setTickers] = useState<MarketTicker[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [loadingActivities, setLoadingActivities] = useState(false)
  const isMountedRef = useRef(false)

  // 1) Fetch market tickers in parallel — 24h hourly candles
  useEffect(() => {
    const loadTickers = async () => {
      const init: MarketTicker[] = MARKET_SYMBOLS.map(s => ({ ...s, candles: [], latest_price: 0, change_pct: 0, loading: true }))
      setTickers(init)
      const results = await Promise.allSettled(
        MARKET_SYMBOLS.map(async ({ symbol, label }) => {
          const res = await fetch(`${API_BASE}/api/market/candles?symbol=${symbol}&interval=1h&limit=24`)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data: Candle[] = await res.json()
          if (!data.length) throw new Error('No data')
          const latest = data[data.length - 1].c
          const first = data[0].o
          const change = ((latest - first) / first) * 100
          return { symbol, label, candles: data, latest_price: latest, change_pct: change, loading: false }
        })
      )
      setTickers(
        results.map((r, i) =>
          r.status === 'fulfilled'
            ? r.value
            : { ...MARKET_SYMBOLS[i], candles: [], latest_price: 0, change_pct: 0, loading: false, error: 'Failed' }
        )
      )
    }
    loadTickers()
  }, [])

  // 2) Fetch strategies from store
  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true
      fetchStrategies()
    }
  }, [fetchStrategies])

  // 3) Fetch recent activities
  const loadActivities = useCallback(async () => {
    setLoadingActivities(true)
    try {
      const res = await fetch(`${API_BASE}/api/strategies/activities?limit=5`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      // API returns { activities: [...] } or plain array
      setActivities(Array.isArray(data) ? data : (data.activities ?? []))
    } catch (err) {
      console.error('Failed to load activities:', err)
      setActivities([])
    } finally {
      setLoadingActivities(false)
    }
  }, [])

  useEffect(() => {
    loadActivities()
  }, [loadActivities])

  // 4) Delete strategy handler
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('確定刪除此策略？')) return
    await deleteStrategy(id)
  }

  // 5) Navigate to report — check sessionStorage first, then use id
  const goToReport = (id: string, activity?: Activity) => {
    if (activity && id) {
      // Cache full data in sessionStorage so ReportPage can display without re-fetch
      const cached = sessionStorage.getItem(`report_${id}`)
      if (!cached && activity.equity_curve) {
        sessionStorage.setItem(`report_${id}`, JSON.stringify({ ...activity, id }))
      }
    }
    navigate(`/report/${id}`)
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 p-6">
      <div className="max-w-7xl mx-auto space-y-6">

        {/* Header */}
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-3xl font-bold text-white">Dashboard</h1>
            <p className="text-gray-400 text-sm mt-1">市場概覽 &amp; 策略管理</p>
          </div>
        </div>

        {/* Market Overview (24h) */}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
          {tickers.map(ticker => (
            <div
              key={ticker.symbol}
              className="bg-slate-800/60 backdrop-blur border border-white/10 rounded-xl p-4 hover:border-purple-500/30 transition-all"
            >
              <div className="flex items-center justify-between mb-3">
                <div>
                  <div className="text-white font-semibold text-lg">{ticker.label}</div>
                  <div className="text-gray-500 text-xs">{ticker.symbol}</div>
                </div>
                {ticker.loading ? (
                  <div className="w-16 h-8 bg-gray-700 rounded animate-pulse" />
                ) : ticker.error ? (
                  <div className="text-red-400 text-xs">Error</div>
                ) : (
                  <div className="text-right">
                    <div className="text-white font-mono text-sm">${ticker.latest_price.toLocaleString()}</div>
                    <div className={`text-xs font-semibold ${ticker.change_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                      {ticker.change_pct >= 0 ? '+' : ''}{ticker.change_pct.toFixed(2)}%
                    </div>
                  </div>
                )}
              </div>
              <SparkLine candles={ticker.candles} color={ticker.change_pct >= 0 ? '#4ade80' : '#f87171'} />
            </div>
          ))}
        </div>

        {/* ── Strategy Overview (策略總覽) ── */}
        <div className="bg-slate-800/60 backdrop-blur border border-white/10 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white">策略總覽</h2>
            <button
              onClick={() => navigate('/strategy')}
              className="flex items-center gap-2 px-4 py-2 bg-purple-500 hover:bg-purple-600 text-white rounded-lg text-sm font-medium transition-colors"
            >
              <Plus className="w-4 h-4" />
              新增策略
            </button>
          </div>
          {strategies.length === 0 ? (
            <div className="text-gray-400 text-center py-8">尚無策略，請至參數優化頁面執行回測</div>
          ) : (
            <div className="space-y-3">
              {strategies.slice(0, 10).map((s: Strategy) => (
                <div
                  key={s.id}
                  onClick={() => goToReport(s.id)}
                  className="flex items-center justify-between p-4 bg-slate-700/40 rounded-lg hover:bg-slate-700/70 transition-colors cursor-pointer group"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-semibold group-hover:text-purple-300 transition-colors">{s.name}</div>
                    <div className="text-gray-400 text-xs mt-1">{s.symbol} • {s.interval}</div>
                  </div>
                  {/* Metrics */}
                  <div className="hidden md:flex items-center gap-6 mx-4 text-right">
                    {(s as any).profit_pct != null && (
                      <div>
                        <div className="text-xs text-gray-500">獲利率</div>
                        <div className={`text-sm font-semibold ${(s as any).profit_pct >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {(s as any).profit_pct >= 0 ? '+' : ''}{(s as any).profit_pct?.toFixed(2)}%
                        </div>
                      </div>
                    )}
                    {(s as any).max_drawdown != null && (
                      <div>
                        <div className="text-xs text-gray-500">MDD</div>
                        <div className="text-sm font-semibold text-red-400">
                          {((s as any).max_drawdown * 100).toFixed(2)}%
                        </div>
                      </div>
                    )}
                  </div>
                  <div className="flex items-center gap-2">
                    <button
                      onClick={e => { e.stopPropagation(); goToReport(s.id) }}
                      className="flex items-center gap-1 px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/40 text-purple-300 rounded-lg text-xs font-medium transition-colors"
                    >
                      <FileText className="w-3 h-3" />
                      查看報告
                    </button>
                    <button
                      onClick={e => handleDelete(s.id, e)}
                      className="p-2 hover:bg-red-500/20 rounded-lg transition-colors"
                    >
                      <Trash2 className="w-4 h-4 text-red-400" />
                    </button>
                  </div>
                </div>
              ))}
              {strategies.length > 10 && (
                <div className="text-gray-500 text-sm text-center pt-2">
                  顯示前 10 筆，共 {strategies.length} 筆策略
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Recent Activities (近期回測活動) ── */}
        <div className="bg-slate-800/60 backdrop-blur border border-white/10 rounded-xl p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-xl font-bold text-white">近期回測活動</h2>
            <button
              onClick={loadActivities}
              className="text-gray-400 hover:text-white text-xs px-3 py-1.5 bg-white/5 hover:bg-white/10 rounded-lg transition-colors"
            >
              重新整理
            </button>
          </div>
          {loadingActivities ? (
            <div className="text-gray-400 text-center py-8">載入中...</div>
          ) : activities.length === 0 ? (
            <div className="text-gray-400 text-center py-8">尚無回測記錄，執行優化後自動出現</div>
          ) : (
            <div className="space-y-3">
              {activities.map((a, idx) => (
                <div
                  key={a.id || idx}
                  className="flex items-center justify-between p-4 bg-slate-700/40 rounded-lg hover:bg-slate-700/60 transition-colors"
                >
                  <div className="flex-1 min-w-0">
                    <div className="text-white font-semibold truncate">
                      {a.name ?? `${a.type === 'backtest' ? '回測' : '優化'} - ${a.symbol} (${a.interval})`}
                    </div>
                    <div className="text-gray-400 text-xs mt-1">
                      {a.saved_at ? new Date(a.saved_at).toLocaleString('zh-TW') : '-'}
                      {a.symbol && ` · ${a.symbol}`}
                      {a.interval && ` · ${a.interval}`}
                    </div>
                  </div>
                  <div className="hidden sm:grid grid-cols-4 gap-4 text-right mx-4">
                    <div>
                      <div className="text-xs text-gray-500">獲利率</div>
                      <div className={`text-sm font-semibold ${(a.profit_pct ?? 0) >= 0 ? 'text-green-400' : 'text-red-400'}`}>
                        {(a.profit_pct ?? 0) >= 0 ? '+' : ''}{(a.profit_pct ?? 0).toFixed(2)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">勝率</div>
                      <div className="text-sm font-semibold text-white">
                        {((a.win_rate ?? 0) * 100).toFixed(1)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">MDD</div>
                      <div className="text-sm font-semibold text-red-400">
                        {((a.max_drawdown ?? 0) * 100).toFixed(2)}%
                      </div>
                    </div>
                    <div>
                      <div className="text-xs text-gray-500">盈虧比</div>
                      <div className="text-sm font-semibold text-white">
                        {(a.profit_factor ?? 0).toFixed(2)}
                      </div>
                    </div>
                  </div>
                  {a.id && (
                    <button
                      onClick={() => goToReport(a.id!, a)}
                      className="flex items-center gap-1 px-3 py-1.5 bg-purple-500/20 hover:bg-purple-500/40 text-purple-300 rounded-lg text-xs font-medium transition-colors whitespace-nowrap ml-2"
                    >
                      <FileText className="w-3 h-3" />
                      看報告
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  )
}
