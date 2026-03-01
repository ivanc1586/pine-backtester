// ================================================================
// MarketsPage.tsx  v1.0.0 - 2026-03-01
// ----------------------------------------------------------------
// /markets 子頁面
// 功能：
//   - 頂部卡片：幣名、現價、漲跌幅、24h 高低價
//   - 走勢圖：SVG sparkline（24h 1h K線）
//   - 詳細表格：所有幣對排序顯示
// ================================================================

import React, { useEffect, useState, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { TrendingUp, TrendingDown, ArrowUpDown, RefreshCw } from 'lucide-react'

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
}

interface Candle { t: number; o: number; h: number; l: number; c: number; v: number }

interface MarketTicker {
  symbol:       string
  label:        string
  name:         string
  price:        number
  change_pct:   number
  high24h:      number
  low24h:       number
  volume24h:    number
  candles:      Candle[]
  loading:      boolean
  error?:       string
}

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

// ── SparkLine ──────────────────────────────────────────────
function SparkLine({ candles, color }: { candles: Candle[]; color: string }) {
  if (!candles || candles.length < 2) return <div style={{ height: 40 }} />
  const closes = candles.map(c => c.c)
  const min = Math.min(...closes)
  const max = Math.max(...closes)
  const range = max - min || 1
  const W = 120, H = 40
  const pts = closes.map((v, i) =>
    `${(i / (closes.length - 1)) * W},${H - ((v - min) / range) * (H - 4) - 2}`
  ).join(' ')
  const fillPts = `0,${H} ${pts} ${W},${H}`
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: 120, height: 40 }}>
      <defs>
        <linearGradient id={`spark-mkt-${color.replace('#', '')}`} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.25" />
          <stop offset="100%" stopColor={color} stopOpacity="0.0" />
        </linearGradient>
      </defs>
      <polygon points={fillPts} fill={`url(#spark-mkt-${color.replace('#', '')})`} />
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" strokeLinejoin="round" />
    </svg>
  )
}

// ── Top 4 Market Cards ─────────────────────────────────────────
function MarketCard({ ticker, onClick }: { ticker: MarketTicker; onClick: () => void }) {
  const isUp = ticker.change_pct >= 0
  const color = isUp ? C.green : C.red
  return (
    <div
      onClick={onClick}
      style={{
        background: C.card, border: `1px solid ${C.border}`, borderRadius: 10,
        padding: '16px 18px', cursor: 'pointer', transition: 'border-color 0.15s',
        display: 'flex', flexDirection: 'column', gap: 8,
      }}
      onMouseEnter={e => (e.currentTarget.style.borderColor = C.blue + '80')}
      onMouseLeave={e => (e.currentTarget.style.borderColor = C.border)}
    >
      {/* Row 1: label + change */}
      <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 700, color: C.text }}>{ticker.label}</div>
          <div style={{ fontSize: 11, color: C.muted }}>{ticker.name}</div>
        </div>
        {ticker.loading ? (
          <div style={{ width: 60, height: 22, background: C.hover, borderRadius: 4 }} />
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

      {/* Row 2: price */}
      <div style={{ fontSize: 22, fontWeight: 700, color: C.text, letterSpacing: '-0.5px', fontVariantNumeric: 'tabular-nums' }}>
        {ticker.loading ? <div style={{ width: 110, height: 26, background: C.hover, borderRadius: 4 }} />
          : ticker.error ? '—' : `$${formatPrice(ticker.price)}`}
      </div>

      {/* Row 3: high / low */}
      {!ticker.loading && !ticker.error && (
        <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
          <span style={{ color: C.muted }}>H: <span style={{ color: C.green }}>${formatPrice(ticker.high24h)}</span></span>
          <span style={{ color: C.muted }}>L: <span style={{ color: C.red }}>${formatPrice(ticker.low24h)}</span></span>
        </div>
      )}

      {/* Row 4: sparkline */}
      <SparkLine candles={ticker.candles} color={ticker.loading || ticker.error ? C.muted : color} />
    </div>
  )
}

// ── Sort helpers ─────────────────────────────────────────────
type SortField = 'label' | 'price' | 'change_pct' | 'high24h' | 'low24h' | 'volume24h'
type SortDir   = 'asc' | 'desc'

// ================================================================
// Main Component
// ================================================================
export default function MarketsPage() {
  const navigate = useNavigate()
  const [tickers, setTickers] = useState<MarketTicker[]>(
    ALL_SYMBOLS.map(s => ({ ...s, price: 0, change_pct: 0, high24h: 0, low24h: 0, volume24h: 0, candles: [], loading: true }))
  )
  const [loading, setLoading] = useState(true)
  const [sortField, setSortField] = useState<SortField>('label')
  const [sortDir, setSortDir]     = useState<SortDir>('asc')
  const [search, setSearch]       = useState('')

  const loadAll = useCallback(async () => {
    setLoading(true)
    await Promise.allSettled(
      ALL_SYMBOLS.map(async ({ symbol }) => {
        try {
          const [tickerRes, klRes] = await Promise.all([
            fetch(`https://api.binance.com/api/v3/ticker/24hr?symbol=${symbol}`),
            fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1h&limit=24`),
          ])
          const td = await tickerRes.json()
          const kd: any[][] = await klRes.json()
          const candles: Candle[] = kd.map(k => ({ t: k[0], o: +k[1], h: +k[2], l: +k[3], c: +k[4], v: +k[5] }))
          setTickers(prev => prev.map(t =>
            t.symbol === symbol
              ? { ...t, price: +td.lastPrice, change_pct: +td.priceChangePercent,
                  high24h: +td.highPrice, low24h: +td.lowPrice,
                  volume24h: +td.quoteVolume, candles, loading: false, error: undefined }
              : t
          ))
        } catch {
          setTickers(prev => prev.map(t =>
            t.symbol === symbol ? { ...t, loading: false, error: 'Failed' } : t
          ))
        }
      })
    )
    setLoading(false)
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

  const top4 = tickers.slice(0, 4)

  const thStyle: React.CSSProperties = {
    padding: '10px 14px', textAlign: 'left', fontSize: 11,
    color: C.muted, fontWeight: 600, whiteSpace: 'nowrap',
    borderBottom: `1px solid ${C.border}`, cursor: 'pointer',
    userSelect: 'none',
  }

  const SortIcon = ({ field }: { field: SortField }) => (
    <ArrowUpDown
      size={11}
      style={{ display: 'inline', marginLeft: 4, opacity: sortField === field ? 1 : 0.35,
        color: sortField === field ? C.gold : C.muted }}
    />
  )

  return (
    <div style={{ minHeight: '100vh', background: C.bg, color: C.text, padding: 24, overflowY: 'auto' }}>
      <style>{`
        @keyframes pulse { 0%,100% { opacity:1 } 50% { opacity:0.4 } }
        ::-webkit-scrollbar { width:6px; height:6px; }
        ::-webkit-scrollbar-track { background:${C.bg}; }
        ::-webkit-scrollbar-thumb { background:${C.border}; border-radius:3px; }
      `}</style>

      <div style={{ maxWidth: 1280, margin: '0 auto', display: 'flex', flexDirection: 'column', gap: 24 }}>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div>
            <h1 style={{ fontSize: 24, fontWeight: 700, color: C.text, margin: 0 }}>市場總覽</h1>
            <p style={{ fontSize: 13, color: C.muted, margin: '4px 0 0' }}>即時幣對行情 · 24小時數據</p>
          </div>
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

        {/* Top 4 Cards */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 14 }}>
          {top4.map(ticker => (
            <MarketCard
              key={ticker.symbol}
              ticker={ticker}
              onClick={() => navigate(`/chart?symbol=${ticker.symbol}`)}
            />
          ))}
        </div>

        {/* Table Section */}
        <div style={{ background: C.card, border: `1px solid ${C.border}`, borderRadius: 10, overflow: 'hidden' }}>
          {/* Table header row */}
          <div style={{ padding: '14px 18px', borderBottom: `1px solid ${C.border}`, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span style={{ fontSize: 14, fontWeight: 700, color: C.text }}>所有幣對</span>
            <input
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="搜尋幣對..."
              style={{
                padding: '6px 12px', background: '#131722', border: `1px solid ${C.border}`,
                borderRadius: 6, color: C.text, fontSize: 12, outline: 'none', width: 200,
              }}
            />
          </div>

          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr style={{ background: 'rgba(0,0,0,0.2)' }}>
                  <th style={thStyle} onClick={() => handleSort('label')}>
                    幣對 <SortIcon field="label" />
                  </th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => handleSort('price')}>
                    現價 <SortIcon field="price" />
                  </th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => handleSort('change_pct')}>
                    24h 漲跌 <SortIcon field="change_pct" />
                  </th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => handleSort('high24h')}>
                    24h 最高 <SortIcon field="high24h" />
                  </th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => handleSort('low24h')}>
                    24h 最低 <SortIcon field="low24h" />
                  </th>
                  <th style={{ ...thStyle, textAlign: 'right' }} onClick={() => handleSort('volume24h')}>
                    24h 成交額 <SortIcon field="volume24h" />
                  </th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>走勢</th>
                  <th style={{ ...thStyle, textAlign: 'center' }}>操作</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map((t, i) => {
                  const isUp = t.change_pct >= 0
                  const color = isUp ? C.green : C.red
                  return (
                    <tr
                      key={t.symbol}
                      style={{ background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)', borderBottom: `1px solid ${C.border}` }}
                      onMouseEnter={e => (e.currentTarget.style.background = C.hover)}
                      onMouseLeave={e => (e.currentTarget.style.background = i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)')}
                    >
                      {/* Symbol */}
                      <td style={{ padding: '10px 14px' }}>
                        <div style={{ fontSize: 13, fontWeight: 600, color: C.text }}>{t.label}</div>
                        <div style={{ fontSize: 11, color: C.muted }}>{t.name}</div>
                      </td>
                      {/* Price */}
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>
                        {t.loading ? <div style={{ width: 80, height: 16, background: C.hover, borderRadius: 4, marginLeft: 'auto' }} />
                          : <span style={{ fontSize: 13, fontWeight: 600, color: C.text }}>${formatPrice(t.price)}</span>}
                      </td>
                      {/* Change */}
                      <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                        {t.loading ? <div style={{ width: 60, height: 16, background: C.hover, borderRadius: 4, marginLeft: 'auto' }} />
                          : (
                          <span style={{
                            fontSize: 12, fontWeight: 700, color,
                            background: isUp ? 'rgba(38,166,154,0.12)' : 'rgba(239,83,80,0.12)',
                            padding: '2px 8px', borderRadius: 4,
                          }}>
                            {isUp ? '+' : ''}{t.change_pct.toFixed(2)}%
                          </span>
                        )}
                      </td>
                      {/* High */}
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, color: C.green, fontVariantNumeric: 'tabular-nums' }}>
                        {t.loading ? '—' : `$${formatPrice(t.high24h)}`}
                      </td>
                      {/* Low */}
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, color: C.red, fontVariantNumeric: 'tabular-nums' }}>
                        {t.loading ? '—' : `$${formatPrice(t.low24h)}`}
                      </td>
                      {/* Volume */}
                      <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 12, color: C.muted, fontVariantNumeric: 'tabular-nums' }}>
                        {t.loading ? '—' : `$${formatVolume(t.volume24h)}`}
                      </td>
                      {/* Sparkline */}
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        {t.loading
                          ? <div style={{ width: 120, height: 40, background: C.hover, borderRadius: 4, display: 'inline-block' }} />
                          : <SparkLine candles={t.candles} color={t.error ? C.muted : color} />}
                      </td>
                      {/* Action */}
                      <td style={{ padding: '10px 14px', textAlign: 'center' }}>
                        <button
                          onClick={() => navigate(`/chart?symbol=${t.symbol}`)}
                          style={{
                            padding: '4px 12px', fontSize: 11, fontWeight: 600,
                            background: 'rgba(41,98,255,0.12)', color: C.blue,
                            border: `1px solid rgba(41,98,255,0.3)`, borderRadius: 5, cursor: 'pointer',
                          }}
                        >
                          查看
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

      <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
    </div>
  )
}