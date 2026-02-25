import { useEffect, useRef, useState, useCallback } from 'react'
import { createChart, IChartApi, ISeriesApi, CandlestickData, Time, CrosshairMode } from 'lightweight-charts'
import { Search, RefreshCw, Wifi, WifiOff, ChevronDown } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import LoadingSpinner from '../components/LoadingSpinner'
import { marketApi } from '../services/api'
import { useStrategyStore } from '../store/strategyStore'

const INTERVALS = ['1m','5m','15m','30m','1h','4h','1d','1w']
const SOURCES = [
  { value: 'binance', label: 'Binance' },
  { value: 'coingecko', label: 'CoinGecko' },
  { value: 'coincap', label: 'CoinCap' },
]
const POPULAR_SYMBOLS = ['BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','MATICUSDT','LINKUSDT','UNIUSDT','LTCUSDT','ATOMUSDT','NEARUSDT']

const getSavedSymbol = () => localStorage.getItem('chart_symbol') || 'BTCUSDT'
const getSavedInterval = () => localStorage.getItem('chart_interval') || '1h'
const getSavedSource = () => localStorage.getItem('chart_source') || 'binance'

const getWsUrl = (symbol: string, interval: string) => {
  const apiUrl = import.meta.env.VITE_API_URL || 'http://localhost:8000'
  const wsBase = apiUrl.replace(/^https/, 'wss').replace(/^http/, 'ws')
  return `${wsBase}/ws/market/${symbol}/${interval}`
}

export default function ChartPage() {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const wsRef = useRef<WebSocket | null>(null)

  const [symbol, setSymbol] = useState(getSavedSymbol)
  const [interval, setInterval] = useState(getSavedInterval)
  const [source, setSource] = useState(getSavedSource)
  const [loading, setLoading] = useState(false)
  const [wsConnected, setWsConnected] = useState(false)
  const [searchQuery, setSearchQuery] = useState('')
  const [showSymbolPanel, setShowSymbolPanel] = useState(false)
  const [symbols] = useState<string[]>(POPULAR_SYMBOLS)
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const { selectedStrategy } = useStrategyStore()

  useEffect(() => {
    if (!chartContainerRef.current) return
    const chart = createChart(chartContainerRef.current, {
      layout: { background: { color: '#131722' }, textColor: '#d1d4dc' },
      grid: { vertLines: { color: '#1e2328' }, horzLines: { color: '#1e2328' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#2a2e39' },
      timeScale: {
        borderColor: '#2a2e39',
        timeVisible: true,
        secondsVisible: false,
        timezone: 'Asia/Taipei',
      },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    })
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a',
      downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a',
      wickDownColor: '#ef5350',
    })
    chartRef.current = chart
    candleSeriesRef.current = candleSeries

    const handleResize = () => {
      if (chartContainerRef.current && chartRef.current) {
        chartRef.current.applyOptions({
          width: chartContainerRef.current.clientWidth,
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

  const connectWebSocket = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.close()
    }

    const ws = new WebSocket(getWsUrl(symbol, interval))

    ws.onopen = () => {
      console.log('WebSocket connected')
      setWsConnected(true)
    }

    ws.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        if (data.type === 'kline' && data.data && candleSeriesRef.current) {
          const kline = data.data
          const candle: CandlestickData = {
            time: (kline.timestamp / 1000) as Time,
            open: kline.open,
            high: kline.high,
            low: kline.low,
            close: kline.close,
          }
          candleSeriesRef.current.update(candle)
          setCurrentPrice(kline.close)
        }
      } catch (error) {
        console.error('Error parsing WebSocket message:', error)
      }
    }

    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      setWsConnected(false)
    }

    ws.onclose = () => {
      console.log('WebSocket disconnected')
      setWsConnected(false)
      setTimeout(() => {
        if (wsRef.current === ws) {
          connectWebSocket()
        }
      }, 5000)
    }

    wsRef.current = ws
  }, [symbol, interval])

  // FIX: 對應後端回傳格式 { klines: [{time(ms), open, high, low, close}] }
  const loadHistoricalData = useCallback(async () => {
    if (!candleSeriesRef.current) return
    setLoading(true)
    try {
      const response = await marketApi.getHistoricalData({
        symbol,
        interval,
        source,
        limit: 1000,
      })

      const raw = response.data
      const list: any[] = raw?.klines ?? raw?.data ?? (Array.isArray(raw) ? raw : [])

      const candles: CandlestickData[] = list
        .map((k: any) => ({
          time: Math.floor((k.time ?? k.timestamp ?? k.open_time) / 1000) as Time,
          open: Number(k.open),
          high: Number(k.high),
          low: Number(k.low),
          close: Number(k.close),
        }))
        .sort((a, b) => (a.time as number) - (b.time as number))

      if (candles.length > 0) {
        candleSeriesRef.current.setData(candles)
        setCurrentPrice(candles[candles.length - 1].close as number)
        chartRef.current?.timeScale().fitContent()
      }
    } catch (error) {
      console.error('Error loading historical data:', error)
    } finally {
      setLoading(false)
    }
  }, [symbol, interval, source])

  useEffect(() => {
    loadHistoricalData()
    connectWebSocket()

    return () => {
      if (wsRef.current) {
        wsRef.current.close()
      }
    }
  }, [loadHistoricalData, connectWebSocket])

  const handleSymbolChange = (newSymbol: string) => {
    setSymbol(newSymbol)
    localStorage.setItem('chart_symbol', newSymbol)
    setShowSymbolPanel(false)
  }

  const handleIntervalChange = (newInterval: string) => {
    setInterval(newInterval)
    localStorage.setItem('chart_interval', newInterval)
  }

  const handleSourceChange = (newSource: string) => {
    setSource(newSource)
    localStorage.setItem('chart_source', newSource)
  }

  const filteredSymbols = symbols.filter(s =>
    s.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="flex flex-col h-screen bg-gray-900">
      <PageHeader title="Market Chart" />

      <div className="flex-1 flex flex-col p-4 space-y-4 overflow-hidden">
        {/* Controls */}
        <div className="flex flex-wrap items-center gap-3 bg-gray-800 p-3 rounded-lg">
          {/* Symbol Selector */}
          <div className="relative">
            <button
              onClick={() => setShowSymbolPanel(!showSymbolPanel)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg text-white font-semibold transition-colors"
            >
              {symbol}
              <ChevronDown size={16} />
            </button>

            {showSymbolPanel && (
              <div className="absolute top-full mt-2 left-0 w-64 bg-gray-800 rounded-lg shadow-xl z-50 border border-gray-700">
                <div className="p-2">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 text-gray-400" size={18} />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search symbol..."
                      className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {filteredSymbols.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleSymbolChange(s)}
                      className={`w-full text-left px-4 py-2 hover:bg-gray-700 transition-colors ${
                        s === symbol ? 'bg-gray-700 text-blue-400' : 'text-white'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                  {filteredSymbols.length === 0 && (
                    <div className="px-4 py-2 text-gray-400 text-center">
                      No symbols found
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Interval Buttons */}
          <div className="flex gap-1 bg-gray-700 rounded-lg p-1">
            {INTERVALS.map((int) => (
              <button
                key={int}
                onClick={() => handleIntervalChange(int)}
                className={`px-3 py-1 rounded transition-colors ${
                  interval === int
                    ? 'bg-blue-500 text-white'
                    : 'text-gray-300 hover:bg-gray-600'
                }`}
              >
                {int}
              </button>
            ))}
          </div>

          {/* Source Dropdown */}
          <select
            value={source}
            onChange={(e) => handleSourceChange(e.target.value)}
            className="px-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {SOURCES.map((src) => (
              <option key={src.value} value={src.value}>
                {src.label}
              </option>
            ))}
          </select>

          {/* Refresh Button */}
          <button
            onClick={loadHistoricalData}
            disabled={loading}
            className="p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors disabled:opacity-50"
          >
            <RefreshCw size={20} className={`text-white ${loading ? 'animate-spin' : ''}`} />
          </button>

          {/* WebSocket Status */}
          <div className="flex items-center gap-2 ml-auto">
            {wsConnected ? (
              <>
                <Wifi size={20} className="text-green-500" />
                <span className="text-green-500 text-sm font-medium">Live</span>
              </>
            ) : (
              <>
                <WifiOff size={20} className="text-red-500" />
                <span className="text-red-500 text-sm font-medium">Disconnected</span>
              </>
            )}
          </div>

          {/* Current Price */}
          {currentPrice && (
            <div className="px-4 py-2 bg-gray-700 rounded-lg">
              <span className="text-gray-400 text-sm mr-2">Price:</span>
              <span className="text-white font-semibold">
                ${currentPrice.toFixed(2)}
              </span>
            </div>
          )}
        </div>

        {/* Strategy Info */}
        {selectedStrategy && (
          <div className="bg-blue-900/20 border border-blue-500/30 rounded-lg p-3">
            <div className="flex items-center gap-2">
              <span className="text-blue-400 text-sm font-medium">Selected Strategy:</span>
              <span className="text-white font-semibold">{selectedStrategy.name}</span>
            </div>
          </div>
        )}

        {/* Chart */}
        <div className="flex-1 bg-gray-800 rounded-lg overflow-hidden relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 z-10">
              <LoadingSpinner />
            </div>
          )}
          <div ref={chartContainerRef} className="w-full h-full" />
        </div>
      </div>
    </div>
  )
}
