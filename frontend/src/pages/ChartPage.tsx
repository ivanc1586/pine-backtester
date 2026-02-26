import { useEffect, useRef, useState, useCallback } from 'react'
import { init, dispose, Chart } from 'klinecharts'
import { Search, ChevronDown, RefreshCw } from 'lucide-react'
import PageHeader from '../components/PageHeader'

// ── Constants ────────────────────────────────────────────────────────────────
const INTERVALS = ['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','1w']
const INTERVAL_LABELS: Record<string, string> = {
  '1m':'1分','3m':'3分','5m':'5分','15m':'15分','30m':'30分',
  '1h':'1時','2h':'2時','4h':'4時','6h':'6時','12h':'12時','1d':'日','1w':'週'
}
const POPULAR_SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','MATICUSDT',
  'LINKUSDT','UNIUSDT','LTCUSDT','ATOMUSDT','NEARUSDT',
]

type MarketType = 'spot' | 'futures'

const SPOT_REST      = 'https://api.binance.com/api/v3/klines'
const FUTURES_REST   = 'https://fapi.binance.com/fapi/v1/klines'
const SPOT_TICKER    = 'https://api.binance.com/api/v3/ticker/24hr'
const FUTURES_TICKER = 'https://fapi.binance.com/fapi/v1/ticker/24hr'
const SPOT_WS_BASE   = 'wss://stream.binance.com:9443/ws'
const FUTURES_WS_BASE= 'wss://fstream.binance.com/ws'

const getSavedSymbol     = () => localStorage.getItem('chart_symbol')   || 'BTCUSDT'
const getSavedInterval   = () => localStorage.getItem('chart_interval') || '1h'
const getSavedMarketType = () => (localStorage.getItem('chart_market') as MarketType) || 'futures'

// ── Types ────────────────────────────────────────────────────────────────────
interface RawKline {
  timestamp: number
  open: number; high: number; low: number; close: number
  volume: number; turnover: number
}

interface TickerInfo {
  priceChange: number
  priceChangePct: number
  high24h: number
  low24h: number
  volume24h: number
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function fetchBatch(
  marketType: MarketType, symbol: string, interval: string,
  limit: number, endTime?: number
): Promise<RawKline[]> {
  const base = marketType === 'futures' ? FUTURES_REST : SPOT_REST
  const max  = marketType === 'futures' ? 1500 : 1000
  const params = new URLSearchParams({ symbol, interval, limit: String(Math.min(limit, max)) })
  if (endTime) params.set('endTime', String(endTime))
  const res = await fetch(`${base}?${params}`)
  if (!res.ok) throw new Error(`Binance ${res.status}: ${await res.text()}`)
  const raw: any[][] = await res.json()
  return raw.map(k => ({
    timestamp: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
    low: parseFloat(k[3]), close: parseFloat(k[4]),
    volume: parseFloat(k[5]), turnover: parseFloat(k[7]),
  }))
}

async function fetchKlines(
  marketType: MarketType, symbol: string, interval: string, targetCount = 5000
): Promise<RawKline[]> {
  const batchSize = marketType === 'futures' ? 1500 : 1000
  const batches   = Math.ceil(targetCount / batchSize)
  let all: RawKline[] = []
  let endTime: number | undefined

  for (let i = 0; i < batches; i++) {
    const batch = await fetchBatch(marketType, symbol, interval, batchSize, endTime)
    if (!batch.length) break
    all = [...batch, ...all]
    endTime = batch[0].timestamp - 1
  }

  const seen = new Set<number>()
  return all
    .filter(k => { if (seen.has(k.timestamp)) return false; seen.add(k.timestamp); return true })
    .sort((a, b) => a.timestamp - b.timestamp)
}

async function fetchTicker(marketType: MarketType, symbol: string): Promise<TickerInfo> {
  const base = marketType === 'futures' ? FUTURES_TICKER : SPOT_TICKER
  const res  = await fetch(`${base}?symbol=${symbol}`)
  if (!res.ok) throw new Error(`Ticker ${res.status}`)
  const d = await res.json()
  return {
    priceChange:    parseFloat(d.priceChange),
    priceChangePct: parseFloat(d.priceChangePercent),
    high24h:        parseFloat(d.highPrice),
    low24h:         parseFloat(d.lowPrice),
    volume24h:      parseFloat(d.volume),
  }
}

// ── Format helpers ────────────────────────────────────────────────────────────
function formatPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (p >= 1)    return p.toLocaleString(undefined, { minimumFractionDigits: 4, maximumFractionDigits: 4 })
  return p.toLocaleString(undefined, { minimumFractionDigits: 6, maximumFractionDigits: 8 })
}

function formatVolume(v: number): string {
  if (v >= 1_000_000_000) return (v / 1_000_000_000).toFixed(2) + 'B'
  if (v >= 1_000_000)     return (v / 1_000_000).toFixed(2) + 'M'
  if (v >= 1_000)         return (v / 1_000).toFixed(2) + 'K'
  return v.toFixed(2)
}

function formatTimestamp(ts: number): string {
  return new Date(ts).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei',
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hour12: false,
  })
}

function timeAgo(ts: number): string {
  const diff = Math.floor((Date.now() - ts) / 1000)
  if (diff < 5)    return '剛剛'
  if (diff < 60)   return `${diff} 秒前`
  if (diff < 3600) return `${Math.floor(diff / 60)} 分前`
  return `${Math.floor(diff / 3600)} 時前`
}

// ── Component ─────────────────────────────────────────────────────────────────
export default function ChartPage() {
  const chartContainerId = 'kline-chart-container'
  const chartRef         = useRef<Chart | null>(null)
  const wsRef            = useRef<WebSocket | null>(null)
  const reconnectTimer   = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickIntervalRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  const symbolRef      = useRef(getSavedSymbol())
  const intervalRef    = useRef(getSavedInterval())
  const marketTypeRef  = useRef<MarketType>(getSavedMarketType())

  const [symbol,          setSymbol]          = useState(symbolRef.current)
  const [interval,        setInterval]        = useState(intervalRef.current)
  const [marketType,      setMarketType]      = useState<MarketType>(marketTypeRef.current)
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState<string | null>(null)
  const [wsStatus,        setWsStatus]        = useState<'connecting'|'live'|'disconnected'>('disconnected')

  const [currentPrice,    setCurrentPrice]    = useState<number | null>(null)
  const [ticker,          setTicker]          = useState<TickerInfo | null>(null)
  const [lastUpdateTs,    setLastUpdateTs]    = useState<number | null>(null)
  const [barTimestamp,    setBarTimestamp]    = useState<number | null>(null)
  const [timeAgoStr,      setTimeAgoStr]      = useState('')

  const [searchQuery,     setSearchQuery]     = useState('')
  const [showSymbolPanel, setShowSymbolPanel] = useState(false)

  // ── Chart init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = init(chartContainerId, {
      layout: [
        { type: 'candle',    options: { gap: { bottom: 2 } } },
        { type: 'indicator', content: ['VOL'],  options: { gap: { top: 4 }, height: 80 } },
      ],
      styles: {
        grid: {
          horizontal: { color: '#1e2328' },
          vertical:   { color: '#1e2328' },
        },
        candle: {
          bar: { upColor: '#26a69a', downColor: '#ef5350', noChangeColor: '#888888' },
          tooltip: { labels: ['時間', '開', '高', '低', '收', '量'] },
        },
        indicator: { ohlc: { upColor: '#26a69a', downColor: '#ef5350' } },
        xAxis: { tickText: { color: '#848e9c' }, axisLine: { color: '#2b2b43' } },
        yAxis: { tickText: { color: '#848e9c' }, axisLine: { color: '#2b2b43' } },
        crosshair: {
          horizontal: { line: { color: '#444' }, text: { color: '#fff', backgroundColor: '#2b2b43' } },
          vertical:   { line: { color: '#444' }, text: { color: '#fff', backgroundColor: '#2b2b43' } },
        },
        background: '#131722',
      },
      locale: 'zh-TW',
      timezone: 'Asia/Taipei',
    })

    if (chart) {
      chart.createIndicator('MA',   false, { id: 'candle_pane' })
      chart.createIndicator('MACD', false, { height: 80 })
      chartRef.current = chart
    }

    return () => { dispose(chartContainerId) }
  }, [])

  // ── 更新「X 秒前」每秒 ─────────────────────────────────────────────────────
  useEffect(() => {
    tickIntervalRef.current = setInterval(() => {
      if (lastUpdateTs !== null) setTimeAgoStr(timeAgo(lastUpdateTs))
    }, 1000)
    return () => { if (tickIntervalRef.current) clearInterval(tickIntervalRef.current) }
  }, [lastUpdateTs])

  // ── WebSocket ──────────────────────────────────────────────────────────────
  const connectWS = useCallback((sym: string, tf: string, mt: MarketType) => {
    if (wsRef.current) { wsRef.current.onclose = null; wsRef.current.close(); wsRef.current = null }
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null }

    setWsStatus('connecting')
    const wsBase = mt === 'futures' ? FUTURES_WS_BASE : SPOT_WS_BASE
    const ws     = new WebSocket(`${wsBase}/${sym.toLowerCase()}@kline_${tf}`)
    wsRef.current = ws

    ws.onopen = () => setWsStatus('live')
    ws.onmessage = (event) => {
      try {
        const k = JSON.parse(event.data)?.k
        if (!k) return
        const candle: RawKline = {
          timestamp: k.t, open: parseFloat(k.o), high: parseFloat(k.h),
          low: parseFloat(k.l), close: parseFloat(k.c),
          volume: parseFloat(k.v), turnover: parseFloat(k.q),
        }
        chartRef.current?.updateData(candle)
        setCurrentPrice(candle.close)
        setBarTimestamp(k.t)
        setLastUpdateTs(Date.now())
      } catch (e) { console.warn('WS parse', e) }
    }
    ws.onerror = () => setWsStatus('disconnected')
    ws.onclose = (e) => {
      setWsStatus('disconnected')
      if (e.code !== 1000) {
        reconnectTimer.current = setTimeout(() =>
          connectWS(symbolRef.current, intervalRef.current, marketTypeRef.current), 3000)
      }
    }
  }, [])

  // ── Load history + ticker ─────────────────────────────────────────────────
  const loadChart = useCallback(async (sym: string, tf: string, mt: MarketType) => {
    if (!chartRef.current) return
    setLoading(true); setError(null); setTicker(null)

    try {
      const [candles, tickerInfo] = await Promise.all([
        fetchKlines(mt, sym, tf, 5000),
        fetchTicker(mt, sym),
      ])
      if (!candles.length) throw new Error('Binance 回傳空資料')
      chartRef.current.applyNewData(candles)

      const last = candles[candles.length - 1]
      setCurrentPrice(last.close)
      setBarTimestamp(last.timestamp)
      setLastUpdateTs(Date.now())
      setTicker(tickerInfo)
    } catch (err: any) {
      console.error('loadChart error:', err)
      setError(err.message || '載入失敗')
      setLoading(false)
      return
    }

    setLoading(false)
    connectWS(sym, tf, mt)
  }, [connectWS])

  // ── Initial load ──────────────────────────────────────────────────────────
  useEffect(() => {
    const t = setTimeout(() => loadChart(symbolRef.current, intervalRef.current, marketTypeRef.current), 100)
    return () => clearTimeout(t)
  }, [loadChart])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const changeSymbol = (sym: string) => {
    symbolRef.current = sym; localStorage.setItem('chart_symbol', sym)
    setSymbol(sym); setShowSymbolPanel(false); setSearchQuery('')
    loadChart(sym, intervalRef.current, marketTypeRef.current)
  }
  const changeInterval = (tf: string) => {
    intervalRef.current = tf; localStorage.setItem('chart_interval', tf)
    setInterval(tf); loadChart(symbolRef.current, tf, marketTypeRef.current)
  }
  const changeMarketType = (mt: MarketType) => {
    marketTypeRef.current = mt; localStorage.setItem('chart_market', mt)
    setMarketType(mt); loadChart(symbolRef.current, intervalRef.current, mt)
  }

  const filteredSymbols = POPULAR_SYMBOLS.filter(s =>
    s.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const priceUp    = (ticker?.priceChange ?? 0) >= 0
  const priceColor = priceUp ? '#26a69a' : '#ef5350'

  const wsStatusColor = wsStatus === 'live'
    ? 'bg-green-500'
    : wsStatus === 'connecting'
    ? 'bg-yellow-400 animate-pulse'
    : 'bg-red-500'

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen overflow-hidden bg-[#131722] text-gray-200">
      <PageHeader title="K 線圖表" />

      {/* ══════════════════════════════════════════════════════
          ROW 1 — Symbol picker + Spot/Futures + WS status
         ══════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-2 px-3 py-1.5 bg-[#1e222d] border-b border-[#2b2b43]">

        {/* Symbol picker */}
        <div className="relative">
          <button
            onClick={() => setShowSymbolPanel(v => !v)}
            className="flex items-center gap-1 px-3 py-1 bg-[#2b2b43] rounded text-sm font-bold hover:bg-[#363a4e]"
          >
            {symbol}
            <ChevronDown size={13} />
          </button>
          {showSymbolPanel && (
            <div className="absolute top-8 left-0 z-50 w-52 bg-[#1e222d] border border-[#2b2b43] rounded shadow-xl">
              <div className="p-2 border-b border-[#2b2b43]">
                <div className="flex items-center gap-2 bg-[#131722] rounded px-2 py-1">
                  <Search size={12} className="text-gray-400" />
                  <input
                    autoFocus
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="搜尋交易對..."
                    className="bg-transparent text-sm outline-none w-full"
                  />
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto">
                {filteredSymbols.map(s => (
                  <button
                    key={s}
                    onClick={() => changeSymbol(s)}
                    className="w-full text-left px-3 py-1.5 text-sm hover:bg-[#2b2b43]"
                    style={{ color: s === symbol ? '#f0b90b' : undefined, fontWeight: s === symbol ? 700 : undefined }}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Spot / Futures */}
        <div className="flex rounded overflow-hidden border border-[#2b2b43]">
          {(['spot', 'futures'] as MarketType[]).map(mt => (
            <button
              key={mt}
              onClick={() => changeMarketType(mt)}
              style={marketType === mt
                ? { backgroundColor: '#f0b90b', color: '#000', fontWeight: 700 }
                : undefined
              }
              className={`px-3 py-1 text-xs font-semibold transition-colors ${
                marketType === mt ? '' : 'bg-[#2b2b43] text-gray-400 hover:bg-[#363a4e]'
              }`}
            >
              {mt === 'spot' ? '現貨' : '合約'}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        {/* WS status + reload */}
        <div className="flex items-center gap-2">
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${wsStatusColor}`} />
            <span className="text-xs text-gray-500">
              {wsStatus === 'live' ? 'Live' : wsStatus === 'connecting' ? '連線中' : '已斷線'}
            </span>
          </div>
          <button
            onClick={() => loadChart(symbolRef.current, intervalRef.current, marketTypeRef.current)}
            className="p-1 rounded hover:bg-[#2b2b43] text-gray-400 hover:text-white"
            title="重新載入"
          >
            <RefreshCw size={13} />
          </button>
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          ROW 2 — Price info bar (Binance-style)
         ══════════════════════════════════════════════════════ */}
      <div className="flex flex-wrap items-center gap-x-5 gap-y-0.5 px-3 py-1.5 bg-[#161a25] border-b border-[#2b2b43]">

        {/* 即時成交價 */}
        <div className="flex flex-col leading-tight">
          <span className="text-xl font-bold font-mono" style={{ color: priceColor }}>
            {currentPrice !== null ? formatPrice(currentPrice) : '—'}
          </span>
          {ticker && (
            <span className="text-xs font-mono" style={{ color: priceColor }}>
              {ticker.priceChange >= 0 ? '+' : ''}{formatPrice(Math.abs(ticker.priceChange))}
              &nbsp;({ticker.priceChange >= 0 ? '+' : ''}{ticker.priceChangePct.toFixed(2)}%)
            </span>
          )}
        </div>

        {/* 分隔線 */}
        {ticker && <div className="h-7 w-px bg-[#2b2b43] mx-1" />}

        {/* 24h 高/低/量 */}
        {ticker && (
          <div className="flex gap-4 text-xs">
            <div className="flex flex-col">
              <span className="text-gray-600">24h 高</span>
              <span className="text-gray-300 font-mono">{formatPrice(ticker.high24h)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-gray-600">24h 低</span>
              <span className="text-gray-300 font-mono">{formatPrice(ticker.low24h)}</span>
            </div>
            <div className="flex flex-col">
              <span className="text-gray-600">24h 量</span>
              <span className="text-gray-300 font-mono">{formatVolume(ticker.volume24h)}</span>
            </div>
          </div>
        )}

        <div className="flex-1" />

        {/* 當前 Bar 時間 + 更新時間 */}
        <div className="flex flex-col items-end text-xs text-gray-500 leading-tight">
          {barTimestamp !== null && (
            <span>
              {formatTimestamp(barTimestamp)}
              <span className="text-gray-600 ml-1">({INTERVAL_LABELS[interval] ?? interval})</span>
            </span>
          )}
          {timeAgoStr && <span className="text-gray-600 text-[10px]">更新 {timeAgoStr}</span>}
        </div>
      </div>

      {/* ══════════════════════════════════════════════════════
          ROW 3 — Interval buttons (獨立一行)
         ══════════════════════════════════════════════════════ */}
      <div className="flex items-center gap-1 px-3 py-1 bg-[#1e222d] border-b border-[#2b2b43]">
        {INTERVALS.map(tf => (
          <button
            key={tf}
            onClick={() => changeInterval(tf)}
            style={interval === tf
              ? { backgroundColor: '#f0b90b', color: '#000', fontWeight: 700 }
              : undefined
            }
            className={`px-2.5 py-0.5 text-xs rounded transition-colors ${
              interval === tf ? '' : 'text-gray-400 hover:text-white hover:bg-[#2b2b43]'
            }`}
          >
            {INTERVAL_LABELS[tf]}
          </button>
        ))}
      </div>

      {/* ══════════════════════════════════════════════════════
          ROW 4 — K-line chart (flex-1, takes all remaining height)
         ══════════════════════════════════════════════════════ */}
      <div className="relative flex-1 min-h-0 overflow-hidden">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#131722]/80">
            <div className="w-7 h-7 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin mb-2" />
            <span className="text-xs text-gray-400">載入歷史 K 線（~5000 根）...</span>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#131722]/90 gap-3">
            <span className="text-red-400 text-sm">{error}</span>
            <button
              onClick={() => loadChart(symbolRef.current, intervalRef.current, marketTypeRef.current)}
              className="px-4 py-1.5 bg-yellow-500 text-black text-sm rounded hover:bg-yellow-400"
            >
              重試
            </button>
          </div>
        )}
        <div id={chartContainerId} className="w-full h-full" style={{ background: '#131722' }} />
      </div>
    </div>
  )
}
