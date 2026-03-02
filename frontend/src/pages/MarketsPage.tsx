// ================================================================
// MarketsPage.tsx  v3.0.0 - 2026-03-02
// ----------------------------------------------------------------
// v3.0.0 - 移除期貨區塊，加入 WebSocket 即時更新所有加密貨幣卡片
//          XAUUSDT/XAGUSDT 貴金屬納入加密貨幣區塊
// ================================================================

import React, { useEffect, useState, useCallback, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, TrendingDown, ArrowUpDown, RefreshCw, Zap } from 'lucide-react'

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
  orange: '#f7931a',
}

const SYMBOL_COLORS: Record<string, string> = {
  BTCUSDT:   '#f7931a',
  ETHUSDT:   '#7c3aed',
  SOLUSDT:   '#9945ff',
  BNBUSDT:   '#f0b90b',
  XRPUSDT:   '#006ab4',
  ADAUSDT:   '#0033ad',
  DOGEUSDT:  '#c8a400',
  AVAXUSDT:  '#e84142',
  DOTUSDT:   '#e6007a',
  LINKUSDT:  '#2a5ada',
  MATICUSDT: '#8247e5',
  LTCUSDT:   '#bfbbbb',
  UNIUSDT:   '#ff007a',
  ATOMUSDT:  '#6f7390',
  XAUUSDT:   '#ffd700',
  XAGUSDT:   '#aaaaaa',
}

const SYMBOL_ICONS: Record<string, string> = {
  BTCUSDT: '₿', ETHUSDT: 'Ξ', SOLUSDT: '◎', BNBUSDT: '⬡',
  XRPUSDT: '✕', ADAUSDT: '₳', DOGEUSDT: 'Ð', AVAXUSDT: '△',
  DOTUSDT: '●', LINKUSDT: '⬡', MATICUSDT: '◈', LTCUSDT: 'Ł',
  UNIUSDT: 'U', ATOMUSDT: '⛛', XAUUSDT: 'AU', XAGUSDT: 'AG',
}

interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

interface MarketTicker {
  symbol:      string
  label:       string
  name:        string
  price:       number
  change:      number
  change_pct:  number
  high24h:     number
  low24h:      number
  volume24h:   number
  candles:     Candle[]
  loading:     boolean
  error?:      string
}

const CRYPTO_SYMBOLS: { symbol: string; label: string; name: string }[] = [
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

function formatPrice(p: number) {
  if (p >= 1000) return p.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (p >= 1)    return p.toFixed(4)
  return p.toFixed(6)
}

function formatVolume(v: number) {
  if (v >= 1e9) return `${(v / 1e9).toFixed(2)}B`
  if (v >= 1e6) return `${(v / 1e6).toFixed(2)}M`
  if (v >= 1e3) return `${(v / 1e3).toFixed(2)}K`
  return v.toFixed(2)
}

// ── SparkLine ──────────────────────────────────────────────────
function SparkLine({ candles, color }: { candles: Candle[]; color: string }) {
  if (!candles || candles.length < 2) return <div style={{ height: 44 }} />
  const closes = candles.map(c => c.c)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const range = max - min || 1
  const W = 160, H = 44
  const pts = closes.map((v, i) =>
    `${(i / (closes.length - 1)) * W},${H - ((v - min) / range) * (H - 4) - 2}`
  ).join(' ')
  const fillPts = `0,${H} ${pts} ${W},${H}`
  const gradId = `spark-${Math.random().toString(36).slice(2, 8)}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', height: 44 }}>
      <defs>
        <linearGradient id={gradId} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.3" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <polygon points={fillPts} fill={`url(#${gradId})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

// ── Market Card ─────────────────────────────────────────────────
function MarketCard({ ticker, onChart, onBacktest }: {
  ticker: MarketTicker
  onChart: () => void
  onBacktest: (e: React.MouseEvent) => void
}) {
  const isUp   = ticker.change_pct >= 0
  const color  = ticker.loading ? C.muted : (isUp ? C.green : C.red)
  const accent = SYMBOL_COLORS[ticker.symbol] ?? C.blue
  const icon   = SYMBOL_ICONS[ticker.symbol] ?? '◎'

  return (
    <div
      onClick={onChart}
      style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 12,
        padding: '16px 18px', cursor: 'pointer', transition: 'border-color 0.15s',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = accent + '80')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
    >
      {/* Row 1: icon + 名稱 | 漲跌幅 */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <div style={{
            width: 32, height: 32, borderRadius: 8, background: accent + '22',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 13, fontWeight: 700, color: accent, flexShrink: 0,
          }}>
            {icon}
          </div>
          <div>
            <div style={{ fontSize: 13, fontWeight: 700, color: C.text }}>{ticker.label}</div>
            <div style={{ fontSize: 10, color: C.muted, marginTop: 2 }}>{ticker.name}</div>
          </div>
        </div>
        {ticker.loading ? (
          <div style={{ width: 60, height: 22, background: C.hover, borderRadius: 4, animation: 'pulse 1.5s infinite' }} />
        ) : (
          <div style={{
            display: 'flex', alignItems: 'center', gap: 3,
            background: isUp ? 'rgba(38,166,154,0.15)' : 'rgba(239,83,80,0.15)',
            color, borderRadius: 6, padding: '3px 8px', fontSize: 12, fontWeight: 700,
          }}>
            {isUp ? <TrendingUp style={{ width: 11, height: 11 }} /> : <TrendingDown style={{ width: 11, height: 11 }} />}
            {ticker.change_pct >= 0 ? '+' : ''}{ticker.change_pct.toFixed(2)}%
          </div>
        )}
      </div>

      {/* Row 2: 大字即時價格 */}
      <div style={{ fontSize: 22, fontWeight: 700, color: accent, letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums' }}>
        {ticker.loading
          ? <div style={{ width: 120, height: 28, background: C.hover, borderRadius: 4 }} />
          : ticker.error ? '—' : `$${formatPrice(ticker.price)}`}
      </div>

      {/* Row 3: 迷你走勢折線圖 */}
      <SparkLine candles={ticker.candles} color={ticker.loading || ticker.error ? C.muted : color} />

      {/* Row 4: 底部 H/L + 回測按鈕 */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        {!ticker.loading && !ticker.error ? (
          <div style={{ display: 'flex', gap: 12, fontSize: 11 }}>
            <span style={{ color: C.muted }}>H: <span style={{ color: C.green }}>${formatPrice(ticker.high24h)}</span></span>
            <span style={{ color: C.muted }}>L: <span style={{ color: C.red }}>${formatPrice(ticker.low24h)}</span></span>
          </div>
        ) : <div />}
        <button
          onClick={e => { e.stopPropagation(); onBacktest(e) }}
          style={{
            fontSize: 11, fontWeight: 600, padding: '4px 10px',
            background: 'rgba(41,98,255,0.12)', color: C.blue,
            border: `1px solid rgba(41,98,255,0.3)`, borderRadius: 5, cursor: 'pointer',
          }}
        >
          回測 →
        </button>
      </div>
    </div>
  )
}

// ── Sort helpers ───────────────────────────────────────────────
type SortField = 'label' | 'price' | 'change_pct' | 'change' | 'high24h' | 'low24h' | 'volume24h'
type SortDir   = 'asc' | 'desc'

// ================================================================
// Main Component
// ================================================================
export default function MarketsPage() {
  const navigate = useNavigate()
  const wsRefs = useRef<Map<string, WebSocket>>(new Map())

  const makeInitial = (): MarketTicker[] =>
    CRYPTO_SYMBOLS.map(s => ({
      ...s, price: 0, change: 0, change_pct: 0,
      high24h: 0, low24h: 0, volume24h: 0, candles: [], loading: true,
    }))

  const [tickers,    setTickers]    = useState<MarketTicker[]>(makeInitial())
  const [loading,    setLoading]    = useState(true)
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null)
  const [sortField,  setSortField]  = useState<SortField>('label')
  const [sortDir,    setSortDir]    = useState<SortDir>('asc')
  const [search,     setSearch]     = useState('')

  const BINANCE_HOSTS = [
    'https://api.binance.us',
    'https://api1.binance.com',
    'https://api2.binance.com',
    'https://api.binance.com',
  ]

  const fetchBinance = async (path: string): Promise<Response> => {
    let lastErr: unknown
    for (const host of BINANCE_HOSTS) {
      try {
        const res = await Promise.race([
          fetch(`${host}${path}`),
          new Promise<never>((_, rej) => setTimeout(() => rej(new Error('timeout')), 5000)),
        ]) as Response
        if (res.ok) return res
      } catch (e) { lastErr = e }
    }
    throw lastErr ?? new Error('All Binance hosts failed')
  }

  // ── REST 初始載入（含 K 線）──────────────────────────────────
  const loadAll = useCallback(async () => {
    setLoading(true)
    setTickers(prev => prev.map(t => ({ ...t, loading: true, error: undefined })))

    await Promise.allSettled(
      CRYPTO_SYMBOLS.map(async ({ symbol }) => {
        try {
          const [tickerRes, klRes] = await Promise.all([
            fetchBinance(`/api/v3/ticker/24hr?symbol=${symbol}`),
            fetchBinance(`/api/v3/klines?symbol=${symbol}&interval=1h&limit=24`),
          ])
          const td = await tickerRes.json()
          const kd: any[][] = await klRes.json()
          const candles: Candle[] = kd.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }))
          setTickers(prev => prev.map(t =>
            t.symbol === symbol
              ? {
                  ...t,
                  price:      +td.lastPrice,
                  change:     +td.priceChange,
                  change_pct: +td.priceChangePercent,
                  high24h:    +td.highPrice,
                  low24h:     +td.lowPrice,
                  volume24h:  +td.quoteVolume,
                  candles, loading: false, error: undefined,
                }
              : t
          ))
        } catch {
          setTickers(prev => prev.map(t =>
            t.symbol === symbol ? { ...t, loading: false, error: 'N/A' } : t
          ))
        }
      })
    )

    setLoading(false)
    setLastUpdate(new Date())
  }, [])

  // ── WebSocket 即時更新（價格 + 漲跌幅）───────────────────────
  useEffect(() => {
    const connectWS = (symbol: string) => {
      if (wsRefs.current.has(symbol)) return
      const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@ticker`)
      wsRefs.current.set(symbol, ws)
      ws.onmessage = e => {
        const d = JSON.parse(e.data)
        setTickers(prev => prev.map(t =>
          t.symbol === symbol
            ? { ...t, price: +d.c, change: +d.p, change_pct: +d.P, high24h: +d.h, low24h: +d.l, volume24h: +d.q }
            : t
        ))
      }
      ws.onclose = () => {
        wsRefs.current.delete(symbol)
        setTimeout(() => connectWS(symbol), 3000)
      }
      ws.onerror = () => ws.close()
    }

    CRYPTO_SYMBOLS.forEach(({ symbol }) => connectWS(symbol))

    return () => {
      wsRefs.current.forEach(ws => ws.close())
      wsRefs.current.clear()
    }
  }, [])

  useEffect(() => { loadAll() }, [loadAll])

  const handleSort = (field: SortField) => {
    if (sortField === field) setSortDir(d => d === 'asc' ? 'desc' : 'asc')
    else { setSortField(field); setSortDir('desc') }
  }

  const filtered = tickers.filter(t =>
    t.label.toLowerCase().includes(search.toLowerCase()) ||
    t.name.toLowerCase().includes(search.toLowerCase())
  )

  const sorted = [...filtered].sort((a, b) => {
    const dir = sortDir === 'asc' ? 1 : -1
    if (sortField === 'label') return dir * a.label.localeCompare(b.label)
    return dir * ((a[sortField] as number) - (b[sortField] as number))
  })

  const thStyle: React.CSSProperties = {
    padding: '10px 14px', textAlign: 'left', fontSize: 11,
    color: C.muted, fontWeight: 600, whiteSpace: 'nowrap',
    borderBottom: `1px solid ${C.border}`, cursor: 'pointer', userSelect: 'none',
  }

  const SortIcon = ({ field }: { field: SortField }) => (
    <ArrowUpDown size={11} style={{
      display: 'inline', marginLeft: 4,
      opacity: sortField === field ? 1 : 0.35,
      color: sortField === field ? C.gold : C.muted,
    }} />
  )

  const formatTime = (d: Date) =>
    d.toLocaleTimeString('zh-TW', { hour: '2-digit', minute: '2-digit', second: '2-digit' })

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, padding: 24, overflowY: 'auto' }}>
      <style>{`
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
        @keyframes spin   { to { transform: rotate(360deg); } }
        ::-webkit-scrollbar { width:6px; height:6px; }
        ::-webkit-scrollbar-track { background:${C.bg}; }
        ::-webkit-scrollbar-thumb { background:${C.border}; border-radius:3px; }
      `}</style>

      <div style={{ maxWidth: 1440, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 28 }}>

        {/* ── 頁面標題 ── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: C.text, margin: 0 }}>市場概覽</h1>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(38,166,154,0.12)', border: '1px solid rgba(38,166,154,0.3)',
              borderRadius: 6, padding: '3px 9px',
            }}>
              <div style={{ width: 6, height: 6, borderRadius: '50%', background: C.green, animation: 'pulse 1.5s infinite' }} />
              <span style={{ fontSize: 11, fontWeight: 700, color: C.green }}>LIVE</span>
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            {lastUpdate && (
              <span style={{ fontSize: 11, color: C.muted }}>
                更新: {formatTime(lastUpdate)} · <span style={{ color: C.green }}>即時更新</span>
              </span>
            )}
            <button
              onClick={loadAll}
              style={{
                display: 'flex', alignItems: 'center', gap: 6,
                padding: '7px 14px', borderRadius: 6, border: `1px solid ${C.border}`,
                background: C.card, color: C.muted, fontSize: 12, cursor: 'pointer',
              }}
            >
              <RefreshCw size={13} style={{ animation: loading ? 'spin 1s linear infinite' : 'none' }} />
              {loading ? '載入中...' : '重新整理'}
            </button>
          </div>
        </div>

        {/* ── 加密貨幣卡片區（4 欄 grid）── */}
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 14 }}>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.text }}>加密貨幣</span>
            <div style={{
              display: 'flex', alignItems: 'center', gap: 5,
              background: 'rgba(38,166,154,0.12)', border: '1px solid rgba(38,166,154,0.3)',
              borderRadius: 5, padding: '2px 8px',
            }}>
              <Zap size={10} style={{ color: C.green }} />
              <span style={{ fontSize: 10, fontWeight: 700, color: C.green }}>LIVE</span>
            </div>
            <span style={{ fontSize: 11, color: C.muted }}>即時收盤價</span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
            {tickers.map(ticker => (
              <MarketCard
                key={ticker.symbol}
                ticker={ticker}
                onChart={() => {
                  localStorage.setItem('chart_symbol', ticker.symbol)
                  navigate('/chart')
                }}
                onBacktest={e => {
                  e.stopPropagation()
                  navigate(`/optimize?symbol=${ticker.symbol}`)
                }}
              />
            ))}
          </div>
        </div>

        {/* ── 詳細數據表格 ── */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 12, overflow: 'hidden' }}>
          <div style={{
            padding: '14px 18px', borderBottom: `1px solid ${C.border}`,
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>所有幣對</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜尋幣對..."
              style={{
                padding: '6px 12px', background: C.bg, border: `1px solid ${C.border}`,
                borderRadius: 6, color: C.text, fontSize: 12, outline: 'none', width: 200,
              }}
            />
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(0,0,0,0.2)' }}>
                  <th style={thStyle} onClick={() => handleSort('label')}>資產 <SortIcon field="label" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => handleSort('price')}>最新價 <SortIcon field="price" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => handleSort('change')}>24H 漲跌 <SortIcon field="change" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => handleSort('change_pct')}>24H 漲跌幅 <SortIcon field="change_pct" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => handleSort('high24h')}>日高 <SortIcon field="high24h" /></th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => handleSort('low24h')}>日低 <SortIcon field="low24h" /></th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((t, i) => {
                  const isUp  = t.change_pct >= 0
                  const color = isUp ? C.green : C.red
                  return (
                    <tr
                      key={t.symbol}
                      style={{
                        background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)',
                        borderBottom: `1px solid ${C.border}`,
                      }}
                      onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                      onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)')}
                    >
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <div style={{
                            width: 26, height: 26, borderRadius: 6, flexShrink: 0,
                            background: (SYMBOL_COLORS[t.symbol] ?? C.blue) + '22',
                            display: 'flex', alignItems: 'center', justifyContent: 'center',
                            fontSize: 12, color: SYMBOL_COLORS[t.symbol] ?? C.blue,
                          }}>
                            {SYMBOL_ICONS[t.symbol] ?? '◎'}
                          </div>
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{t.label}</div>
                            <div style={{ fontSize: 10, color: C.muted }}>{t.name}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {t.loading
                          ? <div style={{ width: 80, height: 16, background: C.hover, borderRadius: 4, marginLeft: 'auto' }} />
                          : <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>${formatPrice(t.price)}</span>}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {t.loading
                          ? <div style={{ width: 60, height: 16, background: C.hover, borderRadius: 4, marginLeft: 'auto' }} />
                          : <span style={{ fontSize: 12, fontWeight: 600, color }}>
                              {t.change >= 0 ? '+' : ''}{formatPrice(Math.abs(t.change))}
                            </span>}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                        {t.loading
                          ? <div style={{ width: 60, height: 16, background: C.hover, borderRadius: 4, marginLeft: 'auto' }} />
                          : <span style={{
                              fontSize: 12, fontWeight: 700, color,
                              background: isUp ? 'rgba(38,166,154,0.12)' : 'rgba(239,83,80,0.12)',
                              padding: '2px 8px', borderRadius: 4,
                            }}>
                              {isUp ? '+' : ''}{t.change_pct.toFixed(2)}%
                            </span>}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, color: C.green, fontVariantNumeric: 'tabular-nums' }}>
                        {t.loading ? '—' : `$${formatPrice(t.high24h)}`}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, color: C.red, fontVariantNumeric: 'tabular-nums' }}>
                        {t.loading ? '—' : `$${formatPrice(t.low24h)}`}
                      </td>
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <button
                          onClick={() => navigate(`/optimize?symbol=${t.symbol}`)}
                          style={{
                            padding: '4px 12px', fontSize: 11, fontWeight: 600,
                            background: 'rgba(41,98,255,0.12)', color: C.blue,
                            border: `1px solid rgba(41,98,255,0.3)`, borderRadius: 5, cursor: 'pointer',
                            marginRight: 6,
                          }}
                        >
                          回測
                        </button>
                        <button
                          onClick={() => {
                            localStorage.setItem('chart_symbol', t.symbol)
                            navigate('/chart')
                          }}
                          style={{
                            padding: '4px 12px', fontSize: 11, fontWeight: 600,
                            background: 'rgba(255,255,255,0.05)', color: C.muted,
                            border: `1px solid ${C.border}`, borderRadius: 5, cursor: 'pointer',
                          }}
                        >
                          圖表
                        </button>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          </div>
        </div>

      </div>
    </div>
  )
}
