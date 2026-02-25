import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Time,
  ColorType,
} from 'lightweight-charts'
import { RefreshCw, ChevronDown } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import LoadingSpinner from '../components/LoadingSpinner'
import { marketApi } from '../services/api'

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------
const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']
const INTERVAL_LABELS: Record<string, string> = {
  '1m': '1\u5206', '5m': '5\u5206', '15m': '15\u5206', '30m': '30\u5206',
  '1h': '1\u5c0f\u6642', '4h': '4\u5c0f\u6642', '1d': '\u65e5\u7dda', '1w': '\u9031\u7dda',
}
const POPULAR_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT',
  'LINKUSDT', 'UNIUSDT', 'LTCUSDT', 'ATOMUSDT', 'NEARUSDT',
  'TRXUSDT', 'SHIBUSDT', 'TONUSDT', 'WLDUSDT', 'INJUSDT',
]

const getSaved = (key: string, def: string) =>
  localStorage.getItem(key) || def

// How often to poll the backend (ms) - backend already caches, so 15s is fine
const POLL_MS = 15_000

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------
export default function ChartPage() {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef          = useRef<IChartApi | null>(null)
  const seriesRef         = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const pollTimerRef      = useRef<number | null>(null)
  const clockTimerRef     = useRef<number | null>(null)
  const fetchingRef       = useRef(false)

  // Keep current params in refs so async fetchData always reads fresh values
  const symbolRef   = useRef(getSaved('chart_symbol', 'BTCUSDT'))
  const tfRef       = useRef(getSaved('chart_tf', '1h'))   // 'tf' = timeframe, avoids shadowing

  // React state (drives re-renders for UI)
  const [symbol,       setSymbol]       = useState(symbolRef.current)
  const [tf,           setTf]           = useState(tfRef.current)
  const [loading,      setLoading]      = useState(false)
  const [error,        setError]        = useState<string | null>(null)
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const [lastSync,     setLastSync]     = useState<number | null>(null)   // Unix seconds from backend
  const [nowSec,       setNowSec]       = useState(() => Math.floor(Date.now() / 1000))
  const [searchQuery,  setSearchQuery]  = useState('')
  const [showPanel,    setShowPanel]    = useState(false)

  // ---------------------------------------------------------------------------
  // Chart init (once)
  // ---------------------------------------------------------------------------
  useEffect(() => {
    const container = chartContainerRef.current
    if (!container) return

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#131722' },
        textColor: '#d1d5db',
      },
      grid: {
        vertLines: { color: '#1e2433' },
        horzLines: { color: '#1e2433' },
      },
      crosshair: { mode: 1 },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: '#374151',
      },
      rightPriceScale: { borderColor: '#374151' },
      width:  container.clientWidth,
      height: container.clientHeight,
    })

    const series = chart.addCandlestickSeries({
      upColor:          '#26a69a',
      downColor:        '#ef5350',
      borderUpColor:    '#26a69a',
      borderDownColor:  '#ef5350',
      wickUpColor:      '#26a69a',
      wickDownColor:    '#ef5350',
    })

    chartRef.current  = chart
    seriesRef.current = series

    const onResize = () => {
      chart.applyOptions({
        width:  container.clientWidth,
        height: container.clientHeight,
      })
    }
    window.addEventListener('resize', onResize)

    return () => {
      window.removeEventListener('resize', onResize)
      chart.remove()
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Fetch data
  // ---------------------------------------------------------------------------
  const fetchData = useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    setLoading(true)
    try {
      setError(null)
      const data = await marketApi.getKlines(symbolRef.current, tfRef.current, 500)
      if (data.candles?.length && seriesRef.current) {
        // Backend already returns ts in seconds - pass directly to lightweight-charts
        const chartData: CandlestickData[] = data.candles.map((c) => ({
          time:  c.time as Time,
          open:  c.open,
          high:  c.high,
          low:   c.low,
          close: c.close,
        }))
        seriesRef.current.setData(chartData)
        chartRef.current?.timeScale().fitContent()
        setCurrentPrice(data.currentPrice)
        setLastSync(data.lastSync)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch data')
    } finally {
      fetchingRef.current = false
      setLoading(false)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Auto-poll: refetch every POLL_MS
  // ---------------------------------------------------------------------------
  useEffect(() => {
    fetchData()

    if (pollTimerRef.current) window.clearInterval(pollTimerRef.current)
    pollTimerRef.current = window.setInterval(fetchData, POLL_MS)

    return () => {
      if (pollTimerRef.current) window.clearInterval(pollTimerRef.current)
    }
  }, [symbol, tf, fetchData])

  // ---------------------------------------------------------------------------
  // Clock ticker: update nowSec every second so "last updated" always shows
  // real elapsed time without requiring a network call
  // ---------------------------------------------------------------------------
  useEffect(() => {
    if (clockTimerRef.current) window.clearInterval(clockTimerRef.current)
    clockTimerRef.current = window.setInterval(() => {
      setNowSec(Math.floor(Date.now() / 1000))
    }, 1000)
    return () => {
      if (clockTimerRef.current) window.clearInterval(clockTimerRef.current)
    }
  }, [])

  // ---------------------------------------------------------------------------
  // Handlers
  // ---------------------------------------------------------------------------
  const handleSymbol = useCallback((s: string) => {
    symbolRef.current = s
    setSymbol(s)
    localStorage.setItem('chart_symbol', s)
    setShowPanel(false)
  }, [])

  const handleTf = useCallback((t: string) => {
    tfRef.current = t
    setTf(t)
    localStorage.setItem('chart_tf', t)
  }, [])

  const handleRefresh = useCallback(() => { fetchData() }, [fetchData])

  const filtered = searchQuery
    ? POPULAR_SYMBOLS.filter((s) => s.includes(searchQuery.toUpperCase()))
    : POPULAR_SYMBOLS

  // Human-readable "last updated X seconds ago"
  const lastUpdatedLabel = (() => {
    if (!lastSync) return null
    const elapsed = nowSec - lastSync
    if (elapsed < 5)  return '\u525b\u525b\u66f4\u65b0'
    if (elapsed < 60) return `${elapsed} \u79d2\u524d\u66f4\u65b0`
    const m = Math.floor(elapsed / 60)
    return `${m} \u5206\u9418\u524d\u66f4\u65b0`
  })()

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  return (
    <div className="flex flex-col h-screen bg-gray-900 text-white">
      <PageHeader title="K\u7dda\u5716" />

      <div className="flex-1 flex flex-col overflow-hidden p-4 gap-3">

        {/* \u2500\u2500 Controls \u2500\u2500 */}
        <div className="flex flex-wrap items-center gap-2">

          {/* Symbol picker */}
          <div className="relative">
            <button
              onClick={() => setShowPanel((v) => !v)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 rounded flex items-center gap-1 text-sm font-medium"
            >
              {symbol} <ChevronDown size={14} />
            </button>
            {showPanel && (
              <div className="absolute top-full mt-1 left-0 bg-gray-800 border border-gray-700 rounded shadow-xl p-2 w-64 z-20">
                <input
                  type="text"
                  placeholder="\u641c\u5c0b..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full px-2 py-1 bg-gray-700 rounded text-sm mb-2 outline-none"
                  autoFocus
                />
                <div className="grid grid-cols-2 gap-1 max-h-52 overflow-y-auto">
                  {filtered.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleSymbol(s)}
                      className={`px-2 py-1 text-xs rounded text-left ${
                        s === symbol
                          ? 'bg-blue-600 text-white'
                          : 'bg-gray-700 hover:bg-gray-600 text-gray-200'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>

          {/* Timeframe buttons */}
          <div className="flex gap-1">
            {INTERVALS.map((iv) => (
              <button
                key={iv}
                onClick={() => handleTf(iv)}
                className={`px-2 py-1 text-xs rounded font-medium ${
                  iv === tf
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 hover:bg-gray-600 text-gray-300'
                }`}
              >
                {INTERVAL_LABELS[iv]}
              </button>
            ))}
          </div>

          {/* Refresh button */}
          <button
            onClick={handleRefresh}
            disabled={loading}
            className="px-3 py-1.5 bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded flex items-center gap-1 text-sm"
          >
            <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
            \u5237\u65b0
          </button>

          {/* Price */}
          {currentPrice && (
            <span className="ml-2 text-lg font-bold text-green-400">
              ${currentPrice.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          )}

          {/* Last updated clock - updates every second */}
          {lastUpdatedLabel && (
            <span className="ml-auto text-xs text-gray-400">
              {lastUpdatedLabel}
            </span>
          )}
        </div>

        {/* \u2500\u2500 Error \u2500\u2500 */}
        {error && (
          <div className="bg-red-900/60 border border-red-700 text-red-200 px-3 py-2 rounded text-sm">
            {error}
          </div>
        )}

        {/* \u2500\u2500 Chart \u2500\u2500 */}
        <div className="relative flex-1 rounded border border-gray-700 overflow-hidden">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900/60 z-10">
              <LoadingSpinner />
            </div>
          )}
          <div ref={chartContainerRef} className="w-full h-full" />
        </div>

        {/* \u2500\u2500 Data source label \u2500\u2500 */}
        <div className="text-center text-xs text-gray-600">
          \u8cc7\u6599\u4f86\u6e90: Binance (SQLite \u5feb\u53d6) \u00b7 \u6bcf 60 \u79d2\u81ea\u52d5\u540c\u6b65
        </div>

      </div>
    </div>
  )
}
