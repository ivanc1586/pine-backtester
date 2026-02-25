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
      if (chartContainerRef.current && chart) {
        chart.applyOptions({
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

  const loadHistoricalData = useCallback(async () => {
    if (!candleSeriesRef.current) return
    setLoading(true)
    try {
      const res = await marketApi.getHistoricalData(symbol, interval, source, 500)
      // 後端回傳 { klines: [{time(ms), open, high, low, close}] }
      const rawData = res.data ?? res
      const list: any[] = rawData.klines ?? rawData.data ?? (Array.isArray(rawData) ? rawData : [])

      const seen = new Set<number>()
      const formattedData: CandlestickData<Time>[] = list
        .map((candle: any) => ({
          // time 是毫秒 → 秒
          time: Math.floor((candle.time ?? candle.timestamp ?? candle.open_time) / 1000) as Time,
          open: Number(candle.open),
          high: Number(candle.high),
          low: Number(candle.low),
          close: Number(candle.close),
        }))
        .sort((a, b) => (a.time as number) - (b.time as number))
        .filter((candle) => {
          const t = candle.time as number
          if (seen.has(t)) return false
          seen.add(t)
          return true
        })

      if (formattedData.length > 0) {
        candleSeriesRef.current.setData(formattedData)
        setCurrentPrice(formattedData[formattedData.length - 1].close as number)
        chartRef.current?.timeScale().fitContent()
      }
    } catch (error) {
      console.error('Failed to load historical data:', error)
    } finally {
      setLoading(false)
    }
  }, [symbol, interval, source])

  const connectWebSocket = useCallback(() => {
    if (wsRef.current) {
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
        if (data.type === 'kline' && candleSeriesRef.current) {
          const candle: CandlestickData<Time> = {
            time: data.data.timestamp as Time,
            open: data.data.open,
            high: data.data.high,
            low: data.data.low,
            close: data.data.close,
          }
          candleSeriesRef.current.update(candle)
          setCurrentPrice(candle.close as number)
        }
      } catch (error) {
        console.error('WebSocket message error:', error)
      }
    }
    ws.onerror = (error) => {
      console.error('WebSocket error:', error)
      setWsConnected(false)
    }
    ws.onclose = () => {
      console.log('WebSocket disconnected')
      setWsConnected(false)
      setTimeout(() => connectWebSocket(), 3000)
    }
    wsRef.current = ws
  }, [symbol, interval])

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
    setSearchQuery('')
  }

  const handleIntervalChange = (newInterval: string) => {
    setInterval(newInterval)
    localStorage.setItem('chart_interval', newInterval)
  }

  const handleSourceChange = (newSource: string) => {
    setSource(newSource)
    localStorage.setItem('chart_source', newSource)
  }

  const handleRefresh = () => {
    loadHistoricalData()
  }

  const filteredSymbols = symbols.filter((s) =>
    s.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const priceChangePercent = currentPrice && selectedStrategy?.lastSignal
    ? ((currentPrice - selectedStrategy.lastSignal.price) / selectedStrategy.lastSignal.price * 100)
    : null

  return (
    <div className="flex flex-col h-screen bg-gray-900">
      <PageHeader 
        title="Market Chart" 
        subtitle={`Live ${symbol} price chart with ${interval} interval`}
      />
      
      <div className="flex-none px-6 py-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-4">
          <div className="relative">
            <button
              onClick={() => setShowSymbolPanel(!showSymbolPanel)}
              className="flex items-center gap-2 px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
            >
              <span className="text-lg font-semibold text-white">{symbol}</span>
              <ChevronDown className="w-4 h-4 text-gray-400" />
            </button>

            {showSymbolPanel && (
              <div className="absolute top-full left-0 mt-2 w-80 bg-gray-800 border border-gray-700 rounded-lg shadow-xl z-50">
                <div className="p-3 border-b border-gray-700">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Search symbols..."
                      className="w-full pl-10 pr-4 py-2 bg-gray-700 border border-gray-600 rounded-lg text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500"
                      autoFocus
                    />
                  </div>
                </div>
                <div className="max-h-96 overflow-y-auto p-2">
                  {filteredSymbols.map((s) => (
                    <button
                      key={s}
                      onClick={() => handleSymbolChange(s)}
                      className={`w-full text-left px-3 py-2 rounded hover:bg-gray-700 transition-colors ${
                        s === symbol ? 'bg-gray-700 text-blue-400' : 'text-gray-300'
                      }`}
                    >
                      {s}
                    </button>
                  ))}
                  {filteredSymbols.length === 0 && (
                    <div className="text-center py-4 text-gray-400">
                      No symbols found
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>

          <div className="flex gap-2">
            {INTERVALS.map((i) => (
              <button
                key={i}
                onClick={() => handleIntervalChange(i)}
                className={`px-3 py-1.5 rounded transition-colors ${
                  interval === i
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {i}
              </button>
            ))}
          </div>

          <div className="flex gap-2">
            {SOURCES.map((s) => (
              <button
                key={s.value}
                onClick={() => handleSourceChange(s.value)}
                className={`px-3 py-1.5 rounded transition-colors ${
                  source === s.value
                    ? 'bg-blue-500 text-white'
                    : 'bg-gray-700 text-gray-300 hover:bg-gray-600'
                }`}
              >
                {s.label}
              </button>
            ))}
          </div>

          <button
            onClick={handleRefresh}
            className="ml-auto p-2 bg-gray-700 hover:bg-gray-600 rounded-lg transition-colors"
            disabled={loading}
          >
            <RefreshCw className={`w-5 h-5 text-gray-300 ${loading ? 'animate-spin' : ''}`} />
          </button>

          <div className="flex items-center gap-2 px-3 py-2 bg-gray-700 rounded-lg">
            {wsConnected ? (
              <Wifi className="w-4 h-4 text-green-400" />
            ) : (
              <WifiOff className="w-4 h-4 text-red-400" />
            )}
            <span className={`text-sm ${wsConnected ? 'text-green-400' : 'text-red-400'}`}>
              {wsConnected ? 'Live' : 'Disconnected'}
            </span>
          </div>
        </div>

        {currentPrice && (
          <div className="flex items-center gap-4 mt-3">
            <div className="text-2xl font-bold text-white">
              ${currentPrice.toFixed(2)}
            </div>
            {priceChangePercent !== null && (
              <div className={`px-2 py-1 rounded text-sm font-medium ${
                priceChangePercent >= 0 ? 'bg-green-900 text-green-300' : 'bg-red-900 text-red-300'
              }`}>
                {priceChangePercent >= 0 ? '+' : ''}{priceChangePercent.toFixed(2)}%
              </div>
            )}
            {selectedStrategy && (
              <div className="text-sm text-gray-400">
                vs last signal: ${selectedStrategy.lastSignal?.price.toFixed(2)}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="flex-1 relative">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-900/50 z-10">
            <LoadingSpinner size="lg" />
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full" />
      </div>
    </div>
  )
}
