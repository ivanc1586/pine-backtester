import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time, CrosshairMode } from 'lightweight-charts'
import { Search, RefreshCw, ChevronDown } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import LoadingSpinner from '../components/LoadingSpinner'
import { marketApi } from '../services/api'
import { useStrategyStore } from '../store/strategyStore'

const INTERVALS = ['1m','5m','15m','30m','1h','4h','1d','1w']
const SOURCES = [
  { value: 'coingecko', label: 'CoinGecko' },
  { value: 'coincap', label: 'CoinCap' },
  { value: 'binance', label: 'Binance' },
]
const POPULAR_SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','MATICUSDT',
  'LINKUSDT','UNIUSDT','LTCUSDT','ATOMUSDT','NEARUSDT',
]

const getSavedSymbol   = () => localStorage.getItem('chart_symbol')   || 'BTCUSDT'
const getSavedInterval = () => localStorage.getItem('chart_interval')  || '1h'
const getSavedSource   = () => localStorage.getItem('chart_source')    || 'coingecko'

// Polling interval per source (ms)
const POLL_MS: Record<string, number> = {
  coingecko: 60_000,   // free tier: 1 req/min is safe
  coincap:   15_000,
  binance:   10_000,
}

export default function ChartPage() {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef          = useRef<IChartApi | null>(null)
  const candleSeriesRef   = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const pollTimerRef      = useRef<ReturnType<typeof setInterval> | null>(null)

  const [symbol,   setSymbol]   = useState(getSavedSymbol)
  const [interval, setInterval] = useState(getSavedInterval)
  const [source,   setSource]   = useState(getSavedSource)
  const [loading,  setLoading]  = useState(false)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [searchQuery,     setSearchQuery]     = useState('')
  const [showSymbolPanel, setShowSymbolPanel] = useState(false)
  const [currentPrice,    setCurrentPrice]    = useState<number | null>(null)
  const { selectedStrategy } = useStrategyStore()

  // ── Chart init ────────────────────────────────────────────────────────────
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
        timezone: 'Asia/Taipei',
      },
      width:  chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    })
    const candleSeries = chart.addCandlestickSeries({
      upColor:      '#26a69a',
      downColor:    '#ef5350',
      borderVisible: false,
      wickUpColor:   '#26a69a',
      wickDownColor: '#ef5350',
    })
    chartRef.current        = chart
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

  // ── Fetch & render ────────────────────────────────────────────────────────
  const loadData = useCallback(async (isRefresh = false) => {
    if (!candleSeriesRef.current) return
    if (!isRefresh) setLoading(true)
    try {
      const data = await marketApi.getKlines(symbol, interval, 500, source)
      if (!Array.isArray(data) || data.length === 0) return

      const formatted: CandlestickData[] = data.map((c: any) => ({
        time:  Math.floor(c.timestamp / 1000) as Time,
        open:  c.open,
        high:  c.high,
        low:   c.low,
        close: c.close,
      }))

      // Sort by time ascending (some APIs return unsorted)
      formatted.sort((a, b) => (a.time as number) - (b.time as number))

      // Remove duplicate timestamps (lightweight-charts throws on duplicates)
      const deduped = formatted.filter(
        (c, i, arr) => i === 0 || c.time !== arr[i - 1].time
      )

      candleSeriesRef.current.setData(deduped)
      setCurrentPrice(deduped[deduped.length - 1].close)
      setLastUpdated(new Date())
    } catch (err) {
      console.error('Failed to load chart data:', err)
    } finally {
      setLoading(false)
    }
  }, [symbol, interval, source])

  // ── Polling setup ─────────────────────────────────────────────────────────
  useEffect(() => {
    // Clear previous poll
    if (pollTimerRef.current) {
      clearInterval(pollTimerRef.current)
      pollTimerRef.current = null
    }

    // Initial load
    loadData(false)

    // Start polling
    const ms = POLL_MS[source] ?? 30_000
    pollTimerRef.current = setInterval(() => loadData(true), ms)

    return () => {
      if (pollTimerRef.current) {
        clearInterval(pollTimerRef.current)
        pollTimerRef.current = null
      }
    }
  }, [symbol, interval, source, loadData])

  // ── Handlers ──────────────────────────────────────────────────────────────
  const handleSymbolChange = (s: string) => {
    setSymbol(s)
    localStorage.setItem('chart_symbol', s)
    setShowSymbolPanel(false)
  }
  const handleIntervalChange = (i: string) => {
    setInterval(i)
    localStorage.setItem('chart_interval', i)
  }
  const handleSourceChange = (s: string) => {
    setSource(s)
    localStorage.setItem('chart_source', s)
  }

  const filteredSymbols = POPULAR_SYMBOLS.filter(s =>
    s.toLowerCase().includes(searchQuery.toLowerCase())
  )

  // ── Render ────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-screen bg-gray-900">
      <PageHeader />

      {/* Toolbar */}
      <div className="flex items-center gap-4 px-6 py-3 bg-gray-800 border-b border-gray-700 flex-wrap">

        {/* Symbol Selector */}
        <div className="relative">
          <button
            onClick={() => setShowSymbolPanel(!showSymbolPanel)}
            className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
          >
            <span className="font-semibold text-white">{symbol}</span>
            <ChevronDown className="w-4 h-4 text-gray-400" />
          </button>

          {showSymbolPanel && (
            <div className="absolute top-full left-0 mt-2 w-64 bg-gray-800 rounded-lg shadow-xl border border-gray-700 z-50">
              <div className="p-3 border-b border-gray-700">
                <div className="relative">
                  <Search className="absolute left-3 top-2.5 w-4 h-4 text-gray-400" />
                  <input
                    type="text"
                    placeholder="Search symbols..."
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    className="w-full pl-10 pr-4 py-2 bg-gray-700 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                  />
                </div>
              </div>
              <div className="max-h-96 overflow-y-auto p-2">
                {filteredSymbols.map(s => (
                  <button
                    key={s}
                    onClick={() => handleSymbolChange(s)}
                    className={`w-full text-left px-4 py-2 rounded-lg transition-colors ${
                      s === symbol ? 'bg-blue-600 text-white' : 'text-gray-300 hover:bg-gray-700'
                    }`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Interval Buttons */}
        <div className="flex gap-1">
          {INTERVALS.map(int => (
            <button
              key={int}
              onClick={() => handleIntervalChange(int)}
              className={`px-3 py-2 rounded-lg transition-colors text-sm ${
                interval === int
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {int}
            </button>
          ))}
        </div>

        {/* Source Buttons */}
        <div className="flex gap-1">
          {SOURCES.map(src => (
            <button
              key={src.value}
              onClick={() => handleSourceChange(src.value)}
              className={`px-3 py-2 rounded-lg transition-colors text-sm ${
                source === src.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
              }`}
            >
              {src.label}
            </button>
          ))}
        </div>

        {/* Refresh */}
        <button
          onClick={() => loadData(false)}
          disabled={loading}
          className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
        >
          <RefreshCw className={`w-5 h-5 text-gray-300 ${loading ? 'animate-spin' : ''}`} />
        </button>

        {/* Status */}
        <div className="flex items-center gap-3 ml-auto">
          {lastUpdated && (
            <span className="text-xs text-gray-500">
              Updated {lastUpdated.toLocaleTimeString()}
            </span>
          )}
          {currentPrice && (
            <div className="text-white font-mono text-lg">
              ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900 bg-opacity-50 z-10">
            <LoadingSpinner />
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full" />
      </div>

      {/* Strategy Info */}
      {selectedStrategy && (
        <div className="px-6 py-4 bg-gray-800 border-t border-gray-700">
          <div className="flex items-center justify-between">
            <div>
              <h3 className="text-white font-semibold">{selectedStrategy.name}</h3>
              <p className="text-gray-400 text-sm">{selectedStrategy.description}</p>
            </div>
            <button className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors">
              Run Backtest
            </button>
          </div>
        </div>
      )}
    </div>
  )
}