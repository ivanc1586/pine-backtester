import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, IChartApi, ISeriesApi, Time, CrosshairMode } from 'lightweight-charts'
import { Search, RefreshCw, ChevronDown } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import LoadingSpinner from '../components/LoadingSpinner'
import { marketApi } from '../services/api'
import { useStrategyStore } from '../store/strategyStore'

const INTERVALS = ['1m','5m','15m','30m','1h','4h','1d','1w']
const INTERVAL_LABELS: Record<string, string> = {
  '1m':'1分','5m':'5分','15m':'15分','30m':'30分',
  '1h':'1小時','4h':'4小時','1d':'1天','1w':'1週'
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

const getSavedSymbol      = () => localStorage.getItem('chart_symbol')   || 'BTCUSDT'
const getSavedTimeframe   = () => localStorage.getItem('chart_interval')  || '1h'
const getSavedSource      = () => localStorage.getItem('chart_source')    || 'coingecko'

const POLL_MS: Record<string, number> = {
  coingecko: 90_000,
  coincap:   20_000,
  binance:   15_000,
}

export default function ChartPage() {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef           = useRef<IChartApi | null>(null)
  const candleSeriesRef    = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const pollTimerRef       = useRef<ReturnType<typeof window.setInterval> | null>(null)
  const fetchingRef        = useRef(false)

  // Store params in refs so fetchData never captures stale closures
  const symbolRef    = useRef(getSavedSymbol())
  const timeframeRef = useRef(getSavedTimeframe())  // RENAMED: avoid shadowing window.setInterval
  const sourceRef    = useRef(getSavedSource())

  // RENAMED: 'timeframe' instead of 'interval' to avoid shadowing window.setInterval
  const [symbol,    setSymbol]    = useState(symbolRef.current)
  const [timeframe, setTimeframe] = useState(timeframeRef.current)
  const [source,    setSource]    = useState(sourceRef.current)
  const [loading,   setLoading]   = useState(false)
  const [error,     setError]     = useState<string | null>(null)
  const [lastUpdated,    setLastUpdated]    = useState<Date | null>(null)
  const [searchQuery,    setSearchQuery]    = useState('')
  const [showSymbolPanel, setShowSymbolPanel] = useState(false)
  const [currentPrice,   setCurrentPrice]   = useState<number | null>(null)
  const { selectedStrategy } = useStrategyStore()

  // Chart init — runs once only
  useEffect(() => {
    if (!chartContainerRef.current) return
    const chart = createChart(chartContainerRef.current, {
      layout: { background: { color: '#131722' }, textColor: '#d1d4dc' },
      grid:   { vertLines: { color: '#1e2328' }, horzLines: { color: '#1e2328' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2b2b43' },
      timeScale: { borderColor: '#2b2b43', timeVisible: true, secondsVisible: false },
      width: chartContainerRef.current.clientWidth,
      height: 600,
    })
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350',
      borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor: '#26a69a', wickDownColor: '#ef5350'
    })
    chartRef.current = chart
    candleSeriesRef.current = candleSeries

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth })
      }
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [])

  // fetchData reads from refs — never captures stale state
  // useCallback deps is [] so it's created once and never changes,
  // meaning setInterval (window.setInterval) below always uses a stable reference
  const fetchData = useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    setLoading(true)
    setError(null)
    try {
      const sym = symbolRef.current
      const tf  = timeframeRef.current
      const src = sourceRef.current
      const res = await marketApi.getKlines(sym, tf, 500, src)
      const candles = (res as any[]).map((c: any) => ({
        time:  c.timestamp as Time,
        open:  c.open,
        high:  c.high,
        low:   c.low,
        close: c.close,
      }))
      if (candles.length > 0) {
        candleSeriesRef.current?.setData(candles)
        const lastClose = candles[candles.length - 1].close
        setCurrentPrice(lastClose)
        setLastUpdated(new Date())
      }
    } catch (err: any) {
      const detail = err?.response?.data?.detail || err?.message || 'Failed to load data'
      setError(detail)
    } finally {
      setLoading(false)
      fetchingRef.current = false
    }
  }, [])

  // On param change: update refs, persist to localStorage, fetch, restart poll
  useEffect(() => {
    symbolRef.current    = symbol
    timeframeRef.current = timeframe
    sourceRef.current    = source
    localStorage.setItem('chart_symbol',   symbol)
    localStorage.setItem('chart_interval', timeframe)
    localStorage.setItem('chart_source',   source)

    fetchData()

    // Use window.setInterval explicitly — safe because 'setInterval' is NOT shadowed here
    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current)
    const pollMs = POLL_MS[source] ?? 60_000
    pollTimerRef.current = window.setInterval(fetchData, pollMs)

    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current)
    }
  }, [symbol, timeframe, source, fetchData])

  const handleSymbolClick = (sym: string) => {
    setSymbol(sym)
    setShowSymbolPanel(false)
    setSearchQuery('')
  }

  const filteredSymbols = POPULAR_SYMBOLS.filter(s =>
    s.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-[#0b0e11]">
      <PageHeader
        title="市場圖表"
        description="即時加密貨幣K線圖表"
        actions={
          <button
            onClick={fetchData}
            disabled={loading}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            重新整理
          </button>
        }
      />

      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Top toolbar */}
        <div className="bg-[#131722] rounded-lg p-4 mb-4 flex flex-wrap gap-4 items-center">
          {/* Symbol selector */}
          <div className="relative">
            <button
              onClick={() => setShowSymbolPanel(!showSymbolPanel)}
              className="flex items-center gap-2 px-4 py-2 bg-[#1e2328] text-white rounded-lg hover:bg-[#2a2e39] transition-colors"
            >
              <span className="font-semibold text-lg">{symbol}</span>
              <ChevronDown className="w-4 h-4" />
            </button>
            {showSymbolPanel && (
              <div className="absolute top-full left-0 mt-2 w-80 bg-[#1e2328] rounded-lg shadow-xl z-50 p-4">
                <div className="relative mb-3">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="搜尋交易對..."
                    className="w-full pl-10 pr-4 py-2 bg-[#131722] text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
                <div className="max-h-64 overflow-y-auto space-y-1">
                  {filteredSymbols.map(sym => (
                    <button
                      key={sym}
                      onClick={() => handleSymbolClick(sym)}
                      className="w-full text-left px-3 py-2 text-white hover:bg-[#2a2e39] rounded transition-colors"
                    >
                      {sym}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Current price */}
          {currentPrice && (
            <div className="text-white">
              <div className="text-sm text-gray-400">當前價格</div>
              <div className="text-xl font-bold">${currentPrice.toFixed(2)}</div>
            </div>
          )}

          {/* Timeframe buttons — using 'timeframe' state, not 'interval' */}
          <div className="flex gap-1 ml-auto">
            {INTERVALS.map(tf => (
              <button
                key={tf}
                onClick={() => setTimeframe(tf)}
                className={`px-3 py-1.5 rounded transition-colors ${
                  timeframe === tf
                    ? 'bg-blue-600 text-white'
                    : 'bg-[#1e2328] text-gray-400 hover:bg-[#2a2e39]'
                }`}
              >
                {INTERVAL_LABELS[tf]}
              </button>
            ))}
          </div>

          {/* Source selector */}
          <select
            value={source}
            onChange={(e) => setSource(e.target.value)}
            className="px-4 py-2 bg-[#1e2328] text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {SOURCES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>
        </div>

        {/* Error message */}
        {error && (
          <div className="bg-red-900/20 border border-red-500 rounded-lg p-4 mb-4 text-red-400">
            {error}
          </div>
        )}

        {/* Chart */}
        <div className="bg-[#131722] rounded-lg p-4">
          <div className="flex justify-between items-center mb-2">
            <div className="text-white text-sm">
              {selectedStrategy && (
                <span className="text-gray-400">
                  策略: <span className="text-blue-400">{selectedStrategy.name}</span>
                </span>
              )}
            </div>
            {lastUpdated && (
              <div className="text-gray-400 text-xs">
                更新時間: {lastUpdated.toLocaleTimeString('zh-TW')}
              </div>
            )}
          </div>
          <div ref={chartContainerRef} className="relative">
            {loading && (
              <div className="absolute inset-0 bg-[#131722]/80 flex items-center justify-center z-10">
                <LoadingSpinner />
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}