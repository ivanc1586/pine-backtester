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
      if (chartContainerRef.current) {
        chart.applyOptions({
          width: chartContainerRef.current.clientWidth,
          height: chartContainerRef.current.clientHeight,
        })
      }
    }
    window.addEventListener('resize', handleResize)
    return () => { window.removeEventListener('resize', handleResize); chart.remove() }
  }, [])

  const loadHistoricalData = useCallback(async () => {
    if (!candleSeriesRef.current) return
    setLoading(true)
    try {
      const res = await marketApi.getHistoricalData({ symbol, interval, source, limit: 500 })
      const rawData = res.data
      const list = Array.isArray(rawData) ? rawData : (rawData.data || rawData.klines || [])
      const data: CandlestickData[] = list
        .map((k: any) => ({
          time: (typeof k.timestamp === 'number'
            ? Math.floor(k.timestamp / 1000)
            : Math.floor(new Date(k.time || k.open_time || k.t).getTime() / 1000)
          ) as Time,
          open: Number(k.open ?? k.o),
          high: Number(k.high ?? k.h),
          low: Number(k.low ?? k.l),
          close: Number(k.close ?? k.c),
        }))
        .sort((a: CandlestickData, b: CandlestickData) => (a.time as number) - (b.time as number))
        .filter((k: CandlestickData, i: number, arr: CandlestickData[]) =>
          i === 0 || (k.time as number) > (arr[i - 1].time as number)
        )
      if (data.length > 0) {
        candleSeriesRef.current?.setData(data)
        setCurrentPrice(data[data.length - 1].close as number)
        chartRef.current?.timeScale().fitContent()
      }
    } catch (error) {
      console.error('Failed to load historical data:', error)
    } finally {
      setLoading(false)
    }
  }, [symbol, interval, source])

  const connectWebSocket = useCallback(() => {
    if (wsRef.current) wsRef.current.close()
    const wsUrl = getWsUrl(symbol, interval)
    const ws = new WebSocket(wsUrl)
    ws.onopen = () => setWsConnected(true)
    ws.onmessage = (event) => {
      try {
        const kline = JSON.parse(event.data)
        const time = (typeof kline.timestamp === 'number'
          ? Math.floor(kline.timestamp / 1000)
          : Math.floor(new Date(kline.time || kline.t).getTime() / 1000)
        ) as Time
        const candle: CandlestickData = {
          time,
          open: Number(kline.open ?? kline.o),
          high: Number(kline.high ?? kline.h),
          low: Number(kline.low ?? kline.l),
          close: Number(kline.close ?? kline.c),
        }
        candleSeriesRef.current?.update(candle)
        setCurrentPrice(candle.close as number)
      } catch (e) {
        console.error('WebSocket parse error:', e)
      }
    }
    ws.onerror = () => setWsConnected(false)
    ws.onclose = () => setWsConnected(false)
    wsRef.current = ws
  }, [symbol, interval])

  const disconnectWebSocket = useCallback(() => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null; setWsConnected(false) }
  }, [])

  useEffect(() => {
    localStorage.setItem('chart_symbol', symbol)
    localStorage.setItem('chart_interval', interval)
    localStorage.setItem('chart_source', source)
    loadHistoricalData()
    return () => { disconnectWebSocket() }
  }, [symbol, interval, source, loadHistoricalData, disconnectWebSocket])

  const handleSymbolChange = (newSymbol: string) => {
    disconnectWebSocket()
    setSymbol(newSymbol)
    setShowSymbolPanel(false)
    setSearchQuery('')
  }

  const handleIntervalChange = (newInterval: string) => {
    disconnectWebSocket()
    setInterval(newInterval)
  }

  const filteredSymbols = symbols.filter(s => s.toLowerCase().includes(searchQuery.toLowerCase()))

  return (
    <div className="h-screen flex flex-col bg-gray-900">
      <PageHeader title="Live Chart" subtitle="Real-time market data visualization" />
      <div className="flex-1 flex flex-col p-4 gap-4">
        <div className="flex gap-2 flex-wrap items-center bg-gray-800 p-3 rounded-lg">
          <div className="relative">
            <button onClick={() => setShowSymbolPanel(!showSymbolPanel)} className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 flex items-center gap-2 font-mono">
              {symbol} <ChevronDown size={16} />
            </button>
            {showSymbolPanel && (
              <div className="absolute top-full left-0 mt-1 bg-gray-800 border border-gray-700 rounded shadow-lg z-10 w-64">
                <div className="p-2 border-b border-gray-700">
                  <div className="relative">
                    <Search className="absolute left-2 top-2.5 text-gray-400" size={16} />
                    <input type="text" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} placeholder="Search symbols..." className="w-full pl-8 pr-3 py-2 bg-gray-700 text-white rounded text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
                  </div>
                </div>
                <div className="max-h-64 overflow-y-auto">
                  {filteredSymbols.map(s => (
                    <button key={s} onClick={() => handleSymbolChange(s)} className="w-full text-left px-4 py-2 hover:bg-gray-700 text-white font-mono text-sm">{s}</button>
                  ))}
                </div>
              </div>
            )}
          </div>
          <select value={interval} onChange={(e) => handleIntervalChange(e.target.value)} className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500">
            {INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
          </select>
          <select value={source} onChange={(e) => setSource(e.target.value)} className="px-4 py-2 bg-gray-700 text-white rounded hover:bg-gray-600 focus:outline-none focus:ring-2 focus:ring-blue-500">
            {SOURCES.map(src => <option key={src.value} value={src.value}>{src.label}</option>)}
          </select>
          <button onClick={loadHistoricalData} disabled={loading} className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50 flex items-center gap-2">
            <RefreshCw size={16} className={loading ? 'animate-spin' : ''} /> Refresh
          </button>
          {wsConnected ? (
            <button onClick={disconnectWebSocket} className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 flex items-center gap-2">
              <WifiOff size={16} /> Disconnect
            </button>
          ) : (
            <button onClick={connectWebSocket} className="px-4 py-2 bg-green-600 text-white rounded hover:bg-green-700 flex items-center gap-2">
              <Wifi size={16} /> Connect Live
            </button>
          )}
          {currentPrice && (
            <div className="ml-auto flex items-center gap-2 px-4 py-2 bg-gray-700 rounded">
              <span className="text-gray-400">Price:</span>
              <span className="text-white font-mono font-bold">${currentPrice.toFixed(2)}</span>
            </div>
          )}
        </div>
        <div ref={chartContainerRef} className="flex-1 bg-gray-800 rounded-lg overflow-hidden relative">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-gray-800 bg-opacity-75 z-10">
              <LoadingSpinner />
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
