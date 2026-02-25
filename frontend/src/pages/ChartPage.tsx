import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, IChartApi, ISeriesApi, Time, CrosshairMode } from 'lightweight-charts'
import { Search, RefreshCw, ChevronDown } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import LoadingSpinner from '../components/LoadingSpinner'
import { marketApi } from '../services/api'
import { useStrategyStore } from '../store/strategyStore'

const INTERVALS = ['1m','5m','15m','30m','1h','4h','1d','1w']
const INTERVAL_LABELS: Record<string, string> = {
  '1m':'1米','5m':'5米','15m':'15米','30m':'30米','1h':'1小時','4h':'4小時','1d':'1天','1w':'1週'
}
const SOURCES = [
  { value: 'coingecko', label: 'CoinGecko' },
  { value: 'coincap',   label: 'CoinCap' },
  { value: 'binance',   label: 'Binance 幣安' },
]
const POPULAR_SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','MATICUSDT',
  'LINKUSDT','UNIUSDT','LTCUSDT','ATOMUSDT','NEARUSDT',
]

const getSavedSymbol   = () => localStorage.getItem('chart_symbol')   || 'BTCUSDT'
const getSavedInterval = () => localStorage.getItem('chart_interval')  || '1h'
const getSavedSource   = () => localStorage.getItem('chart_source')    || 'coingecko'

// CoinGecko free tier: max 30 req/min. Poll every 90s to stay safe.
const POLL_MS: Record<string, number> = {
  coingecko: 90_000,
  coincap:   20_000,
  binance:   10_000,
}

export default function ChartPage() {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef          = useRef<IChartApi | null>(null)
  const candleSeriesRef   = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const pollTimerRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const fetchingRef       = useRef(false)   // prevent concurrent fetches

  const [symbol,   setSymbol]   = useState(getSavedSymbol)
  const [interval, setInterval] = useState(getSavedInterval)
  const [source,   setSource]   = useState(getSavedSource)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [searchQuery,     setSearchQuery]     = useState('')
  const [showSymbolPanel, setShowSymbolPanel] = useState(false)
  const [currentPrice,    setCurrentPrice]    = useState<number | null>(null)
  const { selectedStrategy } = useStrategyStore()

  // ── Chart init (runs once) ───────────────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return
    const chart = createChart(chartContainerRef.current, {
      layout: { background: { color: '#131722' }, textColor: '#d1d4dc' },
      grid:   { vertLines: { color: '#1e2328' }, horzLines: { color: '#1e2328' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2a2e39' },
      timeScale: {
        borderColor: '#2a2e39',
        timeVisible: true,
        secondsVisible: false,
      },
      width:  chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    })
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    })
    chartRef.current       = chart
    candleSeriesRef.current = candleSeries

    const handleResize = () => {
      if (chartContainerRef.current) {
        chart.applyOptions({
          width:  chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        })
      }
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [])

  // ── Fetch data ───────────────────────────────────────────────────────────
  // NOTE: symbol/interval/source are captured via closure; useCallback deps ensure
  //       a new function reference is created whenever they change, which triggers
  //       the poll useEffect to restart with the new values.
  const fetchData = useCallback(async (sym: string, iv: string, src: string) => {
    if (!candleSeriesRef.current) return
    if (fetchingRef.current) return   // skip if already fetching
    fetchingRef.current = true
    setLoading(true)
    setError(null)
    try {
      // Pass all three values explicitly — no closures, no stale reads
      const data = await marketApi.getKlines(sym, iv, 500, src)
      if (!Array.isArray(data) || data.length === 0) {
        setError('No data returned from API')
        return
      }
      // Deduplicate and sort by timestamp ascending
      const seen = new Set<number>()
      const candles = data
        .filter((k: any) => {
          const ts = Math.floor(k.timestamp / 1000)
          if (seen.has(ts)) return false
          seen.add(ts)
          return true
        })
        .sort((a: any, b: any) => a.timestamp - b.timestamp)
        .map((k: any) => ({
          time:  Math.floor(k.timestamp / 1000) as Time,
          open:  Number(k.open),
          high:  Number(k.high),
          low:   Number(k.low),
          close: Number(k.close),
        }))

      candleSeriesRef.current.setData(candles)
      if (candles.length > 0) {
        setCurrentPrice((candles[candles.length - 1] as any).close)
      }
      setLastUpdated(new Date())
    } catch (err: any) {
      const msg = err?.response?.data?.detail || err?.message || 'Fetch failed'
      setError(msg)
      console.error('ChartPage fetch error:', err)
    } finally {
      setLoading(false)
      fetchingRef.current = false
    }
  }, [])  // stable — params passed explicitly

  // ── Auto-fetch + poll whenever symbol/interval/source changes ────────────
  useEffect(() => {
    // Clear old timer
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }
    // Immediate fetch
    fetchData(symbol, interval, source)
    // Schedule polling
    const ms = POLL_MS[source] ?? 60_000
    pollTimerRef.current = setInterval(() => fetchData(symbol, interval, source), ms)
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, [symbol, interval, source, fetchData])

  // ── Persist preferences ──────────────────────────────────────────────────
  useEffect(() => {
    localStorage.setItem('chart_symbol',   symbol)
    localStorage.setItem('chart_interval', interval)
    localStorage.setItem('chart_source',   source)
  }, [symbol, interval, source])

  const filteredSymbols = POPULAR_SYMBOLS.filter(s =>
    s.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="h-screen flex flex-col bg-[#0b0e11]">
      <PageHeader title="Market Chart" />

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-[#161a1e] border-b border-gray-800">

        {/* Symbol picker */}
        <div className="relative">
          <button
            onClick={() => setShowSymbolPanel(!showSymbolPanel)}
            className="flex items-center gap-2 px-3 py-1.5 bg-[#1e2329] text-white rounded hover:bg-[#2a2e39]"
          >
            <span className="font-semibold text-sm">{symbol}</span>
            <ChevronDown size={14} />
          </button>
          {showSymbolPanel && (
            <div className="absolute top-full left-0 mt-1 w-72 bg-[#1e2329] border border-gray-700 rounded-lg shadow-xl z-50">
              <div className="p-2 border-b border-gray-700">
                <div className="relative">
                  <Search className="absolute left-2.5 top-2 text-gray-500" size={16} />
                  <input
                    type="text"
                    placeholder="Search..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 text-sm bg-[#131722] text-white rounded border border-gray-600 focus:border-blue-500 focus:outline-none"
                    autoFocus
                  />
                </div>
              </div>
              <div className="max-h-56 overflow-y-auto p-1">
                {filteredSymbols.map(sym => (
                  <button
                    key={sym}
                    onClick={() => { setSymbol(sym); setShowSymbolPanel(false); setSearchQuery('') }}
                    className="w-full text-left px-3 py-1.5 text-sm text-white hover:bg-[#2a2e39] rounded"
                  >
                    {sym}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Interval buttons */}
        <div className="flex gap-1">
          {INTERVALS.map(iv => (
            <button
              key={iv}
              onClick={() => setInterval(iv)}
              className={`px-2.5 py-1.5 text-xs rounded transition-colors ${
                interval === iv
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#1e2329] text-gray-400 hover:bg-[#2a2e39] hover:text-white'
              }`}
            >
              {iv} <span className="text-gray-500">{INTERVAL_LABELS[iv]}</span>
            </button>
          ))}
        </div>

        {/* Source buttons */}
        <div className="flex gap-1 ml-2">
          {SOURCES.map(src => (
            <button
              key={src.value}
              onClick={() => setSource(src.value)}
              className={`px-3 py-1.5 text-xs rounded transition-colors ${
                source === src.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-[#1e2329] text-gray-400 hover:bg-[#2a2e39] hover:text-white'
              }`}
            >
              {src.label}
            </button>
          ))}
        </div>

        {/* Refresh */}
        <button
          onClick={() => fetchData(symbol, interval, source)}
          disabled={loading}
          className="p-1.5 bg-[#1e2329] text-white rounded hover:bg-[#2a2e39] disabled:opacity-50"
          title="Refresh"
        >
          <RefreshCw size={16} className={loading ? 'animate-spin' : ''} />
        </button>

        {/* Price + timestamp */}
        <div className="ml-auto flex items-center gap-4">
          {lastUpdated && (
            <span className="text-gray-500 text-xs">
              Updated {lastUpdated.toLocaleTimeString()} 更新於{lastUpdated.toLocaleTimeString()}
            </span>
          )}
          {currentPrice != null && (
            <span className="text-white font-semibold text-lg">
              ${currentPrice.toLocaleString()}
            </span>
          )}
        </div>
      </div>

      {/* Error banner */}
      {error && (
        <div className="px-4 py-2 bg-red-900/40 border-b border-red-700 text-red-300 text-xs">
          {error}
        </div>
      )}

      {/* Chart */}
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center z-10 pointer-events-none">
            <LoadingSpinner />
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full" />
      </div>
    </div>
  )
}