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

const getSavedSymbol   = () => localStorage.getItem('chart_symbol')   || 'BTCUSDT'
const getSavedInterval = () => localStorage.getItem('chart_interval')  || '1h'
const getSavedSource   = () => localStorage.getItem('chart_source')    || 'coingecko'

const POLL_MS: Record<string, number> = {
  coingecko: 90_000,
  coincap:   20_000,
  binance:   15_000,
}

export default function ChartPage() {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef          = useRef<IChartApi | null>(null)
  const candleSeriesRef   = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const pollTimerRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const fetchingRef       = useRef(false)

  // KEY FIX: store params in refs so fetchData never captures stale closures
  const symbolRef   = useRef(getSavedSymbol())
  const intervalRef = useRef(getSavedInterval())
  const sourceRef   = useRef(getSavedSource())

  const [symbol,   setSymbol]   = useState(symbolRef.current)
  const [interval, setInterval] = useState(intervalRef.current)
  const [source,   setSource]   = useState(sourceRef.current)
  const [loading,  setLoading]  = useState(false)
  const [error,    setError]    = useState<string | null>(null)
  const [lastUpdated, setLastUpdated] = useState<Date | null>(null)
  const [searchQuery,     setSearchQuery]     = useState('')
  const [showSymbolPanel, setShowSymbolPanel] = useState(false)
  const [currentPrice,    setCurrentPrice]    = useState<number | null>(null)
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
    chartRef.current = chart
    const candleSeries = chart.addCandlestickSeries({
      upColor: '#26a69a', downColor: '#ef5350',
      borderVisible: false,
      wickUpColor: '#26a69a', wickDownColor: '#ef5350',
    })
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

  // fetchData reads ONLY from refs — stable, no stale-closure problem
  // Empty dep array [] means this function is created once and never recreated
  const fetchData = useCallback(async () => {
    if (fetchingRef.current) return
    fetchingRef.current = true
    setLoading(true)
    setError(null)

    const sym = symbolRef.current
    const ivl = intervalRef.current
    const src = sourceRef.current

    try {
      const res = await marketApi.getKlines(sym, ivl, 500, src)
      if (!res || !Array.isArray(res)) throw new Error('回傳資料格式錯誤')

      const seen = new Set<number>()
      const chartData = res
        .map((k: any) => ({
          time:  Math.floor(Number(k.time) / 1000) as Time,
          open:  Number(k.open),
          high:  Number(k.high),
          low:   Number(k.low),
          close: Number(k.close),
        }))
        .filter(k => {
          if (seen.has(k.time as number)) return false
          seen.add(k.time as number)
          return true
        })
        .sort((a, b) => (a.time as number) - (b.time as number))

      if (chartData.length > 0) {
        candleSeriesRef.current?.setData(chartData)
        setCurrentPrice(chartData[chartData.length - 1]?.close ?? null)
        chartRef.current?.timeScale().fitContent()
      }
      setLastUpdated(new Date())
    } catch (err: any) {
      console.error('Chart fetch error:', err)
      setError(err.message || '載入失敗，請稍後再試')
    } finally {
      setLoading(false)
      fetchingRef.current = false
    }
  }, []) // empty deps — stable function reference

  // restartPolling updates refs then kicks off a fresh fetch + new interval timer
  const restartPolling = useCallback((sym: string, ivl: string, src: string) => {
    symbolRef.current   = sym
    intervalRef.current = ivl
    sourceRef.current   = src

    localStorage.setItem('chart_symbol',   sym)
    localStorage.setItem('chart_interval', ivl)
    localStorage.setItem('chart_source',   src)

    if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    fetchData()
    pollTimerRef.current = setInterval(fetchData, POLL_MS[src] || 60_000)
  }, [fetchData])

  // Mount: initial load + polling
  useEffect(() => {
    restartPolling(symbolRef.current, intervalRef.current, sourceRef.current)
    return () => {
      if (pollTimerRef.current) clearInterval(pollTimerRef.current)
    }
  }, []) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSymbolChange = (sym: string) => {
    setSymbol(sym)
    setShowSymbolPanel(false)
    setSearchQuery('')
    restartPolling(sym, intervalRef.current, sourceRef.current)
  }

  const handleIntervalChange = (ivl: string) => {
    setInterval(ivl)
    restartPolling(symbolRef.current, ivl, sourceRef.current)
  }

  const handleSourceChange = (src: string) => {
    setSource(src)
    restartPolling(symbolRef.current, intervalRef.current, src)
  }

  const filteredSymbols = POPULAR_SYMBOLS.filter(s =>
    s.toLowerCase().includes(searchQuery.toLowerCase())
  )

  return (
    <div className="min-h-screen bg-[#0b0e11]">
      <PageHeader
        title="圖表分析"
        subtitle={selectedStrategy ? `策略: ${selectedStrategy.name}` : '即時市場數據與技術分析'}
      />

      <div className="container mx-auto px-6 py-6">
        <div className="flex flex-wrap items-center gap-4 mb-6">

          {/* Symbol selector */}
          <div className="relative">
            <button
              onClick={() => setShowSymbolPanel(!showSymbolPanel)}
              className="flex items-center gap-2 px-4 py-2 bg-[#1e2329] text-white rounded-lg hover:bg-[#2b3139] transition-colors border border-[#2b2b43]"
            >
              <span className="font-semibold">{symbol}</span>
              {currentPrice && (
                <span className="text-sm text-gray-400">${currentPrice.toFixed(2)}</span>
              )}
              <ChevronDown className="w-4 h-4" />
            </button>

            {showSymbolPanel && (
              <div className="absolute top-full mt-2 w-80 bg-[#1e2329] border border-[#2b2b43] rounded-lg shadow-2xl z-50 max-h-96 overflow-hidden flex flex-col">
                <div className="p-3 border-b border-[#2b2b43]">
                  <div className="relative">
                    <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 w-4 h-4 text-gray-400" />
                    <input
                      type="text"
                      placeholder="搜尋交易對..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-10 pr-4 py-2 bg-[#0b0e11] text-white rounded border border-[#2b2b43] focus:outline-none focus:border-blue-500"
                    />
                  </div>
                </div>
                <div className="overflow-y-auto flex-1">
                  {filteredSymbols.map(sym => (
                    <button
                      key={sym}
                      onClick={() => handleSymbolChange(sym)}
                      className={`w-full text-left px-4 py-2.5 hover:bg-[#2b3139] transition-colors ${
                        sym === symbol ? 'bg-[#2b3139] text-blue-400' : 'text-white'
                      }`}
                    >
                      {sym}
                    </button>
                  ))}
                  {filteredSymbols.length === 0 && (
                    <div className="px-4 py-8 text-center text-gray-400">找不到交易對</div>
                  )}
                </div>
              </div>
            )}
          </div>

          {/* Interval selector */}
          <div className="flex gap-1 bg-[#1e2329] rounded-lg p-1 border border-[#2b2b43]">
            {INTERVALS.map(ivl => (
              <button
                key={ivl}
                onClick={() => handleIntervalChange(ivl)}
                className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                  interval === ivl
                    ? 'bg-blue-600 text-white'
                    : 'text-gray-400 hover:text-white'
                }`}
              >
                {INTERVAL_LABELS[ivl]}
              </button>
            ))}
          </div>

          {/* Source selector */}
          <select
            value={source}
            onChange={(e) => handleSourceChange(e.target.value)}
            className="px-4 py-2 bg-[#1e2329] text-white rounded-lg border border-[#2b2b43] focus:outline-none focus:border-blue-500"
          >
            {SOURCES.map(s => (
              <option key={s.value} value={s.value}>{s.label}</option>
            ))}
          </select>

          {/* Refresh */}
          <button
            onClick={fetchData}
            disabled={loading}
            className="p-2 bg-[#1e2329] text-white rounded-lg hover:bg-[#2b3139] transition-colors border border-[#2b2b43] disabled:opacity-50"
            title="刷新數據"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>

          {lastUpdated && (
            <span className="text-sm text-gray-400 ml-auto">
              更新時間: {lastUpdated.toLocaleTimeString('zh-TW')}
            </span>
          )}
        </div>

        {error && (
          <div className="mb-4 p-4 bg-red-500/10 border border-red-500/20 rounded-lg text-red-400">
            {error}
          </div>
        )}

        <div className="relative bg-[#131722] rounded-lg overflow-hidden border border-[#2b2b43]">
          {loading && (
            <div className="absolute inset-0 flex items-center justify-center bg-[#131722]/80 z-10">
              <LoadingSpinner />
            </div>
          )}
          <div ref={chartContainerRef} />
        </div>
      </div>
    </div>
  )
}