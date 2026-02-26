import { useEffect, useRef, useState } from 'react'
import { createChart, IChartApi, ISeriesApi, Time, CrosshairMode } from 'lightweight-charts'
import { Search, ChevronDown } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import LoadingSpinner from '../components/LoadingSpinner'
import { marketApi } from '../services/api'
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

const getSavedSymbol    = () => localStorage.getItem('chart_symbol')   || 'BTCUSDT'
const getSavedTimeframe = () => localStorage.getItem('chart_interval') || '1h'

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
  const chartReadyRef     = useRef(false)   // true once chart+series are initialised
  const pendingLoadRef    = useRef<{sym: string, tf: string} | null>(null)

  const [symbol,          setSymbol]          = useState(getSavedSymbol)
  const [timeframe,       setTimeframe]       = useState(getSavedTimeframe)
  const [loading,         setLoading]         = useState(false)
  const [error,           setError]           = useState<string | null>(null)
  const [lastUpdated,     setLastUpdated]     = useState<Date | null>(null)
  const [searchQuery,     setSearchQuery]     = useState('')
  const [showSymbolPanel, setShowSymbolPanel] = useState(false)
  const [currentPrice,    setCurrentPrice]    = useState<number | null>(null)
  const { selectedStrategy } = useStrategyStore()

  // ── 1. Init chart (once, on mount) ───────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return

    const chart = createChart(chartContainerRef.current, {
      layout: { background: { color: '#131722' }, textColor: '#d1d4dc' },
      grid:   { vertLines: { color: '#1e2328' }, horzLines: { color: '#1e2328' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2b2b43' },
      timeScale: { borderColor: '#2b2b43', timeVisible: true, secondsVisible: false },
      width:  chartContainerRef.current.clientWidth,
      height: 520,
    })

    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350',
      borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor:   '#26a69a', wickDownColor:   '#ef5350',
    })

    chartRef.current        = chart
    candleSeriesRef.current = candleSeries
    chartReadyRef.current   = true

    // If loadChart() was called before chart was ready, run it now
    if (pendingLoadRef.current) {
      const { sym, tf } = pendingLoadRef.current
      pendingLoadRef.current = null
      loadChart(sym, tf)
    }

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current)
        chartRef.current.applyOptions({ width: chartContainerRef.current.clientWidth })
    }
    window.addEventListener('resize', handleResize)

    return () => {
      window.removeEventListener('resize', handleResize)
      chartReadyRef.current = false
      chart.remove()
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  // ── 2. Load REST history + open WebSocket ────────────────────────────────
  function closeWs() {
    if (wsRef.current) {
      const ws = wsRef.current
      ws.onclose   = null
      ws.onerror   = null
      ws.onmessage = null
      ws.close(1000)
      wsRef.current = null
    }
  }

  async function loadChart(sym: string, tf: string) {
    // Guard: chart not ready yet — queue the request
    if (!chartReadyRef.current || !candleSeriesRef.current) {
      pendingLoadRef.current = { sym, tf }
      return
    }

    closeWs()
    setLoading(true)
    setError(null)

    // ── REST: fetch historical candles ───────────────────────────────────
    let formatted: {time: Time; open: number; high: number; low: number; close: number}[] = []
    try {
      const data = await marketApi.getKlines({ symbol: sym, interval: tf, limit: 500 })
      if (!data || data.length === 0) {
        setError('No data available')
        setLoading(false)
        return
      }
      formatted = data.map((k: any) => ({
        time:  k.time as Time,
        open:  Number(k.open),
        high:  Number(k.high),
        low:   Number(k.low),
        close: Number(k.close),
      }))
      candleSeriesRef.current.setData(formatted)
      chartRef.current?.timeScale().fitContent()
      setCurrentPrice(formatted[formatted.length - 1].close)
      setLastUpdated(new Date())
    } catch (err: any) {
      setError(err.message || 'Failed to fetch data')
      setLoading(false)
      return
    }
    setLoading(false)

    // ── WS: real-time updates ────────────────────────────────────────────
    const wsUrl = `${WS_BASE}/api/market/ws/klines/${sym}/${tf}`
    console.info('[WS] connecting:', wsUrl)
    openWs(wsUrl, sym, tf)
  }

  function openWs(url: string, sym: string, tf: string) {
    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => {
      console.info('[WS] opened:', url)
    }

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        if (msg.type === 'ping') return
        if (msg.type === 'error') {
          console.warn('[WS] upstream error:', msg.message)
          return
        }
        const candle = {
          time:  msg.time as Time,
          open:  Number(msg.open),
          high:  Number(msg.high),
          low:   Number(msg.low),
          close: Number(msg.close),
        }
        candleSeriesRef.current?.update(candle)
        setCurrentPrice(Number(msg.close))
        setLastUpdated(new Date())
      } catch (e) {
        console.error('[WS] parse error:', e)
      }
    }

    ws.onerror = (e) => {
      console.error('[WS] error:', e)
    }

    ws.onclose = (e) => {
      console.warn('[WS] closed:', e.code, e.reason)
      // Auto-reconnect for abnormal closes (not 1000=normal, not 1008=invalid interval)
      if (e.code !== 1000 && e.code !== 1008 && wsRef.current === ws) {
        console.info('[WS] reconnecting in 4s...')
        setTimeout(() => {
          if (wsRef.current === ws) openWs(url, sym, tf)
        }, 4000)
      }
    }
  }

  // ── 3. React to symbol/timeframe changes ─────────────────────────────────
  useEffect(() => {
    loadChart(symbol, timeframe)
    return closeWs
  }, [symbol, timeframe]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSymbolChange = (newSym: string) => {
    localStorage.setItem('chart_symbol', newSym)
    setSymbol(newSym)
    setShowSymbolPanel(false)
  }

  const handleTimeframeChange = (newTF: string) => {
    localStorage.setItem('chart_interval', newTF)
    setTimeframe(newTF)
  }

  const filteredSymbols = searchQuery.trim()
    ? POPULAR_SYMBOLS.filter(s => s.toLowerCase().includes(searchQuery.toLowerCase()))
    : POPULAR_SYMBOLS

  return (
    <div className="min-h-screen bg-gray-900">
      <PageHeader
        title="市場圖表"
        subtitle={selectedStrategy ? `Strategy: ${selectedStrategy.name}` : ''}
      />

      <div className="max-w-7xl mx-auto px-4 py-6 space-y-4">

        {/* Controls bar */}
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
                <div className="absolute top-full left-0 mt-2 w-72 bg-gray-800 border border-gray-600 rounded-lg shadow-2xl z-50 max-h-80 overflow-auto">
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
                    {filteredSymbols.map(s => (
                      <button
                        key={s}
                        onClick={() => handleSymbolChange(s)}
                        className={`w-full text-left px-3 py-2 rounded hover:bg-gray-700 transition-colors ${
                          s === symbol ? 'bg-blue-600 text-white' : 'text-gray-300'
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
            <div className="flex gap-2 flex-wrap">
              {INTERVALS.map(int => (
                <button
                  key={int}
                  onClick={() => handleTimeframeChange(int)}
                  className={`px-3 py-2 rounded-lg font-medium text-sm transition-colors ${
                    timeframe === int
                      ? 'bg-blue-600 text-white'
                      : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                  }`}
                >
                  {INTERVAL_LABELS[int]}
                </button>
              ))}
            </div>

            {/* Price + live dot */}
            <div className="ml-auto flex items-center gap-3">
              {currentPrice !== null && (
                <span className="text-white font-mono font-bold text-lg">
                  ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                </span>
              )}
              {lastUpdated && (
                <div className="flex items-center gap-1.5 text-gray-400 text-xs">
                  <span className="inline-block w-2 h-2 rounded-full bg-green-400 animate-pulse" />
                  <span className="font-mono">{lastUpdated.toLocaleTimeString()}</span>
                </div>
              )}
            </div>
          </div>
        </div>

        {/* Error */}
        {error && (
          <div className="bg-red-900/50 border border-red-700 text-red-200 px-4 py-3 rounded-lg text-sm">
            ⚠ {error}
          </div>
        )}

        {/* Chart container - explicit height so lightweight-charts renders */}
        <div className="bg-gray-800 rounded-xl shadow-xl border border-gray-700 relative overflow-hidden">
          {loading && <LoadingSpinner />}
          <div ref={chartContainerRef} style={{ height: '520px' }} className="w-full" />
        </div>

      </div>
    </div>
  )
}
