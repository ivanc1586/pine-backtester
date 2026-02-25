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

export default function ChartPage() {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const wsRef = useRef<WebSocket | null>(null)
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setInterval] = useState('1h')
  const [source, setSource] = useState('binance')
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
      timeScale: { borderColor: '#2a2e39', timeVisible: true, secondsVisible: false },
      width: chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight,
    })
    const candleSeries = chart.addCandlestickSeries({ upColor: '#26a69a', downColor: '#ef5350', borderVisible: false, wickUpColor: '#26a69a', wickDownColor: '#ef5350' })
    chartRef.current = chart
    candleSeriesRef.current = candleSeries
    const handleResize = () => { if (chartContainerRef.current) chart.applyOptions({ width: chartContainerRef.current.clientWidth, height: chartContainerRef.current.clientHeight }) }
    window.addEventListener('resize', handleResize)
    return () => { window.removeEventListener('resize', handleResize); chart.remove() }
  }, [])

  const getIntervalMs = (iv: string) => ({ '1m':60000,'5m':300000,'15m':900000,'30m':1800000,'1h':3600000,'4h':14400000,'1d':86400000,'1w':604800000 }[iv] || 3600000)

  const loadKlines = useCallback(async () => {
    if (!candleSeriesRef.current) return
    setLoading(true)
    try {
      const end = Date.now(), start = end - 200 * getIntervalMs(interval)
      const res = await marketApi.getKlines({ symbol, interval, start_time: start, end_time: end, limit: 500, source: source as any })
      const candles: CandlestickData[] = res.data.data.map((c: any) => ({ time: c.time as Time, open: c.open, high: c.high, low: c.low, close: c.close }))
      candleSeriesRef.current.setData(candles)
      chartRef.current?.timeScale().fitContent()
      if (candles.length > 0) setCurrentPrice(candles[candles.length - 1].close as number)
    } catch (e) { console.error(e) } finally { setLoading(false) }
  }, [symbol, interval, source])

  useEffect(() => { loadKlines() }, [loadKlines])

  useEffect(() => {
    if (source !== 'binance') return
    wsRef.current?.close()
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${interval}`)
    ws.onopen = () => setWsConnected(true)
    ws.onclose = () => setWsConnected(false)
    ws.onmessage = (e) => {
      const data = JSON.parse(e.data)
      if (data.k && candleSeriesRef.current) {
        const k = data.k
        candleSeriesRef.current.update({ time: Math.floor(k.t / 1000) as Time, open: parseFloat(k.o), high: parseFloat(k.h), low: parseFloat(k.l), close: parseFloat(k.c) })
        setCurrentPrice(parseFloat(k.c))
      }
    }
    wsRef.current = ws
    return () => ws.close()
  }, [symbol, interval, source])

  const filteredSymbols = symbols.filter(s => s.toLowerCase().includes(searchQuery.toLowerCase()))

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader title="即時K線行情" subtitle={selectedStrategy ? `策略: ${selectedStrategy.name}` : '選擇策略以顯示買賣訊號'} actions={<div className="flex items-center gap-2">{source === 'binance' ? (wsConnected ? <span className="flex items-center gap-1 text-[#26a69a] text-xs"><Wifi size={12} />即時</span> : <span className="flex items-center gap-1 text-[#787b86] text-xs"><WifiOff size={12} />離線</span>) : null}<button onClick={loadKlines} className="p-1.5 rounded hover:bg-[#2a2e39] text-[#787b86] hover:text-white transition-colors"><RefreshCw size={14} /></button></div>} />
      <div className="flex items-center gap-2 px-4 py-2 bg-[#1e2328] border-b border-[#2a2e39] shrink-0 flex-wrap">
        <div className="relative">
          <button onClick={() => setShowSymbolPanel(!showSymbolPanel)} className="flex items-center gap-2 bg-[#131722] border border-[#2a2e39] rounded-lg px-3 py-1.5 text-white text-sm font-bold hover:border-[#2196f3] transition-colors min-w-[130px]"><span className="text-[#2196f3]">●</span>{symbol}<ChevronDown size={14} className="text-[#787b86] ml-auto" /></button>
          {showSymbolPanel && (<div className="absolute top-full left-0 mt-1 w-64 bg-[#1e2328] border border-[#2a2e39] rounded-lg shadow-2xl z-50"><div className="p-2 border-b border-[#2a2e39]"><div className="flex items-center gap-2 bg-[#131722] rounded px-2 py-1.5"><Search size={14} className="text-[#787b86]" /><input value={searchQuery} onChange={e => setSearchQuery(e.target.value)} placeholder="搜尋交易對..." className="bg-transparent text-[#d1d4dc] text-sm outline-none flex-1" autoFocus /></div></div><div className="max-h-60 overflow-y-auto py-1">{filteredSymbols.map(s => (<button key={s} onClick={() => { setSymbol(s); setShowSymbolPanel(false); setSearchQuery('') }} className={`w-full text-left px-4 py-2 text-sm hover:bg-[#2a2e39] transition-colors ${s === symbol ? 'text-[#2196f3] bg-[#2196f3]/10' : 'text-[#d1d4dc]'}`}>{s.replace('USDT','')} <span className="text-[#787b86]">/ USDT</span></button>))}</div></div>)}
        </div>
        <div className="flex gap-1">{INTERVALS.map(iv => (<button key={iv} onClick={() => setInterval(iv)} className={`px-2.5 py-1 rounded text-xs font-medium transition-colors ${interval === iv ? 'bg-[#2196f3] text-white' : 'text-[#787b86] hover:text-white hover:bg-[#2a2e39]'}`}>{iv}</button>))}</div>
        <select value={source} onChange={e => setSource(e.target.value)} className="select-field text-xs py-1.5">{SOURCES.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select>
        {loading && <LoadingSpinner size={16} />}
        {currentPrice && <span className="ml-auto text-white font-mono font-bold">{currentPrice.toLocaleString()}</span>}
      </div>
      <div ref={chartContainerRef} className="flex-1 relative" />
    </div>
  )
}