import { useEffect, useRef, useState, useCallback } from 'react'
import { init, dispose, Chart } from 'klinecharts'
import { Search, ChevronDown, RefreshCw } from 'lucide-react'
import PageHeader from '../components/PageHeader'

// ── Constants ────────────────────────────────────────────────────────────────
const INTERVALS = ['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','1w']
const INTERVAL_LABELS: Record<string, string> = {
  '1m':'1分','3m':'3分','5m':'5分','15m':'15分','30m':'30分',
  '1h':'1時','2h':'2時','4h':'4時','6h':'6時','12h':'12時','1d':'日','1w':'週'
}
const POPULAR_SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','MATICUSDT',
  'LINKUSDT','UNIUSDT','LTCUSDT','ATOMUSDT','NEARUSDT',
]

type MarketType = 'spot' | 'futures'

const SPOT_REST    = 'https://api.binance.com/api/v3/klines'
const FUTURES_REST = 'https://fapi.binance.com/fapi/v1/klines'
const SPOT_WS_BASE    = 'wss://stream.binance.com:9443/ws'
const FUTURES_WS_BASE = 'wss://fstream.binance.com/ws'

const getSavedSymbol     = () => localStorage.getItem('chart_symbol')   || 'BTCUSDT'
const getSavedInterval   = () => localStorage.getItem('chart_interval') || '1h'
const getSavedMarketType = () => (localStorage.getItem('chart_market') as MarketType) || 'futures'

interface RawKline {
  timestamp: number
  open: number
  high: number
  low: number
  close: number
  volume: number
  turnover: number
}

async function fetchBatch(
  marketType: MarketType,
  symbol: string,
  interval: string,
  limit: number,
  endTime?: number
): Promise<RawKline[]> {
  const base = marketType === 'futures' ? FUTURES_REST : SPOT_REST
  const maxLimit = marketType === 'futures' ? 1500 : 1000
  const actualLimit = Math.min(limit, maxLimit)
  const params = new URLSearchParams({ symbol, interval, limit: String(actualLimit) })
  if (endTime) params.set('endTime', String(endTime))
  const res = await fetch(`${base}?${params}`)
  if (!res.ok) throw new Error(`Binance ${res.status}: ${await res.text()}`)
  const raw: any[][] = await res.json()
  return raw.map(k => ({
    timestamp: k[0],
    open:      parseFloat(k[1]),
    high:      parseFloat(k[2]),
    low:       parseFloat(k[3]),
    close:     parseFloat(k[4]),
    volume:    parseFloat(k[5]),
    turnover:  parseFloat(k[7]),
  }))
}

async function fetchKlines(
  marketType: MarketType,
  symbol: string,
  interval: string,
  targetCount = 5000
): Promise<RawKline[]> {
  const batchSize = marketType === 'futures' ? 1500 : 1000
  const batches   = Math.ceil(targetCount / batchSize)
  let all: RawKline[] = []
  let endTime: number | undefined = undefined
  for (let i = 0; i < batches; i++) {
    const batch = await fetchBatch(marketType, symbol, interval, batchSize, endTime)
    if (!batch.length) break
    all = [...batch, ...all]
    endTime = batch[0].timestamp - 1
  }
  const seen = new Set<number>()
  return all
    .filter(k => { if (seen.has(k.timestamp)) return false; seen.add(k.timestamp); return true })
    .sort((a, b) => a.timestamp - b.timestamp)
}

export default function ChartPage() {
  const chartContainerId = 'kline-chart-container'
  const chartRef   = useRef<Chart | null>(null)
  const wsRef      = useRef<WebSocket | null>(null)
  const reconnectTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const symbolRef     = useRef(getSavedSymbol())
  const intervalRef   = useRef(getSavedInterval())
  const marketTypeRef = useRef<MarketType>(getSavedMarketType())

  const [symbol,          setSymbol]         = useState(symbolRef.current)
  const [interval,        setInterval]       = useState(intervalRef.current)
  const [marketType,      setMarketType]     = useState<MarketType>(marketTypeRef.current)
  const [loading,         setLoading]        = useState(false)
  const [error,           setError]          = useState<string | null>(null)
  const [wsStatus,        setWsStatus]       = useState<'connecting'|'live'|'disconnected'>('disconnected')
  const [currentPrice,    setCurrentPrice]   = useState<number | null>(null)
  const [searchQuery,     setSearchQuery]    = useState('')
  const [showSymbolPanel, setShowSymbolPanel]= useState(false)

  useEffect(() => {
    const chart = init(chartContainerId, {
      layout: [
        { type: 'candle', options: { gap: { bottom: 2 } } },
        { type: 'indicator', content: ['VOL'], options: { gap: { top: 4 }, height: 100 } }
      ],
      customApi: {
        formatDate: (dateTimeFormat: Intl.DateTimeFormat, timestamp: number) =>
          dateTimeFormat.format(new Date(timestamp))
      },
      styles: {
        grid: {
          horizontal: { color: '#1e2328' },
          vertical:   { color: '#1e2328' },
        },
        candle: {
          bar: {
            upColor:       '#26a69a',
            downColor:     '#ef5350',
            noChangeColor: '#888888',
          },
          tooltip: { labels: ['時間', '開', '高', '低', '收', '量'] }
        },
        indicator: { ohlc: { upColor: '#26a69a', downColor: '#ef5350' } },
        xAxis: {
          tickText: { color: '#848e9c' },
          axisLine: { color: '#2b2b43' },
        },
        yAxis: {
          tickText: { color: '#848e9c' },
          axisLine: { color: '#2b2b43' },
        },
        crosshair: {
          horizontal: { line: { color: '#444' }, text: { color: '#fff', backgroundColor: '#2b2b43' } },
          vertical:   { line: { color: '#444' }, text: { color: '#fff', backgroundColor: '#2b2b43' } },
        },
        background: '#131722',
      },
      locale: 'zh-TW',
      timezone: 'Asia/Taipei',
    })
    if (chart) {
      chart.createIndicator('MA', false, { id: 'candle_pane' })
      chart.createIndicator('MACD', false, { height: 80 })
      chartRef.current = chart
    }
    return () => { dispose(chartContainerId) }
  }, [])

  const connectWS = useCallback((sym: string, tf: string, mt: MarketType) => {
    if (wsRef.current) {
      wsRef.current.onclose = null
      wsRef.current.close()
      wsRef.current = null
    }
    if (reconnectTimer.current) {
      clearTimeout(reconnectTimer.current)
      reconnectTimer.current = null
    }
    setWsStatus('connecting')
    const streamName = `${sym.toLowerCase()}@kline_${tf}`
    const wsBase = mt === 'futures' ? FUTURES_WS_BASE : SPOT_WS_BASE
    const ws = new WebSocket(`${wsBase}/${streamName}`)
    wsRef.current = ws
    ws.onopen = () => setWsStatus('live')
    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data)
        const k = msg.k
        if (!k) return
        const candle: RawKline = {
          timestamp: k.t,
          open:      parseFloat(k.o),
          high:      parseFloat(k.h),
          low:       parseFloat(k.l),
          close:     parseFloat(k.c),
          volume:    parseFloat(k.v),
          turnover:  parseFloat(k.q),
        }
        chartRef.current?.updateData(candle)
        setCurrentPrice(candle.close)
      } catch (e) {
        console.warn('WS parse error', e)
      }
    }
    ws.onerror = () => setWsStatus('disconnected')
    ws.onclose = (e) => {
      setWsStatus('disconnected')
      if (e.code !== 1000) {
        reconnectTimer.current = setTimeout(() => {
          connectWS(symbolRef.current, intervalRef.current, marketTypeRef.current)
        }, 3000)
      }
    }
  }, [])

  const loadChart = useCallback(async (sym: string, tf: string, mt: MarketType) => {
    if (!chartRef.current) return
    setLoading(true)
    setError(null)
    try {
      const candles = await fetchKlines(mt, sym, tf, 5000)
      if (!candles.length) throw new Error('Binance 回傳空資料')
      chartRef.current.applyNewData(candles)
      setCurrentPrice(candles[candles.length - 1].close)
    } catch (err: any) {
      console.error('fetchKlines error:', err)
      setError(err.message || '載入失敗')
      setLoading(false)
      return
    }
    setLoading(false)
    connectWS(sym, tf, mt)
  }, [connectWS])

  useEffect(() => {
    const t = setTimeout(() => {
      loadChart(symbolRef.current, intervalRef.current, marketTypeRef.current)
    }, 100)
    return () => clearTimeout(t)
  }, [loadChart])

  const changeSymbol = (sym: string) => {
    symbolRef.current = sym
    localStorage.setItem('chart_symbol', sym)
    setSymbol(sym)
    setShowSymbolPanel(false)
    loadChart(sym, intervalRef.current, marketTypeRef.current)
  }

  const changeInterval = (tf: string) => {
    intervalRef.current = tf
    localStorage.setItem('chart_interval', tf)
    setInterval(tf)
    loadChart(symbolRef.current, tf, marketTypeRef.current)
  }

  const changeMarketType = (mt: MarketType) => {
    marketTypeRef.current = mt
    localStorage.setItem('chart_market', mt)
    setMarketType(mt)
    loadChart(symbolRef.current, intervalRef.current, mt)
  }

  const filteredSymbols = POPULAR_SYMBOLS.filter(s =>
    s.toLowerCase().includes(searchQuery.toLowerCase())
  )

  const wsStatusColor = wsStatus === 'live' ? 'bg-green-500' :
                        wsStatus === 'connecting' ? 'bg-yellow-400 animate-pulse' : 'bg-red-500'
  const wsStatusLabel = wsStatus === 'live' ? 'Live' :
                        wsStatus === 'connecting' ? '連線中' : '已斷線'

  return (
    <div className="flex flex-col h-screen bg-[#131722] text-gray-200">
      <PageHeader title="K 線圖表" />

      <div className="flex flex-wrap items-center gap-2 px-4 py-2 bg-[#1e222d] border-b border-[#2b2b43]">
        <div className="relative">
          <button
            onClick={() => setShowSymbolPanel(v => !v)}
            className="flex items-center gap-1 px-3 py-1.5 bg-[#2b2b43] rounded text-sm font-bold hover:bg-[#363a4e]"
          >
            {symbol}
            <ChevronDown size={14} />
          </button>
          {showSymbolPanel && (
            <div className="absolute top-9 left-0 z-50 w-56 bg-[#1e222d] border border-[#2b2b43] rounded shadow-xl">
              <div className="p-2 border-b border-[#2b2b43]">
                <div className="flex items-center gap-2 bg-[#131722] rounded px-2 py-1">
                  <Search size={14} className="text-gray-400" />
                  <input
                    autoFocus
                    value={searchQuery}
                    onChange={e => setSearchQuery(e.target.value)}
                    placeholder="搜尋交易對..."
                    className="bg-transparent text-sm outline-none w-full"
                  />
                </div>
              </div>
              <div className="max-h-60 overflow-y-auto">
                {filteredSymbols.map(s => (
                  <button
                    key={s}
                    onClick={() => changeSymbol(s)}
                    className={`w-full text-left px-3 py-2 text-sm hover:bg-[#2b2b43] ${s === symbol ? 'text-yellow-400 font-bold' : ''}`}
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="flex rounded overflow-hidden border border-[#2b2b43]">
          {(['spot','futures'] as MarketType[]).map(mt => (
            <button
              key={mt}
              onClick={() => changeMarketType(mt)}
              className={`px-3 py-1.5 text-xs font-semibold transition-colors ${
                marketType === mt
                  ? 'bg-yellow-500 text-black'
                  : 'bg-[#2b2b43] text-gray-400 hover:bg-[#363a4e]'
              }`}
            >
              {mt === 'spot' ? '現貨' : '合約'}
            </button>
          ))}
        </div>

        <div className="flex gap-1 flex-wrap">
          {INTERVALS.map(tf => (
            <button
              key={tf}
              onClick={() => changeInterval(tf)}
              className={`px-2 py-1 text-xs rounded transition-colors ${
                interval === tf
                  ? 'bg-yellow-500 text-black font-bold'
                  : 'bg-[#2b2b43] text-gray-400 hover:bg-[#363a4e]'
              }`}
            >
              {INTERVAL_LABELS[tf]}
            </button>
          ))}
        </div>

        <div className="flex-1" />

        <div className="flex items-center gap-3 text-sm">
          {currentPrice !== null && (
            <span className="font-mono font-bold text-white">
              {currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 8 })}
            </span>
          )}
          <div className="flex items-center gap-1.5">
            <span className={`w-2 h-2 rounded-full ${wsStatusColor}`} />
            <span className="text-xs text-gray-400">{wsStatusLabel}</span>
          </div>
          <button
            onClick={() => loadChart(symbolRef.current, intervalRef.current, marketTypeRef.current)}
            className="p-1.5 rounded hover:bg-[#2b2b43] text-gray-400 hover:text-white"
            title="重新載入"
          >
            <RefreshCw size={14} />
          </button>
        </div>
      </div>

      <div className="relative flex-1 min-h-0">
        {loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#131722]/80">
            <div className="w-8 h-8 border-2 border-yellow-400 border-t-transparent rounded-full animate-spin mb-3" />
            <span className="text-sm text-gray-400">載入歷史 K 線（~5000 根）...</span>
          </div>
        )}
        {error && !loading && (
          <div className="absolute inset-0 z-10 flex flex-col items-center justify-center bg-[#131722]/90 gap-3">
            <span className="text-red-400 text-sm">{error}</span>
            <button
              onClick={() => loadChart(symbolRef.current, intervalRef.current, marketTypeRef.current)}
              className="px-4 py-2 bg-yellow-500 text-black text-sm rounded hover:bg-yellow-400"
            >
              重試
            </button>
          </div>
        )}
        <div
          id={chartContainerId}
          className="w-full h-full"
          style={{ background: '#131722' }}
        />
      </div>
    </div>
  )
}
