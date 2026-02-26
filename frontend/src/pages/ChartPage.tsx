import { useEffect, useRef, useState, useCallback } from 'react'
import {
  createChart,
  IChartApi,
  ISeriesApi,
  CandlestickData,
  Time,
  CrosshairMode,
  UTCTimestamp,
} from 'lightweight-charts'

// ── Binance Futures REST (international, no geo-block) ──────────────────────
const FAPI_BASE = 'https://fapi.binance.com'
const FAPI_WS   = 'wss://fstream.binance.com'

const INTERVAL_MAP: Record<string, string> = {
  '1m': '1m', '5m': '5m', '15m': '15m', '30m': '30m',
  '1h': '1h', '4h': '4h',  '1d': '1d',  '1w': '1w',
}

// Fetch one batch (max 1500 per Binance Futures limit)
async function fetchBatch(
  symbol: string,
  interval: string,
  endTime?: number,
  limit = 1500,
): Promise<CandlestickData<UTCTimestamp>[]> {
  const params = new URLSearchParams({
    symbol,
    interval,
    limit: String(limit),
    ...(endTime ? { endTime: String(endTime) } : {}),
  })
  const res = await fetch(`${FAPI_BASE}/fapi/v1/klines?${params}`)
  if (!res.ok) throw new Error(`Binance REST ${res.status}`)
  const raw: number[][] = await res.json()
  return raw.map(k => ({
    time: (k[0] / 1000) as UTCTimestamp,
    open:  parseFloat(k[1] as unknown as string),
    high:  parseFloat(k[2] as unknown as string),
    low:   parseFloat(k[3] as unknown as string),
    close: parseFloat(k[4] as unknown as string),
  }))
}

// Fetch ~5000 candles by chaining batches backwards
async function fetchHistory(
  symbol: string,
  interval: string,
  targetCount = 5000,
): Promise<CandlestickData<UTCTimestamp>[]> {
  const batchSize = 1500
  let all: CandlestickData<UTCTimestamp>[] = []
  let endTime: number | undefined = undefined

  while (all.length < targetCount) {
    const need = Math.min(batchSize, targetCount - all.length)
    const batch = await fetchBatch(symbol, interval, endTime, need)
    if (!batch.length) break
    // prepend (older data comes first)
    all = [...batch, ...all]
    // next batch ends just before the oldest candle we have
    endTime = (batch[0].time as number) * 1000 - 1
    if (batch.length < need) break // no more history
  }

  // deduplicate & sort ascending by time
  const seen = new Set<number>()
  return all
    .filter(c => { const t = c.time as number; if (seen.has(t)) return false; seen.add(t); return true })
    .sort((a, b) => (a.time as number) - (b.time as number))
}

const TIMEFRAMES = [
  { label: '1分', value: '1m' },
  { label: '5分', value: '5m' },
  { label: '15分', value: '15m' },
  { label: '30分', value: '30m' },
  { label: '1小時', value: '1h' },
  { label: '4小時', value: '4h' },
  { label: '1天', value: '1d' },
  { label: '1週', value: '1w' },
]

const SYMBOLS = ['BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT']

export default function ChartPage() {
  const chartContainerRef = useRef<HTMLDivElement>(null)
  const chartRef          = useRef<IChartApi | null>(null)
  const seriesRef         = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const wsRef             = useRef<WebSocket | null>(null)
  const reconnectTimer    = useRef<ReturnType<typeof setTimeout> | null>(null)

  const [symbol,    setSymbol]    = useState(() => localStorage.getItem('chart_symbol')    || 'BTCUSDT')
  const [timeframe, setTimeframe] = useState(() => localStorage.getItem('chart_timeframe') || '1m')
  const [currentPrice, setCurrentPrice] = useState<number | null>(null)
  const [currentTime,  setCurrentTime]  = useState<string>('')
  const [loading,  setLoading]  = useState(true)
  const [error,    setError]    = useState<string | null>(null)
  const [wsStatus, setWsStatus] = useState<'connecting' | 'connected' | 'disconnected'>('disconnected')

  // ── Chart init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!chartContainerRef.current) return
    const chart = createChart(chartContainerRef.current, {
      width:  chartContainerRef.current.clientWidth,
      height: chartContainerRef.current.clientHeight || 500,
      layout: { background: { color: '#0f1117' }, textColor: '#d1d5db' },
      grid:   { vertLines: { color: '#1f2937' }, horzLines: { color: '#1f2937' } },
      crosshair: { mode: CrosshairMode.Normal },
      rightPriceScale: { borderColor: '#374151' },
      timeScale: {
        borderColor: '#374151',
        timeVisible: true,
        secondsVisible: false,
      },
    })
    const series = chart.addCandlestickSeries({
      upColor:   '#26a69a', downColor: '#ef5350',
      borderUpColor: '#26a69a', borderDownColor: '#ef5350',
      wickUpColor:   '#26a69a', wickDownColor:   '#ef5350',
    })
    chartRef.current  = chart
    seriesRef.current = series

    const ro = new ResizeObserver(() => {
      if (chartContainerRef.current)
        chart.resize(chartContainerRef.current.clientWidth, chartContainerRef.current.clientHeight)
    })
    ro.observe(chartContainerRef.current)

    return () => { ro.disconnect(); chart.remove() }
  }, [])

  // ── Load history + open WS whenever symbol / timeframe changes ─────────────
  const loadData = useCallback(async () => {
    if (!seriesRef.current) return
    setLoading(true)
    setError(null)
    localStorage.setItem('chart_symbol',    symbol)
    localStorage.setItem('chart_timeframe', timeframe)

    // close old WS
    if (wsRef.current) { wsRef.current.close(1000); wsRef.current = null }
    if (reconnectTimer.current) { clearTimeout(reconnectTimer.current); reconnectTimer.current = null }

    try {
      const candles = await fetchHistory(symbol, INTERVAL_MAP[timeframe] || timeframe)
      if (seriesRef.current && candles.length) {
        seriesRef.current.setData(candles)
        chartRef.current?.timeScale().fitContent()
        const last = candles[candles.length - 1]
        setCurrentPrice(last.close)
        // format last candle time in local timezone
        setCurrentTime(new Date((last.time as number) * 1000).toLocaleTimeString())
      }
    } catch (e) {
      setError(`載入歷史資料失敗: ${e}`)
    } finally {
      setLoading(false)
    }

    // open Binance Futures stream
    connectWS()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe])

  useEffect(() => { loadData() }, [loadData])

  // ── WebSocket (Binance Futures stream) ─────────────────────────────────────
  const connectWS = useCallback(() => {
    const streamName = `${symbol.toLowerCase()}@kline_${INTERVAL_MAP[timeframe] || timeframe}`
    const url = `${FAPI_WS}/ws/${streamName}`
    setWsStatus('connecting')

    const ws = new WebSocket(url)
    wsRef.current = ws

    ws.onopen = () => setWsStatus('connected')

    ws.onmessage = (evt) => {
      try {
        const msg = JSON.parse(evt.data)
        const k = msg.k
        if (!k) return
        const candle: CandlestickData<UTCTimestamp> = {
          time:  (k.t / 1000) as UTCTimestamp,
          open:  parseFloat(k.o),
          high:  parseFloat(k.h),
          low:   parseFloat(k.l),
          close: parseFloat(k.c),
        }
        seriesRef.current?.update(candle)
        setCurrentPrice(parseFloat(k.c))
        setCurrentTime(new Date(k.t).toLocaleTimeString())
      } catch { /* ignore parse errors */ }
    }

    ws.onerror = () => setWsStatus('disconnected')

    ws.onclose = (evt) => {
      setWsStatus('disconnected')
      // auto-reconnect unless intentional close
      if (evt.code !== 1000) {
        reconnectTimer.current = setTimeout(() => connectWS(), 3000)
      }
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [symbol, timeframe])

  // cleanup on unmount
  useEffect(() => () => {
    wsRef.current?.close(1000)
    if (reconnectTimer.current) clearTimeout(reconnectTimer.current)
  }, [])

  // ── Marker API (called by BacktestPage after run) ──────────────────────────
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  ;(window as any).__chartApplyMarkers = (trades: Array<{
    entry_time: number; entry_price: number; exit_time: number;
    exit_price: number; pnl_pct: number; side: 'long' | 'short'
  }>) => {
    if (!seriesRef.current) return
    const markers = trades.flatMap(t => [
      {
        time: Math.floor(t.entry_time / 1000) as UTCTimestamp,
        position: t.side === 'long' ? 'belowBar' : 'aboveBar',
        color: t.side === 'long' ? '#26a69a' : '#ef5350',
        shape: t.side === 'long' ? 'arrowUp' : 'arrowDown',
        text: t.side === 'long' ? 'B' : 'S',
      },
      {
        time: Math.floor(t.exit_time / 1000) as UTCTimestamp,
        position: t.side === 'long' ? 'aboveBar' : 'belowBar',
        color: t.pnl_pct >= 0 ? '#26a69a' : '#ef5350',
        shape: 'circle',
        text: `${t.pnl_pct >= 0 ? '+' : ''}${t.pnl_pct.toFixed(2)}%`,
      },
    ])
    // sort ascending by time (required by lightweight-charts)
    markers.sort((a, b) => (a.time as number) - (b.time as number))
    seriesRef.current.setMarkers(markers as any)
  }

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-gray-950 text-white">
      {/* Controls */}
      <div className="flex items-center gap-3 p-3 border-b border-gray-800 flex-wrap">
        {/* Symbol picker */}
        <select
          value={symbol}
          onChange={e => setSymbol(e.target.value)}
          className="bg-gray-800 border border-gray-700 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
        >
          {SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
        </select>

        {/* Timeframe buttons */}
        <div className="flex gap-1">
          {TIMEFRAMES.map(tf => (
            <button
              key={tf.value}
              onClick={() => setTimeframe(tf.value)}
              className={`px-3 py-1.5 rounded text-sm font-medium transition-colors ${
                timeframe === tf.value
                  ? 'bg-blue-600 text-white'
                  : 'bg-gray-800 text-gray-400 hover:bg-gray-700'
              }`}
            >
              {tf.label}
            </button>
          ))}
        </div>

        {/* WS status dot */}
        <div className="ml-auto flex items-center gap-2 text-xs text-gray-400">
          <span className={`w-2 h-2 rounded-full ${
            wsStatus === 'connected'    ? 'bg-green-400' :
            wsStatus === 'connecting'   ? 'bg-yellow-400 animate-pulse' :
                                          'bg-red-500'
          }`} />
          {wsStatus === 'connected' ? 'Live' : wsStatus === 'connecting' ? '連線中…' : '已斷線'}
        </div>
      </div>

      {/* Price bar */}
      {currentPrice !== null && (
        <div className="flex items-center gap-3 px-4 py-2 border-b border-gray-800 text-sm">
          <span className="text-gray-400">Current:</span>
          <span className="text-white font-semibold text-lg">
            ${currentPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
          </span>
          {currentTime && (
            <span className="text-green-400 text-xs">● {currentTime}</span>
          )}
        </div>
      )}

      {/* Chart area */}
      <div className="relative flex-1">
        {loading && (
          <div className="absolute inset-0 flex items-center justify-center bg-gray-950/80 z-10">
            <div className="flex flex-col items-center gap-2">
              <div className="w-8 h-8 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
              <span className="text-sm text-gray-400">載入歷史 K 線…</span>
            </div>
          </div>
        )}
        {error && (
          <div className="absolute inset-0 flex items-center justify-center z-10">
            <div className="bg-red-900/50 border border-red-700 rounded-lg p-6 text-center max-w-md">
              <p className="text-red-400 text-sm">{error}</p>
              <button
                onClick={loadData}
                className="mt-3 px-4 py-2 bg-red-700 hover:bg-red-600 rounded text-sm"
              >
                重試
              </button>
            </div>
          </div>
        )}
        <div ref={chartContainerRef} className="w-full h-full" />
      </div>
    </div>
  )
}
