import { useEffect, useRef, useState, useCallback } from 'react'
import { init, dispose, Chart } from 'klinecharts'
import { Search, X, Settings, Eye, EyeOff, BarChart2, RefreshCw, ChevronDown } from 'lucide-react'
import PageHeader from '../components/PageHeader'

// ── Constants ─────────────────────────────────────────────────────────────────
const INTERVALS = ['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','1w']
const INTERVAL_LABELS: Record<string,string> = {
  '1m':'1分','3m':'3分','5m':'5分','15m':'15分','30m':'30分',
  '1h':'1時','2h':'2時','4h':'4時','6h':'6時','12h':'12時','1d':'日','1w':'週'
}
const POPULAR_SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','MATICUSDT',
  'LINKUSDT','UNIUSDT','LTCUSDT','ATOMUSDT','NEARUSDT',
]

// ── Indicator definitions ─────────────────────────────────────────────────────
interface IndicatorDef {
  name: string
  label: string
  pane: 'candle' | 'sub'
  defaultParams: Record<string, number>
  paramLabels: Record<string, string>
}
const INDICATOR_DEFS: IndicatorDef[] = [
  { name:'MA',   label:'MA 均線',     pane:'candle', defaultParams:{ period:14 },                              paramLabels:{ period:'週期' } },
  { name:'EMA',  label:'EMA 指數均線', pane:'candle', defaultParams:{ period:14 },                              paramLabels:{ period:'週期' } },
  { name:'BOLL', label:'BOLL 布林帶',  pane:'candle', defaultParams:{ period:20, multiplier:2 },               paramLabels:{ period:'週期', multiplier:'倍數' } },
  { name:'VOL',  label:'VOL 成交量',   pane:'sub',    defaultParams:{},                                         paramLabels:{} },
  { name:'MACD', label:'MACD',         pane:'sub',    defaultParams:{ shortPeriod:12, longPeriod:26, signalPeriod:9 }, paramLabels:{ shortPeriod:'短期', longPeriod:'長期', signalPeriod:'訊號' } },
  { name:'RSI',  label:'RSI',          pane:'sub',    defaultParams:{ period:14 },                              paramLabels:{ period:'週期' } },
  { name:'KDJ',  label:'KDJ',          pane:'sub',    defaultParams:{ period:9, signalPeriod:3 },               paramLabels:{ period:'週期', signalPeriod:'訊號' } },
]

type MarketType = 'spot' | 'futures'

const SPOT_REST       = 'https://api.binance.com/api/v3/klines'
const FUTURES_REST    = 'https://fapi.binance.com/fapi/v1/klines'
const SPOT_TICKER     = 'https://api.binance.com/api/v3/ticker/24hr'
const FUTURES_TICKER  = 'https://fapi.binance.com/fapi/v1/ticker/24hr'
const SPOT_WS_BASE    = 'wss://stream.binance.com:9443/ws'
const FUTURES_WS_BASE = 'wss://fstream.binance.com/ws'

const getSaved = (k: string, def: string) => localStorage.getItem(k) || def

// ── Types ─────────────────────────────────────────────────────────────────────
interface RawKline {
  timestamp:number; open:number; high:number; low:number
  close:number; volume:number; turnover:number
}
interface TickerInfo {
  priceChange:number; priceChangePct:number
  high24h:number; low24h:number; volume24h:number
}
interface ActiveIndicator {
  id: string
  defName: string
  visible: boolean
  params: Record<string, number>
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function fetchBatch(mt:MarketType, sym:string, iv:string, limit:number, endTime?:number): Promise<RawKline[]> {
  const base = mt === 'futures' ? FUTURES_REST : SPOT_REST
  const max  = mt === 'futures' ? 1500 : 1000
  const p = new URLSearchParams({ symbol:sym, interval:iv, limit:String(Math.min(limit, max)) })
  if (endTime) p.set('endTime', String(endTime))
  const res = await fetch(`${base}?${p}`)
  if (!res.ok) throw new Error(`Binance ${res.status}`)
  const raw: any[][] = await res.json()
  return raw.map(k => ({
    timestamp: k[0], open: parseFloat(k[1]), high: parseFloat(k[2]),
    low: parseFloat(k[3]), close: parseFloat(k[4]),
    volume: parseFloat(k[5]), turnover: parseFloat(k[7])
  }))
}
async function fetchKlines(mt:MarketType, sym:string, iv:string, target=1500): Promise<RawKline[]> {
  const bs = mt === 'futures' ? 1500 : 1000
  const batches = Math.ceil(target / bs)
  let all: RawKline[] = []; let endTime: number | undefined
  for (let i = 0; i < batches; i++) {
    const b = await fetchBatch(mt, sym, iv, bs, endTime)
    if (!b.length) break
    all = [...b, ...all]; endTime = b[0].timestamp - 1
  }
  const seen = new Set<number>()
  return all.filter(k => { if (seen.has(k.timestamp)) return false; seen.add(k.timestamp); return true })
            .sort((a, b) => a.timestamp - b.timestamp)
}
async function fetchTicker(mt:MarketType, sym:string): Promise<TickerInfo> {
  const res = await fetch(`${mt==='futures'?FUTURES_TICKER:SPOT_TICKER}?symbol=${sym}`)
  if (!res.ok) throw new Error(`Ticker ${res.status}`)
  const d = await res.json()
  return {
    priceChange: parseFloat(d.priceChange), priceChangePct: parseFloat(d.priceChangePercent),
    high24h: parseFloat(d.highPrice), low24h: parseFloat(d.lowPrice), volume24h: parseFloat(d.volume)
  }
}

// ── Format helpers ────────────────────────────────────────────────────────────
function fmtPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString(undefined, { minimumFractionDigits:2, maximumFractionDigits:2 })
  if (p >= 1)    return p.toFixed(4)
  return p.toFixed(6)
}
function fmtVol(v: number): string {
  if (v >= 1e9) return (v/1e9).toFixed(2)+'B'
  if (v >= 1e6) return (v/1e6).toFixed(2)+'M'
  if (v >= 1e3) return (v/1e3).toFixed(2)+'K'
  return v.toFixed(2)
}
function fmtTs(ts: number): string {
  return new Date(ts).toLocaleString('zh-TW', {
    timeZone:'Asia/Taipei', year:'numeric', month:'2-digit', day:'2-digit',
    hour:'2-digit', minute:'2-digit', hour12:false
  })
}
function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5)   return '剛剛'
  if (s < 60)  return `${s} 秒前`
  if (s < 3600) return `${Math.floor(s/60)} 分前`
  return `${Math.floor(s/3600)} 時前`
}

// ── Settings Modal ────────────────────────────────────────────────────────────
function SettingsModal({ indicator, def, onClose, onApply }: {
  indicator: ActiveIndicator; def: IndicatorDef
  onClose: ()=>void; onApply: (id:string, params:Record<string,number>)=>void
}) {
  const [params, setParams] = useState({ ...indicator.params })
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="bg-[#1e222d] border border-[#2b2b43] rounded-lg p-5 w-72 shadow-2xl" onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <span className="font-bold text-white text-sm">{def.label} 設定</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={15}/></button>
        </div>
        {Object.keys(params).length === 0 && (
          <p className="text-gray-400 text-sm text-center py-2">此指標無可調參數</p>
        )}
        {Object.keys(params).map(k => (
          <div key={k} className="flex items-center justify-between mb-3">
            <label className="text-sm text-gray-300">{def.paramLabels[k] ?? k}</label>
            <input
              type="number" value={params[k]}
              onChange={e => setParams(p => ({ ...p, [k]: Number(e.target.value) }))}
              className="w-24 bg-[#131722] border border-[#2b2b43] rounded px-2 py-1 text-sm text-white text-right outline-none"
            />
          </div>
        ))}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose}
            className="flex-1 py-1.5 rounded text-sm border border-[#2b2b43] text-gray-300 hover:bg-[#2b2b43]">
            取消
          </button>
          <button onClick={() => { onApply(indicator.id, params); onClose() }}
            className="flex-1 py-1.5 rounded text-sm font-bold"
            style={{ backgroundColor:'#f0b90b', color:'#000' }}>
            套用
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Indicator Panel (dropdown) ────────────────────────────────────────────────
function IndicatorPanel({ active, onToggle, onOpenSettings, onClose }: {
  active: ActiveIndicator[]
  onToggle: (defName:string) => void
  onOpenSettings: (id:string) => void
  onClose: () => void
}) {
  const activeNames = new Set(active.map(a => a.defName))
  return (
    <div className="absolute top-full right-0 mt-1 z-50 w-60 bg-[#1e222d] border border-[#2b2b43] rounded-lg shadow-2xl">
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#2b2b43]">
        <span className="text-xs font-bold text-gray-200">技術指標</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={13}/></button>
      </div>
      {INDICATOR_DEFS.map(def => {
        const isOn = activeNames.has(def.name)
        const inst = active.find(a => a.defName === def.name)
        return (
          <div key={def.name} className="flex items-center justify-between px-3 py-2 hover:bg-[#2b2b43] cursor-pointer">
            <div className="flex items-center gap-2" onClick={() => onToggle(def.name)}>
              <div className="w-3.5 h-3.5 rounded-sm border flex items-center justify-center flex-shrink-0"
                style={{ borderColor: isOn ? '#f0b90b' : '#555', backgroundColor: isOn ? '#f0b90b' : 'transparent' }}>
                {isOn && <span style={{ color:'#000', fontSize:'9px', fontWeight:'bold', lineHeight:1 }}>✓</span>}
              </div>
              <span className="text-xs text-gray-200">{def.label}</span>
            </div>
            {isOn && inst && (
              <button onClick={e => { e.stopPropagation(); onOpenSettings(inst.id) }}
                className="text-gray-500 hover:text-gray-200 ml-2">
                <Settings size={12}/>
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ChartPage() {
  const chartId  = 'kline-main'
  const chartRef = useRef<Chart|null>(null)
  const wsRef    = useRef<WebSocket|null>(null)
  const rcTimer  = useRef<ReturnType<typeof setTimeout>|null>(null)
  const tickRef  = useRef<ReturnType<typeof setInterval>|null>(null)

  const symRef = useRef(getSaved('chart_symbol','BTCUSDT'))
  const ivRef  = useRef(getSaved('chart_interval','1h'))
  const mtRef  = useRef<MarketType>(getSaved('chart_market','futures') as MarketType)

  const [symbol,    setSym]    = useState(symRef.current)
  const [interval,  setIv]     = useState(ivRef.current)
  const [marketType,setMt]     = useState<MarketType>(mtRef.current)
  const [loading,   setLoading]= useState(false)
  const [error,     setError]  = useState<string|null>(null)
  const [wsStatus,  setWsSt]   = useState<'connecting'|'live'|'disconnected'>('disconnected')

  const [price,     setPrice]  = useState<number|null>(null)
  const [ticker,    setTicker] = useState<TickerInfo|null>(null)
  const [barTs,     setBarTs]  = useState<number|null>(null)
  const [lastTs,    setLastTs] = useState<number>(0)
  const [agoStr,    setAgoStr] = useState('')

  const [searchQ,   setSearchQ]= useState('')
  const [showSymP,  setShowSymP]= useState(false)
  const [showIndP,  setShowIndP]= useState(false)

  const [activeInds, setActiveInds] = useState<ActiveIndicator[]>([])
  const [settingsId, setSettingsId] = useState<string|null>(null)

  // ── Chart init ──────────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = init(chartId, {
      layout: [
        { type: 'candle',    options: { gap: { bottom: 2 } } },
        { type: 'indicator', content: ['VOL'],  options: { height: 80, gap: { top: 4, bottom: 2 } } },
        { type: 'indicator', content: ['MACD'], options: { height: 80, gap: { top: 4, bottom: 2 } } },
        { type: 'xAxis' },
      ],
      styles: {
        grid:       { horizontal:{ color:'#1e2328' }, vertical:{ color:'#1e2328' } },
        candle: {
          bar: { upColor:'#26a69a', downColor:'#ef5350', noChangeColor:'#888' },
          tooltip: { labels:['時間','開','高','低','收','量'] },
        },
        indicator:  { ohlc:{ upColor:'#26a69a', downColor:'#ef5350' } },
        xAxis: { tickText:{ color:'#848e9c', size:11 }, axisLine:{ color:'#2b2b43' } },
        yAxis: { tickText:{ color:'#848e9c', size:11 }, axisLine:{ color:'#2b2b43' } },
        crosshair: {
          horizontal: { line:{ color:'#444' }, text:{ color:'#fff', backgroundColor:'#2b2b43' } },
          vertical:   { line:{ color:'#444' }, text:{ color:'#fff', backgroundColor:'#2b2b43' } },
        },
        background: '#131722',
      },
      locale: 'zh-TW',
      timezone: 'Asia/Taipei',
    })
    if (!chart) return
    chartRef.current = chart

    // Default indicators
    const maId   = chart.createIndicator('MA',   false, { id:'candle_pane' }) as string
    // VOL and MACD are in layout, so just record them for the panel
    setActiveInds([
      { id: maId,       defName:'MA',   visible:true, params:{ period:14 } },
      { id: 'vol_pane', defName:'VOL',  visible:true, params:{} },
      { id: 'macd_pane',defName:'MACD', visible:true, params:{ shortPeriod:12, longPeriod:26, signalPeriod:9 } },
    ])
    return () => { dispose(chartId) }
  }, [])

  // ── Load klines ─────────────────────────────────────────────────────────────
  const loadData = useCallback(async (mt:MarketType, sym:string, iv:string) => {
    const chart = chartRef.current
    if (!chart) return
    setLoading(true); setError(null)
    try {
      const [klines, tk] = await Promise.all([
        fetchKlines(mt, sym, iv, 1500),
        fetchTicker(mt, sym)
      ])
      chart.applyNewData(klines)
      setTicker(tk)
      if (klines.length) setPrice(klines[klines.length-1].close)
    } catch(e:any) {
      setError(e.message)
    } finally {
      setLoading(false)
    }
  }, [])

  // ── WebSocket ────────────────────────────────────────────────────────────────
  const connectWS = useCallback((mt:MarketType, sym:string, iv:string) => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
    const base = mt === 'futures' ? FUTURES_WS_BASE : SPOT_WS_BASE
    const ws = new WebSocket(`${base}/${sym.toLowerCase()}@kline_${iv}`)
    wsRef.current = ws
    setWsSt('connecting')
    ws.onopen  = () => setWsSt('live')
    ws.onclose = () => {
      setWsSt('disconnected')
      rcTimer.current = setTimeout(() => connectWS(mtRef.current, symRef.current, ivRef.current), 3000)
    }
    ws.onerror = () => ws.close()
    ws.onmessage = e => {
      const { k } = JSON.parse(e.data)
      const bar = { timestamp:k.t, open:parseFloat(k.o), high:parseFloat(k.h), low:parseFloat(k.l), close:parseFloat(k.c), volume:parseFloat(k.v), turnover:parseFloat(k.q) }
      chartRef.current?.updateData(bar)
      setPrice(parseFloat(k.c))
      setBarTs(k.t)
      setLastTs(Date.now())
    }
  }, [])

  // ── "X ago" ticker ───────────────────────────────────────────────────────────
  useEffect(() => {
    tickRef.current = setInterval(() => {
      if (lastTs) setAgoStr(timeAgo(lastTs))
    }, 1000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [lastTs])

  // ── Symbol / interval change ─────────────────────────────────────────────────
  const switchPair = useCallback((mt:MarketType, sym:string, iv:string) => {
    symRef.current = sym; ivRef.current = iv; mtRef.current = mt
    localStorage.setItem('chart_symbol', sym)
    localStorage.setItem('chart_interval', iv)
    localStorage.setItem('chart_market', mt)
    setSym(sym); setIv(iv); setMt(mt)
    if (rcTimer.current) clearTimeout(rcTimer.current)
    loadData(mt, sym, iv)
    connectWS(mt, sym, iv)
  }, [loadData, connectWS])

  useEffect(() => {
    switchPair(mtRef.current, symRef.current, ivRef.current)
    return () => {
      if (wsRef.current)  { wsRef.current.close() }
      if (rcTimer.current){ clearTimeout(rcTimer.current) }
      if (tickRef.current){ clearInterval(tickRef.current) }
    }
  }, [])

  // ── Indicator helpers ────────────────────────────────────────────────────────
  const toggleIndicator = useCallback((defName: string) => {
    const chart = chartRef.current
    if (!chart) return
    const def = INDICATOR_DEFS.find(d => d.name === defName)!
    setActiveInds(prev => {
      const existing = prev.find(a => a.defName === defName)
      if (existing) {
        // remove
        try { chart.removeIndicator(existing.id === 'candle_pane' ? 'candle_pane' : existing.id, defName) } catch {}
        return prev.filter(a => a.defName !== defName)
      } else {
        // add
        const paneOpts = def.pane === 'candle' ? { id:'candle_pane' } : { height: 80 }
        const id = chart.createIndicator(defName, false, paneOpts) as string
        return [...prev, { id, defName, visible:true, params:{ ...def.defaultParams } }]
      }
    })
  }, [])

  const applySettings = useCallback((id: string, params: Record<string, number>) => {
    const chart = chartRef.current
    if (!chart) return
    setActiveInds(prev => prev.map(a => {
      if (a.id !== id) return a
      try { chart.overrideIndicator({ name: a.defName, calcParams: Object.values(params) }, a.id) } catch {}
      return { ...a, params }
    }))
  }, [])

  const toggleVisibility = useCallback((id: string) => {
    const chart = chartRef.current
    if (!chart) return
    setActiveInds(prev => prev.map(a => {
      if (a.id !== id) return a
      const next = !a.visible
      try { chart.overrideIndicator({ name: a.defName, visible: next }, a.id) } catch {}
      return { ...a, visible: next }
    }))
  }, [])

  // ── Derived ──────────────────────────────────────────────────────────────────
  const settingsIndicator = activeInds.find(a => a.id === settingsId)
  const settingsDef = settingsIndicator ? INDICATOR_DEFS.find(d => d.name === settingsIndicator.defName) : null
  const filteredSymbols = POPULAR_SYMBOLS.filter(s => s.includes(searchQ.toUpperCase()))
  const isUp = ticker ? ticker.priceChangePct >= 0 : true
  const pctColor = isUp ? '#26a69a' : '#ef5350'

  // ── Render ───────────────────────────────────────────────────────────────────
  return (
    <div style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden', backgroundColor:'#131722', color:'#d1d4dc' }}>
      <PageHeader title="K線圖表" />

      {/* ── ROW 1: Toolbar ── */}
      <div style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 10px', borderBottom:'1px solid #2b2b43', flexShrink:0 }}>

        {/* Symbol picker */}
        <div style={{ position:'relative' }}>
          <button
            onClick={() => setShowSymP(v => !v)}
            style={{ display:'flex', alignItems:'center', gap:4, padding:'3px 8px', background:'#1e222d', border:'1px solid #2b2b43', borderRadius:4, color:'#d1d4dc', fontSize:13, fontWeight:700, cursor:'pointer' }}>
            {symbol} <ChevronDown size={13}/>
          </button>
          {showSymP && (
            <div style={{ position:'absolute', top:'100%', left:0, marginTop:4, zIndex:100, background:'#1e222d', border:'1px solid #2b2b43', borderRadius:6, width:200, boxShadow:'0 8px 24px rgba(0,0,0,.5)' }}>
              <div style={{ padding:'6px 8px', borderBottom:'1px solid #2b2b43', display:'flex', alignItems:'center', gap:6 }}>
                <Search size={13} color="#848e9c"/>
                <input autoFocus value={searchQ} onChange={e=>setSearchQ(e.target.value)}
                  placeholder="搜尋..." style={{ background:'transparent', border:'none', outline:'none', color:'#d1d4dc', fontSize:12, width:'100%' }}/>
              </div>
              <div style={{ maxHeight:200, overflowY:'auto' }}>
                {filteredSymbols.map(s => (
                  <div key={s} onClick={() => { switchPair(marketType, s, interval); setShowSymP(false); setSearchQ('') }}
                    style={{ padding:'6px 12px', fontSize:12, cursor:'pointer', background: s===symbol?'#2b2b43':'transparent', color: s===symbol?'#f0b90b':'#d1d4dc' }}
                    onMouseEnter={e=>(e.currentTarget.style.background='#2b2b43')}
                    onMouseLeave={e=>(e.currentTarget.style.background=s===symbol?'#2b2b43':'transparent')}>
                    {s}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Spot / Futures */}
        <div style={{ display:'flex', background:'#1e222d', borderRadius:4, border:'1px solid #2b2b43', overflow:'hidden' }}>
          {(['spot','futures'] as MarketType[]).map(m => (
            <button key={m} onClick={() => switchPair(m, symbol, interval)}
              style={{ padding:'3px 9px', fontSize:11, cursor:'pointer', border:'none', fontWeight: marketType===m ? 700 : 400,
                background: marketType===m ? '#f0b90b' : 'transparent',
                color:      marketType===m ? '#000' : '#848e9c' }}>
              {m === 'spot' ? '現貨' : '合約'}
            </button>
          ))}
        </div>

        <div style={{ flex:1 }}/>

        {/* WS status */}
        <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, color: wsStatus==='live'?'#26a69a':'#848e9c' }}>
          <span style={{ width:6, height:6, borderRadius:'50%', backgroundColor: wsStatus==='live'?'#26a69a':wsStatus==='connecting'?'#f0b90b':'#ef5350', display:'inline-block' }}/>
          {wsStatus==='live'?'即時':wsStatus==='connecting'?'連線中':'斷線'}
        </div>

        {/* Refresh */}
        <button onClick={() => switchPair(marketType, symbol, interval)}
          style={{ background:'transparent', border:'none', cursor:'pointer', color:'#848e9c', padding:3 }}>
          <RefreshCw size={14} color={loading?'#f0b90b':'#848e9c'}/>
        </button>
      </div>

      {/* ── ROW 2: Price bar ── */}
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'3px 12px', borderBottom:'1px solid #2b2b43', flexShrink:0, flexWrap:'wrap' }}>
        {/* Price + change */}
        <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
          <span style={{ fontSize:20, fontFamily:'monospace', fontWeight:700, color: pctColor }}>
            {price != null ? fmtPrice(price) : '—'}
          </span>
          {ticker && (
            <span style={{ fontSize:12, color: pctColor }}>
              {ticker.priceChange >= 0 ? '+' : ''}{fmtPrice(ticker.priceChange)}
              {'  '}({ticker.priceChangePct >= 0 ? '+' : ''}{ticker.priceChangePct.toFixed(2)}%)
            </span>
          )}
        </div>

        {/* Divider */}
        <div style={{ width:1, height:28, background:'#2b2b43' }}/>

        {/* 24h stats */}
        {ticker && (
          <div style={{ display:'flex', gap:16, fontSize:11 }}>
            <div style={{ color:'#848e9c' }}>24h高 <span style={{ color:'#d1d4dc' }}>{fmtPrice(ticker.high24h)}</span></div>
            <div style={{ color:'#848e9c' }}>24h低 <span style={{ color:'#d1d4dc' }}>{fmtPrice(ticker.low24h)}</span></div>
            <div style={{ color:'#848e9c' }}>24h量 <span style={{ color:'#d1d4dc' }}>{fmtVol(ticker.volume24h)}</span></div>
          </div>
        )}

        <div style={{ flex:1 }}/>

        {/* Bar time + ago */}
        <div style={{ fontSize:11, color:'#848e9c', textAlign:'right' }}>
          {barTs && <span style={{ color:'#d1d4dc' }}>{fmtTs(barTs)}</span>}
          {' '}({INTERVAL_LABELS[interval]})
          {agoStr && <span style={{ marginLeft:8 }}>更新 {agoStr}</span>}
        </div>
      </div>

      {/* ── ROW 3: Interval + Indicators ── */}
      <div style={{ display:'flex', alignItems:'center', padding:'2px 8px', borderBottom:'1px solid #2b2b43', flexShrink:0, gap:2 }}>
        {INTERVALS.map(iv => {
          const active = iv === interval
          return (
            <button key={iv} onClick={() => switchPair(marketType, symbol, iv)}
              style={{
                padding:'2px 7px', fontSize:11, borderRadius:3, border:'none', cursor:'pointer',
                fontWeight: active ? 700 : 400,
                background:    active ? '#f0b90b' : 'transparent',
                color:         active ? '#000'    : '#848e9c',
                transition: 'background 0.15s',
              }}>
              {INTERVAL_LABELS[iv]}
            </button>
          )
        })}

        <div style={{ flex:1 }}/>

        {/* Indicators button */}
        <div style={{ position:'relative' }}>
          <button
            onClick={() => setShowIndP(v => !v)}
            style={{ display:'flex', alignItems:'center', gap:4, padding:'2px 8px', background: showIndP?'#2b2b43':'transparent', border:'1px solid #2b2b43', borderRadius:4, color:'#d1d4dc', fontSize:11, cursor:'pointer' }}>
            <BarChart2 size={13}/> 指標
          </button>
          {showIndP && (
            <IndicatorPanel
              active={activeInds}
              onToggle={toggleIndicator}
              onOpenSettings={id => { setSettingsId(id); setShowIndP(false) }}
              onClose={() => setShowIndP(false)}
            />
          )}
        </div>
      </div>

      {/* ── ROW 4: Chart ── */}
      <div style={{ flex:1, minHeight:0, position:'relative' }}>
        {loading && (
          <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(19,23,34,0.7)', zIndex:10 }}>
            <span style={{ color:'#f0b90b', fontSize:13 }}>載入中...</span>
          </div>
        )}
        {error && (
          <div style={{ position:'absolute', top:8, left:'50%', transform:'translateX(-50%)', background:'#2d1a1a', border:'1px solid #ef5350', borderRadius:4, padding:'4px 12px', fontSize:12, color:'#ef5350', zIndex:10 }}>
            {error}
          </div>
        )}
        <div id={chartId} style={{ width:'100%', height:'100%' }}/>
      </div>

      {/* ── Settings Modal ── */}
      {settingsId && settingsIndicator && settingsDef && (
        <SettingsModal
          indicator={settingsIndicator}
          def={settingsDef}
          onClose={() => setSettingsId(null)}
          onApply={applySettings}
        />
      )}

      {/* Click-outside to close dropdowns */}
      {(showSymP || showIndP) && (
        <div style={{ position:'fixed', inset:0, zIndex:49 }}
          onClick={() => { setShowSymP(false); setShowIndP(false) }}/>
      )}
    </div>
  )
}
