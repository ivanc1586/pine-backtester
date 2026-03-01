// ================================================================
// HomePage.tsx  v2.0.0 - 2026-03-01
// ----------------------------------------------------------------
// #3  回測結果暫存：goToReport 寫入 sessionStorage，30min TTL
// #5  擴增幣對（主流 + XAUUSDT/XAGUSDT）+ 查看所有市場 Modal
// #6  首頁暗色主題統一（#131722 / #1e222d）+ 策略/活動改 SQLite 後更快
// #7  幣對卡片版面：幣名左上、大價格左中、漲跌右上、迷你K線底部
// #8  Binance WebSocket 即時更新幣對卡片價格與漲跌
// ================================================================

import React, { useEffect, useState, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useStrategyStore, Strategy } from '../store/strategyStore'
import { Trash2, Plus, FileText, RefreshCw, X, TrendingUp, TrendingDown } from 'lucide-react'

const API_BASE = ((import.meta as any).env?.VITE_API_URL ?? '').replace(/\/$/, '')

// ── colour tokens (same as OptimizePage / ReportPage) ───────────
const C = {
  bg:     '#131722',
  card:   '#1e222d',
  border: '#2b2b43',
  text:   '#d1d4dc',
  muted:  '#848e9c',
  green:  '#26a69a',
  red:    '#ef5350',
  gold:   '#f0b90b',
  blue:   '#2962ff',
  hover:  '#2a2e39',
  purple: '#7c3aed',
}

// ================================================================
// Types
// ================================================================
interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

interface TickerState {
  symbol:       string
  label:        string
  name:         string
  price:        number
  change_pct:   number
  candles:      Candle[]
  loading:      boolean
  error?:       string
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
  created_at?: string
}

// ================================================================
// All symbols
// ================================================================
const ALL_SYMBOLS: { symbol: string; label: string; name: string }[] = [
  { symbol: 'BTCUSDT',   label: 'BTC/USDT',  name: 'Bitcoin'   },
  { symbol: 'ETHUSDT',   label: 'ETH/USDT',  name: 'Ethereum'  },
  { symbol: 'SOLUSDT',   label: 'SOL/USDT',  name: 'Solana'    },
  { symbol: 'BNBUSDT',   label: 'BNB/USDT',  name: 'BNB'       },
  { symbol: 'XRPUSDT',   label: 'XRP/USDT',  name: 'XRP'       },
  { symbol: 'ADAUSDT',   label: 'ADA/USDT',  name: 'Cardano'   },
  { symbol: 'DOGEUSDT',  label: 'DOGE/USDT', name: 'Dogecoin'  },
  { symbol: 'AVAXUSDT',  label: 'AVAX/USDT', name: 'Avalanche' },
  { symbol: 'DOTUSDT',   label: 'DOT/USDT',  name: 'Polkadot'  },
  { symbol: 'LINKUSDT',  label: 'LINK/USDT', name: 'Chainlink' },
  { symbol: 'MATICUSDT', label: 'MATIC/USDT',name: 'Polygon'   },
  { symbol: 'LTCUSDT',   label: 'LTC/USDT',  name: 'Litecoin'  },
  { symbol: 'UNIUSDT',   label: 'UNI/USDT',  name: 'Uniswap'   },
  { symbol: 'ATOMUSDT',  label: 'ATOM/USDT', name: 'Cosmos'    },
  { symbol: 'XAUUSDT',   label: 'XAU/USDT',  name: 'Gold'      },
  { symbol: 'XAGUSDT',   label: 'XAG/USDT',  name: 'Silver'    },
]

// Default 4 shown in dashboard
const DEFAULT_SYMBOLS = ALL_SYMBOLS.slice(0, 4)

// ================================================================
// SparkLine SVG
// ================================================================
function SparkLine({ candles, color }: { candles: Candle[]; color: string }) {
  if (!candles || candles.length < 2) {
    return <div style={{ height: 48, background: 'rgba(255,255,255,0.03)', borderRadius: 4 }} />
  }
  const closes = candles.map(c => c.c)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const range = max - min || 1
  const W = 200, H = 48
  const pts = closes.map((v, i) =>
    `${(i / (closes.length - 1)) * W},${H - ((v - min) / range) * (H - 4) - 2}`
  ).join(' ')
  const fillPts = `0,${H} ${pts} ${W},${H}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 48 }}>
      <defs>
        <linearGradient id={`spark-${color.replace('#','')}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <polygon points={fillPts} fill={`url(#spark-${color.replace('#','')})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

// ================================================================
// Ticker Card — #7 layout: name top-left, big price mid-left, change top-right, sparkline bottom
// ================================================================
function TickerCard({ ticker, onClick }: { ticker: TickerState; onClick: () => void }) {
  const isUp = ticker.change_pct >= 0
  const color = isUp ? C.green : C.red

  const formatPrice = (p: number) => {
    if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    if (p >= 1)    return p.toFixed(4)
    return p.toFixed(6)
  }

  return (
    <div
      onClick={onClick}
      style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
        padding: '14px 16px', cursor: 'pointer', transition: 'border-color 0.15s',
        display: 'flex', flexDirection: 'column', gap: 4,
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = C.purple + '80')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
    >
      {/* Row 1: name + change badge */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{ticker.label}</div>
          <div style={{ fontSize: 11, color: C.muted }}>{ticker.name}</div>
        </div>
        {ticker.loading ? (
          <div style={{ width: 56, height: 22, background: C.hover, borderRadius: 4, animation: 'pulse 1.5s infinite' }} />
        ) : ticker.error ? (
          <div style={{ fontSize: 11, color: C.red }}>Error</div>
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 4,
            background: isUp ? 'rgba(38,166,154,0.15)' : 'rgba(239,83,80,0.15)',
            color, borderRadius: 6, padding: '3px 8px', fontSize: 12, fontWeight: 700,
          }}>
            {isUp ? <TrendingUp style={{ width: 12, height: 12 }} /> : <TrendingDown style={{ width: 12, height: 12 }} />}
            {ticker.change_pct >= 0 ? '+' : ''}{ticker.change_pct.toFixed(2)}%
          </div>
        )}
      </div>

      {/* Row 2: big price */}
      <div style={{ fontSize: 20, fontWeight: 700, color: C.text, letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums' }}>
        {ticker.loading ? (
          <div style={{ width: 100, height: 24, background: C.hover, borderRadius: 4 }} />
        ) : ticker.error ? '—' : `$${formatPrice(ticker.price)}`}
      </div>

      {/* Row 3: sparkline */}
      <SparkLine candles={ticker.candles} color={color} />
    </div>
  )
}

// ================================================================
// All Markets Modal
// ================================================================
function AllMarketsModal({
  tickers, onClose, onSelect,
}: {
  tickers: TickerState[]
  onClose: () => void
  onSelect: (symbol: string) => void
}) {
  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.7)',
      zIndex: 100, display: 'flex', alignItems: 'center', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        style={{
          background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
          width: '90%', maxWidth: 720, maxHeight: '80vh', display: 'flex', flexDirection: 'column',
          overflow: 'hidden',
        }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{
          padding: '16px 20px', borderBottom: `1px solid ${C.border}`,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        }}>
          <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>所有市場</span>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: C.muted }}>
            <X style={{ width: 18, height: 18 }} />
          </button>
        </div>
        {/* List */}
        <div style={{ overflowY: 'auto', padding: '8px 0' }}>
          {tickers.map(t => {
            const isUp = t.change_pct >= 0
            const color = isUp ? C.green : C.red
            return (
              <div
                key={t.symbol}
                onClick={() => { onSelect(t.symbol); onClose() }}
                style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  padding: '10px 20px', cursor: 'pointer',
                }}
                onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                onMouseLeave={e => (e.currentTarget.style.background = 'transparent')}
              >
                <div>
                  <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{t.label}</div>
                  <div style={{ fontSize: 11, color: C.muted }}>{t.name}</div>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <div style={{ fontSize: 14, fontWeight: 600, color: C.text, fontVariantNumeric: 'tabular-nums' }}>
                    {t.loading ? '...' : t.error ? '—' : `$${t.price >= 1000 ? t.price.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : t.price.toFixed(4)}`}
                  </div>
                  <div style={{ fontSize: 12, fontWeight: 600, color }}>
                    {t.loading ? '' : `${isUp ? '+' : ''}${t.change_pct.toFixed(2)}%`}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

// ================================================================
// MAIN COMPONENT
// ================================================================
export default function HomePage() {
  const navigate = useNavigate()
  const { strategies, fetchStrategies, deleteStrategy } = useStrategyStore()

  // All tickers state (for modal + default 4 shown)
  const [allTickers, setAllTickers] = useState<TickerState[]>(
    ALL_SYMBOLS.map(s => ({ ...s, price: 0, change_pct: 0, candles: [], loading: true }))
  )
  const [activities, setActivities] = useState<Activity[]>([])
  const [loadingActivities, setLoadingActivities] = useState(false)
  const [showAllMarkets, setShowAllMarkets] = useState(false)
  const wsRefs = useRef<Map<string, WebSocket>>(new Map())
  const isMountedRef = useRef(false)

  // ── Load initial candles + 24h ticker ───────────────────────────
  useEffect(() => {
    const loadAll = async () => {
      await Promise.allSettled(
        ALL_SYMBOLS.map(async ({ symbol }) => {
          try {
            // 24h ticker for correct priceChangePercent
            const tickerRes = await fetch(
              `https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`
            )
            const td = await tickerRes.json()
            // 24h hourly candles for sparkline
            const klRes = await fetch(
              `https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=24`
            )
            const kd: any[][] = await klRes.json()
            const candles: Candle[] = kd.map(k => ({
              t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5],
            }))
            setAllTickers(prev => prev.map(t =>
              t.symbol === symbol
                ? { ...t, price: +td.lastPrice, change_pct: +td.priceChangePercent, candles, loading: false, error: undefined }
                : t
            ))
          } catch {
            setAllTickers(prev => prev.map(t =>
              t.symbol === symbol ? { ...t, loading: false, error: 'Failed' } : t
            ))
          }
        })
      )
    }
    loadAll()
  }, [])

  // ── #8 WebSocket live price update (default 4 symbols only to save connections) ──
  useEffect(() => {
    const symbols = ALL_SYMBOLS.slice(0, 4).map(s => s.symbol)
    symbols.forEach(symbol => {
      if (wsRefs.current.has(symbol)) return
      const connect = () => {
        const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`)
        wsRefs.current.set(symbol, ws)
        ws.onmessage = e => {
          const d = JSON.parse(e.data)
          setAllTickers(prev => prev.map(t =>
            t.symbol === symbol
              ? { ...t, price: +d.c, change_pct: +d.P }
              : t
          ))
        }
        ws.onclose = () => {
          wsRefs.current.delete(symbol)
          setTimeout(connect, 3000)
        }
        ws.onerror = () => ws.close()
      }
      connect()
    })
    return () => {
      wsRefs.current.forEach(ws => ws.close())
      wsRefs.current.clear()
    }
  }, [])

  // ── Fetch strategies ─────────────────────────────────────────────
  useEffect(() => {
    if (!isMountedRef.current) {
      isMountedRef.current = true
      fetchStrategies()
    }
  }, [fetchStrategies])

  // ── Fetch activities ─────────────────────────────────────────────
  const loadActivities = useCallback(async () => {
    setLoadingActivities(true)
    try {
      const res = await fetch(`${API_BASE}/api/strategies/activities?limit=8`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setActivities(Array.isArray(data) ? data : (data.activities ?? []))
    } catch {
      setActivities([])
    } finally {
      setLoadingActivities(false)
    }
  }, [])

  useEffect(() => { loadActivities() }, [loadActivities])

  // ── #3 Go to report (sessionStorage cache, 30min TTL) ────────────
  const goToReport = useCallback((id: string, activity?: Activity) => {
    if (activity && id) {
      try {
        const existing = sessionStorage.getItem(`report_${id}`)
        if (!existing && activity.equity_curve) {
          const payload = {
            ...activity, id,
            _cached_at: Date.now(),
            _ttl_ms: 30 * 60 * 1000,
          }
          sessionStorage.setItem(`report_${id}`, JSON.stringify(payload))
        }
      } catch {}
    }
    navigate(`/report/${id}`)
  }, [navigate])

  // ── Navigate to chart ────────────────────────────────────────────
  const goToChart = useCallback((symbol: string) => {
    localStorage.setItem('chart_symbol', symbol)
    navigate('/chart')
  }, [navigate])

  // ── Delete strategy ──────────────────────────────────────────────
  const handleDelete = async (id: string, e: React.MouseEvent) => {
    e.stopPropagation()
    if (!confirm('確定刪除此策略？')) return
    await deleteStrategy(id)
  }

  const defaultTickers = allTickers.filter(t => DEFAULT_SYMBOLS.some(d => d.symbol === t.symbol))

  // ── Shared section style ─────────────────────────────────────────
  const section: React.CSSProperties = {
    background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, padding: 20,
  }
  const sectionHeader: React.CSSProperties = {
    display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 16,
  }

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, fontFamily: 'system-ui, -apple-system, sans-serif', padding: 24 }}>
      <style>{`
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
        ::-webkit-scrollbar { width: 6px; height: 6px; }
        ::-webkit-scrollbar-track { background: ${C.bg}; }
        ::-webkit-scrollbar-thumb { background: ${C.border}; border-radius: 3px; }
      `}</style>

      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Header */}
        <div>
          <h1 style={{ fontSize: 26, fontWeight: 700, color: C.text, margin: 0 }}>Dashboard</h1>
          <p style={{ fontSize: 13, color: C.muted, margin: '4px 0 0' }}>市場概覽 &amp; 策略管理</p>
        </div>

        {/* ── Market Overview ── */}
        <div>
          <div style={sectionHeader}>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>市場概覽</span>
            <button
              onClick={() => navigate('/markets')}
              style={{
                fontSize: 12, fontWeight: 600, color: C.blue,
                background: 'rgba(41,98,255,0.1)', border: `1px solid rgba(41,98,255,0.3)`,
                borderRadius: 6, padding: '5px 12px', cursor: 'pointer',
              }}
            >
              查看所有市場
            </button>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12 }}>
            {defaultTickers.map(ticker => (
              <TickerCard key={ticker.symbol} ticker={ticker} onClick={() => goToChart(ticker.symbol)} />
            ))}
          </div>
        </div>

        {/* ── Strategy Overview ── */}
        <div style={section}>
          <div style={sectionHeader}>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>策略總覽</span>
            <button
              onClick={() => navigate('/strategy')}
              style={{
                display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, fontWeight: 600,
                color: '#fff', background: C.purple, border: 'none',
                borderRadius: 7, padding: '7px 14px', cursor: 'pointer',
              }}
            >
              <Plus style={{ width: 14, height: 14 }} />新增策略
            </button>
          </div>

          {strategies.length === 0 ? (
            <div style={{ color: C.muted, textAlign: 'center', padding: '32px 0', fontSize: 13 }}>
              尚無策略，請至參數優化頁面執行回測
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {strategies.slice(0, 10).map((s: Strategy) => (
                <div
                  key={s.id}
                  onClick={() => goToReport(s.id)}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 14px', background: C.hover, borderRadius: 8, cursor: 'pointer',
                    border: `1px solid transparent`, transition: 'border-color 0.15s',
                  }}
                  onMouseEnter={e => (e.currentTarget.style.borderColor = C.purple + '60')}
                  onMouseLeave={e => (e.currentTarget.style.borderColor = 'transparent')}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {s.name}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                      {(s as any).symbol} · {(s as any).interval}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 20, marginRight: 16, textAlign: 'right' }}>
                    {(s as any).profit_pct != null && (
                      <div>
                        <div style={{ fontSize: 10, color: C.muted }}>獲利率</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: (s as any).profit_pct >= 0 ? C.green : C.red }}>
                          {(s as any).profit_pct >= 0 ? '+' : ''}{(s as any).profit_pct?.toFixed(2)}%
                        </div>
                      </div>
                    )}
                    {(s as any).max_drawdown != null && (
                      <div>
                        <div style={{ fontSize: 10, color: C.muted }}>MDD</div>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.red }}>
                          {(s as any).max_drawdown.toFixed(2)}%
                        </div>
                      </div>
                    )}
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    <button
                      onClick={e => { e.stopPropagation(); goToReport(s.id) }}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        fontSize: 12, fontWeight: 600, color: C.purple,
                        background: 'rgba(124,58,237,0.15)', border: 'none',
                        borderRadius: 6, padding: '5px 10px', cursor: 'pointer',
                      }}
                    >
                      <FileText style={{ width: 12, height: 12 }} />查看報告
                    </button>
                    <button
                      onClick={e => handleDelete(s.id, e)}
                      style={{
                        padding: '5px 8px', background: 'none', border: 'none', cursor: 'pointer',
                        borderRadius: 6, color: C.red, display: 'flex', alignItems: 'center',
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = 'rgba(239,83,80,0.15)')}
                      onMouseLeave={e => (e.currentTarget.style.background = 'none')}
                    >
                      <Trash2 style={{ width: 14, height: 14 }} />
                    </button>
                  </div>
                </div>
              ))}
              {strategies.length > 10 && (
                <div style={{ color: C.muted, fontSize: 12, textAlign: 'center', paddingTop: 8 }}>
                  顯示前 10 筆，共 {strategies.length} 筆策略
                </div>
              )}
            </div>
          )}
        </div>

        {/* ── Recent Activities ── */}
        <div style={section}>
          <div style={sectionHeader}>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>近期回測活動</span>
            <button
              onClick={loadActivities}
              style={{
                display: 'flex', alignItems: 'center', gap: 5, fontSize: 12, color: C.muted,
                background: C.hover, border: 'none', borderRadius: 6,
                padding: '5px 10px', cursor: 'pointer',
              }}
            >
              <RefreshCw style={{ width: 12, height: 12 }} />重新整理
            </button>
          </div>

          {loadingActivities ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {[1,2,3].map(i => (
                <div key={i} style={{ height: 56, background: C.hover, borderRadius: 8, animation: 'pulse 1.5s infinite' }} />
              ))}
            </div>
          ) : activities.length === 0 ? (
            <div style={{ color: C.muted, textAlign: 'center', padding: '32px 0', fontSize: 13 }}>
              尚無回測記錄，執行優化後自動出現
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activities.map((a, idx) => (
                <div
                  key={a.id || idx}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    padding: '12px 14px', background: C.hover, borderRadius: 8,
                  }}
                >
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: 14, fontWeight: 600, color: C.text, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {a.name ?? `${a.type === 'backtest' ? '回測' : '優化'} – ${a.symbol} (${a.interval})`}
                    </div>
                    <div style={{ fontSize: 11, color: C.muted, marginTop: 2 }}>
                      {(a.saved_at ?? a.created_at) ? new Date((a.saved_at ?? a.created_at)!).toLocaleString('zh-TW') : '—'}
                      {a.symbol && ` · ${a.symbol}`}{a.interval && ` · ${a.interval}`}
                    </div>
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 64px)', gap: 4, textAlign: 'right', marginRight: 12 }}>
                    {[
                      { label: '獲利率', val: `${(a.profit_pct ?? 0) >= 0 ? '+' : ''}${(a.profit_pct ?? 0).toFixed(2)}%`, color: (a.profit_pct ?? 0) >= 0 ? C.green : C.red },
                      { label: '勝率',   val: `${(a.win_rate ?? 0).toFixed(1)}%`, color: C.text },
                      { label: 'MDD',    val: `${(a.max_drawdown ?? 0).toFixed(2)}%`, color: C.red },
                      { label: '盈虧比', val: (a.profit_factor ?? 0).toFixed(2), color: C.text },
                    ].map(m => (
                      <div key={m.label}>
                        <div style={{ fontSize: 10, color: C.muted }}>{m.label}</div>
                        <div style={{ fontSize: 12, fontWeight: 600, color: m.color }}>{m.val}</div>
                      </div>
                    ))}
                  </div>
                  {a.id && (
                    <button
                      onClick={() => goToReport(a.id!, a)}
                      style={{
                        display: 'flex', alignItems: 'center', gap: 4,
                        fontSize: 12, fontWeight: 600, color: C.purple,
                        background: 'rgba(124,58,237,0.15)', border: 'none',
                        borderRadius: 6, padding: '5px 10px', cursor: 'pointer', whiteSpace: 'nowrap',
                      }}
                    >
                      <FileText style={{ width: 12, height: 12 }} />看報告
                    </button>
                  )}
                </div>
              ))}
            </div>
          )}
        </div>

      </div>

      {/* All Markets Modal */}
      {showAllMarkets && (
        <AllMarketsModal
          tickers={allTickers}
          onClose={() => setShowAllMarkets(false)}
          onSelect={goToChart}
        />
      )}
    </div>
  )
}