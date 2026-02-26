import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, IChartApi, ISeriesApi, Time, CrosshairMode } from 'lightweight-charts'
import { Search, ChevronDown } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import LoadingSpinner from '../components/LoadingSpinner'
import { useStrategyStore } from '../store/strategyStore'

const INTERVALS = ['1m','5m','15m','30m','1h','4h','1d','1w']
const INTERVAL_LABELS: Record<string, string> = {
  '1m':'1分','5m':'5分','15m':'15分','30m':'30分',
  '1h':'1小時','4h':'4小時','1d':'1天','1w':'1週'
}
const POPULAR_SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','MATICUSDT',
  'LINKUSDT','UNIUSDT','LTCUSDT','ATOMUSDT','NEARUSDT',
]

const getSavedSymbol    = () => localStorage.getItem('chart_symbol')  || 'BTCUSDT'
const getSavedTimeframe = () => localStorage.getItem('chart_interval') || '1h'

// Binance Futures REST — fetch historical klines directly from browser
async function fetchBinanceKlines(symbol: string, interval: string, limit = 500) {
  const url = `https://fapi.binance.com/fapi/v1/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`
  const res = await fetch(url)
  if (!res.ok) throw new Error(`Binance API error: ${res.status}`)
  const raw: any[][] = await res.json()
  return raw.map(k => ({
    time:   Math.floor(Number(k[0]) / 1000) as Time,
    open:   parseFloat(k[1]),
    high:   parseFloat(k[2]),
    low:    parseFloat(k[3]),
    close:  parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }))
}

// Backend WS base URL — same origin in prod, env var in dev
const WS_BASE = (() => {
  const api = import.meta.env.VITE_API_URL || ''
  if (api) return api.replace(/^http/, 'ws')
  return `${window.location.protocol === 'https:' ? 'wss' : 'ws'}://${window.location.host}`
})()

export default function ChartPage() {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef          = useRef<IChartApi | null>(null)
  const candleSeriesRef   = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const wsRef             = useRef<WebSocket | null>(null)
  const markersRef        = useRef<any[]>([])

  const symbolRef    = useRef(getSavedSymbol())
  const timeframeRef = useRef(getSavedTimeframe())

  const [symbol,          setSymbol]          = useState(symbolRef.current)
  const [timeframe,       setTimeframe]       = useState(timeframeRef.current)
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState<string | null>(null)
  const [lastUpdated,     setLastUpdated]     = useState<Date | null>(null)
  const [searchQuery,     setSearchQuery]     = useState('')
  const [showSymbolPanel, setShowSymbolPanel] = useState(false)
  const [currentPrice,    setCurrentPrice]    = useState<number | null>(null)
  const { selectedStrategy } = useStrategyStore()

  // ── Chart init (once) ───────────────────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return
    const chart = createChart(chartContainerRef.current, {
      layout: { background: { color: '#131722' }, textColor: '#d1d4dc' },
      grid:   { vertLines: { color: '#1e2328' }, horzLines: { color: '#1e2328' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2b2b43' },
      timeScale: { borderColor: '#2b2b43', timeVisible: true, secondsVisible: false },
      width:  chartContainerRef.current.clientWidth,
      height: 600,
    })
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350',
      borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor:   '#26a69a', wickDownColor:   '#ef5350',
    })
    chartRef.current        = chart
    candleSeriesRef.current = candleSeries

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current)
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth })
    }
    window.addEventListener('resize', handleResize)
    return () => {
      window.removeEventListener('resize', handleResize)
      chart.remove()
    }
  }, [])

  // ── Apply trade markers onto the chart ──────────────────────────────────
  // Call this after backtest results arrive (from parent / store / props)
  const applyMarkers = useCallback((trades: Array<{
    entry_time: number
    entry_price: number
    exit_time: number
    exit_price: number
    side: 'long' | 'short'
    pnl: number
  }>) => {
    if (!candleSeriesRef.current) return
    const markers: any[] = []
    trades.forEach(t => {
      markers.push({
        time:     Math.floor(t.entry_time / 1000) as Time,
        position: t.side === 'long' ? 'belowBar' : 'aboveBar',
        color:    t.side === 'long' ? '#26a69a'  : '#ef5350',
        shape:    t.side === 'long' ? 'arrowUp'  : 'arrowDown',
        text:     t.side === 'long' ? 'B'        : 'S',
      })
      markers.push({
        time:     Math.floor(t.exit_time / 1000) as Time,
        position: t.side === 'long' ? 'aboveBar' : 'belowBar',
        color:    t.pnl >= 0 ? '#26a69a' : '#ef5350',
        shape:    'circle',
        text:     `${t.pnl >= 0 ? '+' : ''}${t.pnl.toFixed(2)}%`,
      })
    })
    markers.sort((a, b) => (a.time as number) - (b.time as number))
    markersRef.current = markers
    candleSeriesRef.current.setMarkers(markers)
  }, [])

  // ── Load Binance klines, then open backend WS for real-time ─────────────
  const connectChart = useCallback(async (sym: string, tf: string) => {
    // 1. Close existing WS
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }

    // 2. Fetch history directly from Binance Futures
    setLoading(true)
    setError(null)
    try {
      const data = await fetchBinanceKlines(sym, tf, 500)
      if (!data || data.length === 0) {
        setError('No data available')
        setLoading(false)
        return
      }
      candleSeriesRef.current?.setData(data)
      // Re-apply any existing markers after data reload
      if (markersRef.current.length > 0) {
        candleSeriesRef.current?.setMarkers(markersRef.current)
      }
      chartRef.current?.timeScale().fitContent()
      setLastUpdated(new Date())
      setCurrentPrice(data[data.length - 1].close)
    } catch (err: any) {
      setError(err.message || 'Failed to fetch data')
      setLoading(false)
      return
    }
    setLoading(false)

    // 3. Open backend WebSocket for real-time updates
    const wsUrl = `${WS_BASE}/api/market/ws/klines/${sym}/${tf}`
    console.info('Connecting WS:', wsUrl)
    const ws = new WebSocket(wsUrl)
    wsRef.current = ws

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'ping') return
        if (msg.type === 'error') {
          console.warn('WS upstream error:', msg.message)
          return
        }
        const candle = {
          time:  msg.time as Time,
          open:  msg.open,
          high:  msg.high,
          low:   msg.low,
          close: msg.close,
        }
        candleSeriesRef.current?.update(candle)
        setCurrentPrice(msg.close)
        setLastUpdated(new Date())
      } catch (e) {
        console.error('WS message parse error:', e)
      }
    }

    ws.onerror = (e) => console.error('WS error:', e)

    ws.onclose = (e) => {
      console.warn('WS closed:', e.code, e.reason)
      if (e.code !== 1000 && wsRef.current === ws) {
        setTimeout(() => {
          if (wsRef.current === ws)
            connectChart(symbolRef.current, timeframeRef.current)
        }, 3000)
      }
    }
  }, [])

  // ── Trigger on mount ────────────────────────────────────────────────────
  useEffect(() => {
    connectChart(symbolRef.current, timeframeRef.current)
    return () => {
      if (wsRef.current) {
        wsRef.current.onclose = null
        wsRef.current.close(1000)
        wsRef.current = null
      }
    }
  }, [connectChart])

  const handleSymbolChange = (newSymbol: string) => {
    symbolRef.current = newSymbol
    setSymbol(newSymbol)
    localStorage.setItem('chart_symbol', newSymbol)
    setShowSymbolPanel(false)
    markersRef.current = []
    connectChart(newSymbol, timeframeRef.current)
  }

  const handleTimeframeChange = (newTF: string) => {
    timeframeRef.current = newTF
    setTimeframe(newTF)
    localStorage.setItem('chart_interval', newTF)
    markersRef.current = []
    connectChart(symbolRef.current, newTF)
  }

  const filteredSymbols = searchQuery.trim()
    ? POPULAR_SYMBOLS.filter(s => s.toLowerCase().includes(searchQuery.toLowerCase()))
    : POPULAR_SYMBOLS

  return (
    <div className="min-h-screen bg-gray-900">
      <PageHeader
        title="📈 Price Chart"
        subtitle={selectedStrategy ? `Strategy: ${selectedStrategy.name}` : 'Real-time market data'}
      />

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-6">
        {/* Controls */}
        <div className="bg-gray-800 rounded-xl shadow-xl p-4 border border-gray-700">
          <div className="flex flex-wrap gap-4 items-center">

            {/* Symbol selector */}
            <div className="relative">
              <button
                onClick={() => setShowSymbolPanel(!showSymbolPanel)}
                className="flex items-center gap-2 px-4 py-2.5 bg-gray-700 hover:bg-gray-600 text-white rounded-lg transition-colors font-medium"
              >
                <span className="text-yellow-400">●</span>
                {symbol}
                <ChevronDown className={`w-4 h-4 transition-transform ${showSymbolPanel ? 'rotate-180' : ''}`} />
              </button>

              {showSymbolPanel && (
                <div className="absolute top-full left-0 mt-2 w-80 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl z-50 max-h-96 overflow-auto">
                  <div className="p-3 border-b border-gray-700">
                    <div className="relative">
                      <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
                      <input
                        type="text"
                        placeholder="Search symbols..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                        autoFocus
                      />
                    </div>
                  </div>
                  <div className="p-2">
                    {filteredSymbols.length === 0 ? (
                      <div className="text-center py-4 text-gray-400">No symbols found</div>
                    ) : (
                      filteredSymbols.map(s => (
                        <button
                          key={s}
                          onClick={() => handleSymbolChange(s)}
                          className={`w-full text-left px-3 py-2 rounded hover:bg-gray-700 transition-colors ${
                            s === symbol ? 'bg-blue-600 text-white' : 'text-gray-300'
                          }`}
                        >
                          {s}
                        </button>
                      ))
                    )}
                  </div>
                </div>
              )}
            </div>

            {/* Timeframe buttons */}
            <div className="flex gap-2 flex-wrap">
              {INTERVALS.map(int => (
                <button
                  key={int}
                  onClick={() => handleTimeframeChange(int)}
                  className={`px-4 py-2 rounded-lg font-medium transition-colors ${
                    timeframe === int
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {INTERVAL_LABELS[int]}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Status bar */}
        {(lastUpdated || currentPrice !== null) && (
          <div className="bg-gray-800 rounded-lg px-4 py-2 border border-gray-700 flex items-center gap-4 text-sm">
            {currentPrice !== null && (
              <div className="flex items-center gap-2">
                <span className="text-gray-400">Current:</span>
                <span className="text-white font-mono font-bold">${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
              </div>
            )}
            {lastUpdated && (
              <div className="flex items-center gap-2 text-gray-400">
                <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                <span className="font-mono">{lastUpdated.toLocaleTimeString()}</span>
              </div>
            )}
          </div>
        )}

        {/* Error message */}
        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg">
            ⚠ {error}
          </div>
        )}

        {/* Chart */}
        <div className="bg-gray-800 rounded-xl shadow-xl p-4 border border-gray-700 relative">
          {loading && <LoadingSpinner />}
          <div ref={chartContainerRef} className="w-full" />
        </div>
      </div>
    </div>
  )
}
