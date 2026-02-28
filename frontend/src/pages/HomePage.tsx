// HomePage.tsx
// v1.3.0 - 2026-03-01
// 首頁：市場概覽（24h走勢 + 點擊跳全頁KLineChart）+ 策略概覽（strategyStore）+ 近期回測活動（/api/strategies/activities）

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStrategyStore, Strategy } from '../store/strategyStore'
import { Edit2, Trash2, Plus } from 'lucide-react'

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------
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
  symbol?: string
  interval?: string
  saved_at?: string
  profit_pct?: number
  win_rate?: number
  max_drawdown?: number
  total_trades?: number
  type?: string
}

// ----------------------------------------------------------------------------
// Constants
// ----------------------------------------------------------------------------
const MARKET_SYMBOLS = [
  { symbol: 'BTCUSDT', label: 'BTC / USD' },
  { symbol: 'ETHUSDT', label: 'ETH / USD' },
  { symbol: 'SOLUSDT', label: 'SOL / USD' },
  { symbol: 'BNBUSDT', label: 'BNB / USD' },
]
const API_BASE = ((import.meta as any).env?.VITE_API_URL ?? '').replace(/\/$/, '')

// ----------------------------------------------------------------------------
// Mini spark line chart (24h)
// ----------------------------------------------------------------------------
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

// ----------------------------------------------------------------------------
// MAIN COMPONENT
// ----------------------------------------------------------------------------
export default function HomePage() {
  const navigate = useNavigate()
  const { strategies, fetchStrategies, deleteStrategy } = useStrategyStore()
  const [tickers, setTickers] = useState<MarketTicker[]>([])
  const [activities, setActivities] = useState<Activity[]>([])
  const [loadingActivities, setLoadingActivities] = useState(false)
  const isMountedRef = useRef(false)

  // 1) Fetch market tickers in parallel — 24h hourly candles
  const fetchMarketData = useCallback(async () => {
    const init: MarketTicker[] = MARKET_SYMBOLS.map(s => ({
      ...s,
      candles: [],
      latest_price: 0,
      change_pct: 0,
      loading: true
    }))
    setTickers(init)
    const results = await Promise.allSettled(
      MARKET_SYMBOLS.map(async (s) => {
        try {
          // 24h走勢：1h K線，取24根
          const url = `https://api.binance.com/api/v3/klines?symbol=${s.symbol}&interval=1h&limit=24`
          const res = await fetch(url)
          if (!res.ok) throw new Error(`HTTP ${res.status}`)
          const data = await res.json()
          const candles: Candle[] = data.map((k: any) => ({
            t: k[0] / 1000,
            o: parseFloat(k[1]),
            h: parseFloat(k[2]),
            l: parseFloat(k[3]),
            c: parseFloat(k[4]),
            v: parseFloat(k[5])
          }))
          const latest = candles[candles.length - 1]?.c ?? 0
          const prev = candles[0]?.o ?? 1
          const pct = ((latest - prev) / prev) * 100
          return { ...s, candles, latest_price: latest, change_pct: pct, loading: false }
        } catch (err: any) {
          return { ...s, candles: [], latest_price: 0, change_pct: 0, loading: false, error: err.message }
        }
      })
    )
    const tickersData = results.map((r, i) =>
      r.status === 'fulfilled' ? r.value : { ...MARKET_SYMBOLS[i], candles: [], latest_price: 0, change_pct: 0, loading: false, error: 'Failed' }
    )
    setTickers(tickersData)
  }, [])

  // 2) Fetch recent activity records from backend
  const fetchActivities = useCallback(async () => {
    setLoadingActivities(true)
    try {
      const res = await fetch(`${API_BASE}/api/strategies/activities`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      const arr: Activity[] = Array.isArray(data) ? data : data.activities ?? []
      // Only show type=activity records
      const filtered = arr.filter(a => !a.type || a.type === 'activity')
      setActivities(filtered.slice(0, 10))
    } catch (err) {
      console.error('Failed to fetch activities:', err)
      setActivities([])
    } finally {
      setLoadingActivities(false)
    }
  }, [])

  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true
      fetchMarketData()
      fetchActivities()
      fetchStrategies()
    }
  }, [fetchMarketData, fetchActivities, fetchStrategies])

  // 3) UI helpers
  const formatPrice = (v?: number) => {
    if (v == null || isNaN(v)) return '$0.000000'
    if (v >= 1000) return `$${v.toFixed(2)}`
    if (v >= 1) return `$${v.toFixed(4)}`
    return `$${v.toFixed(6)}`
  }
  const pctColor = (val?: number) => {
    if (val == null || isNaN(val)) return 'text-green-400'
    return val >= 0 ? 'text-green-400' : 'text-red-400'
  }
  const formatPct = (val?: number) => {
    if (val == null || isNaN(val)) return '+0.00%'
    return `${val >= 0 ? '+' : ''}${val.toFixed(2)}%`
  }

  return (
    <div className="min-h-screen bg-gray-900 text-gray-100">

      {/* ── 市場概覽 ── */}
      <div className="px-6 pt-6">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-base font-semibold text-gray-200">市場概覽</span>
          <span className="text-xs px-2 py-0.5 rounded bg-green-500/20 text-green-400 font-medium">+ LIVE</span>
          <a href="/chart" className="ml-auto text-xs text-blue-400 hover:text-blue-300">查看所有市場</a>
        </div>

        <div className="grid grid-cols-2 xl:grid-cols-4 gap-4 mb-8">
          {tickers.map(t => {
            const lineColor = t.change_pct >= 0 ? '#10B981' : '#EF4444'
            return (
              <div
                key={t.symbol}
                onClick={() => navigate(`/chart?symbol=${t.symbol}&interval=1h`)}
                className="bg-gray-800 rounded-xl p-4 cursor-pointer hover:bg-gray-750 hover:border-blue-500 border border-gray-700 transition-all"
              >
                <div className="flex justify-between items-start mb-1">
                  <span className="text-xs text-gray-400">{t.label}</span>
                  <span className={`text-xs font-semibold ${pctColor(t.change_pct)}`}>
                    {t.loading ? '+0.00%' : formatPct(t.change_pct)}
                  </span>
                </div>
                <div className="text-2xl font-bold text-white mb-2">
                  {t.loading ? '$0.000000' : formatPrice(t.latest_price)}
                </div>
                <SparkLine candles={t.candles} color={lineColor} />
              </div>
            )
          })}
        </div>
      </div>

      {/* ── 策略概覽 ── */}
      <div className="px-6 mb-8">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-base font-semibold text-gray-200">策略概覽</span>
          <button
            onClick={() => navigate('/strategy')}
            className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-lg bg-yellow-500 hover:bg-yellow-400 text-gray-900 font-semibold transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            新增策略
          </button>
        </div>

        {strategies.length === 0 ? (
          <div className="bg-gray-800 rounded-xl p-6 text-center text-gray-400 border border-gray-700">
            尚無策略。點擊「新增策略」開始建立。
          </div>
        ) : (
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-700/50">
                <tr>
                  <th className="px-4 py-3 text-left text-gray-400 font-medium">策略名稱</th>
                  <th className="px-4 py-3 text-left text-gray-400 font-medium">狀態</th>
                  <th className="px-4 py-3 text-left text-gray-400 font-medium">勝率</th>
                  <th className="px-4 py-3 text-left text-gray-400 font-medium">淨利率</th>
                  <th className="px-4 py-3 text-left text-gray-400 font-medium">最大回撤</th>
                  <th className="px-4 py-3 text-right text-gray-400 font-medium">操作</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-700">
                {strategies.map((s: Strategy) => (
                  <tr key={s.id} className="hover:bg-gray-700/30 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-2.5">
                        <div className="w-7 h-7 rounded-lg bg-yellow-500/20 flex items-center justify-center">
                          <span className="text-yellow-400 text-xs">⚡</span>
                        </div>
                        <div>
                          <div className="text-white font-medium text-sm">{s.name}</div>
                          <div className="text-gray-500 text-xs">{s.description?.slice(0, 30) ?? '-'}</div>
                        </div>
                      </div>
                    </td>
                    <td className="px-4 py-3">
                      <span className="text-xs px-2 py-0.5 rounded border border-gray-500 text-gray-400">BACKTEST</span>
                    </td>
                    <td className="px-4 py-3 text-gray-300">-</td>
                    <td className="px-4 py-3 text-gray-300">-</td>
                    <td className="px-4 py-3 text-red-400">-</td>
                    <td className="px-4 py-3 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => navigate('/strategy')}
                          className="p-1.5 rounded hover:bg-gray-600 text-gray-400 hover:text-white transition-colors"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => deleteStrategy(s.id)}
                          className="p-1.5 rounded hover:bg-red-500/20 text-gray-400 hover:text-red-400 transition-colors"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* ── 近期回測活動 ── */}
      <div className="px-6 pb-8">
        <div className="flex items-center gap-3 mb-4">
          <span className="text-base font-semibold text-gray-200">近期回測活動</span>
        </div>

        {loadingActivities ? (
          <div className="bg-gray-800 rounded-xl p-6 text-center text-gray-400 border border-gray-700">載入中...</div>
        ) : activities.length === 0 ? (
          <div className="bg-gray-800 rounded-xl p-6 text-center text-gray-400 border border-gray-700">
            尚無回測活動。執行回測後會顯示於此。
          </div>
        ) : (
          <div className="bg-gray-800 rounded-xl border border-gray-700 overflow-hidden">
            {activities.map((a, idx) => (
              <div key={a.id ?? idx} className="flex items-center px-4 py-3 border-b border-gray-700 last:border-0 hover:bg-gray-700/30 transition-colors">
                <div className="w-7 h-7 rounded-full bg-green-500/20 flex items-center justify-center mr-3 flex-shrink-0">
                  <span className="text-green-400 text-xs">✓</span>
                </div>
                <div className="flex-1">
                  <div className="text-sm text-white font-medium">
                    {a.symbol ?? '-'} · {a.interval ?? '-'} · 完成
                  </div>
                  <div className="text-xs text-gray-400">
                    {a.saved_at ? new Date(a.saved_at).toLocaleDateString('zh-TW') : '-'} · 淨利率{' '}
                    <span className={a.profit_pct != null && a.profit_pct >= 0 ? 'text-green-400' : 'text-red-400'}>
                      {a.profit_pct != null ? `${a.profit_pct >= 0 ? '+' : ''}${a.profit_pct.toFixed(2)}%` : '-'}
                    </span>
                    {a.win_rate != null && (
                      <> · 勝率 <span className="text-blue-400">{(a.win_rate * 100).toFixed(1)}%</span></>
                    )}
                    {a.max_drawdown != null && (
                      <> · 回撤 <span className="text-red-400">{a.max_drawdown.toFixed(2)}%</span></>
                    )}
                    {a.total_trades != null && (
                      <> · {a.total_trades} 筆</>
                    )}
                  </div>
                </div>
                <button
                  onClick={() => navigate('/results')}
                  className="text-xs text-blue-400 hover:text-blue-300"
                >
                  查看報告
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
