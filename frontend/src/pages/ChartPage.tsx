import { useEffect, useRef, useState, useCallback } from 'react'
import { init, dispose, Chart } from 'klinecharts'
import { Search, ChevronDown, RefreshCw, Settings, Eye, EyeOff, X, BarChart2 } from 'lucide-react'
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

// 指標定義
interface IndicatorDef {
  name: string
  label: string
  pane: 'candle' | 'sub'
  defaultParams: Record<string, number>
  paramLabels: Record<string, string>
}
const INDICATOR_DEFS: IndicatorDef[] = [
  { name:'MA',   label:'MA 均線',    pane:'candle', defaultParams:{ period:14 },               paramLabels:{ period:'週期' } },
  { name:'EMA',  label:'EMA 指數均線',pane:'candle', defaultParams:{ period:14 },               paramLabels:{ period:'週期' } },
  { name:'BOLL', label:'BOLL 布林帶', pane:'candle', defaultParams:{ period:20, multiplier:2 }, paramLabels:{ period:'週期', multiplier:'倍數' } },
  { name:'VOL',  label:'VOL 成交量',  pane:'sub',    defaultParams:{},                          paramLabels:{} },
  { name:'MACD', label:'MACD',        pane:'sub',    defaultParams:{ shortPeriod:12, longPeriod:26, signalPeriod:9 }, paramLabels:{ shortPeriod:'短期', longPeriod:'長期', signalPeriod:'訊號' } },
  { name:'RSI',  label:'RSI',         pane:'sub',    defaultParams:{ period:14 },               paramLabels:{ period:'週期' } },
  { name:'KDJ',  label:'KDJ',         pane:'sub',    defaultParams:{ period:9, signalPeriod:3 },paramLabels:{ period:'週期', signalPeriod:'訊號' } },
]

type MarketType = 'spot' | 'futures'

const SPOT_REST      = 'https://api.binance.com/api/v3/klines'
const FUTURES_REST   = 'https://fapi.binance.com/fapi/v1/klines'
const SPOT_TICKER    = 'https://api.binance.com/api/v3/ticker/24hr'
const FUTURES_TICKER = 'https://fapi.binance.com/fapi/v1/ticker/24hr'
const SPOT_WS_BASE   = 'wss://stream.binance.com:9443/ws'
const FUTURES_WS_BASE= 'wss://fstream.binance.com/ws'

const getSaved = (k: string, def: string) => localStorage.getItem(k) || def

// ── Types ─────────────────────────────────────────────────────────────────────
interface RawKline {
  timestamp:number; open:number; high:number; low:number; close:number
  volume:number; turnover:number
}
interface TickerInfo {
  priceChange:number; priceChangePct:number; high24h:number; low24h:number; volume24h:number
}
interface ActiveIndicator {
  id: string          // KLineChart pane id returned by createIndicator
  defName: string     // e.g. 'MA'
  visible: boolean
  params: Record<string, number>
}

// ── Fetch helpers ─────────────────────────────────────────────────────────────
async function fetchBatch(mt:MarketType,sym:string,iv:string,limit:number,endTime?:number):Promise<RawKline[]>{
  const base = mt==='futures'?FUTURES_REST:SPOT_REST
  const max  = mt==='futures'?1500:1000
  const p = new URLSearchParams({symbol:sym,interval:iv,limit:String(Math.min(limit,max))})
  if(endTime) p.set('endTime',String(endTime))
  const res = await fetch(`${base}?${p}`)
  if(!res.ok) throw new Error(`Binance ${res.status}`)
  const raw:any[][] = await res.json()
  return raw.map(k=>({
    timestamp:k[0],open:parseFloat(k[1]),high:parseFloat(k[2]),
    low:parseFloat(k[3]),close:parseFloat(k[4]),
    volume:parseFloat(k[5]),turnover:parseFloat(k[7])
  }))
}
async function fetchKlines(mt:MarketType,sym:string,iv:string,target=3000):Promise<RawKline[]>{
  const bs=mt==='futures'?1500:1000; const batches=Math.ceil(target/bs)
  let all:RawKline[]=[]; let endTime:number|undefined
  for(let i=0;i<batches;i++){
    const b=await fetchBatch(mt,sym,iv,bs,endTime); if(!b.length)break
    all=[...b,...all]; endTime=b[0].timestamp-1
  }
  const seen=new Set<number>()
  return all.filter(k=>{if(seen.has(k.timestamp))return false;seen.add(k.timestamp);return true})
            .sort((a,b)=>a.timestamp-b.timestamp)
}
async function fetchTicker(mt:MarketType,sym:string):Promise<TickerInfo>{
  const res=await fetch(`${mt==='futures'?FUTURES_TICKER:SPOT_TICKER}?symbol=${sym}`)
  if(!res.ok) throw new Error(`Ticker ${res.status}`)
  const d=await res.json()
  return{priceChange:parseFloat(d.priceChange),priceChangePct:parseFloat(d.priceChangePercent),
         high24h:parseFloat(d.highPrice),low24h:parseFloat(d.lowPrice),volume24h:parseFloat(d.volume)}
}

// ── Format helpers ─────────────────────────────────────────────────────────────
function fmtPrice(p:number):string{
  if(p>=1000) return p.toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:2})
  if(p>=1)    return p.toFixed(4)
  return p.toFixed(6)
}
function fmtVol(v:number):string{
  if(v>=1e9) return (v/1e9).toFixed(2)+'B'
  if(v>=1e6) return (v/1e6).toFixed(2)+'M'
  if(v>=1e3) return (v/1e3).toFixed(2)+'K'
  return v.toFixed(2)
}
function fmtTs(ts:number):string{
  return new Date(ts).toLocaleString('zh-TW',{
    timeZone:'Asia/Taipei',year:'numeric',month:'2-digit',day:'2-digit',
    hour:'2-digit',minute:'2-digit',hour12:false
  })
}
function timeAgo(ts:number):string{
  const s=Math.floor((Date.now()-ts)/1000)
  if(s<5)  return '剛剛'
  if(s<60) return `${s} 秒前`
  if(s<3600) return `${Math.floor(s/60)} 分前`
  return `${Math.floor(s/3600)} 時前`
}

// ── Settings Modal ────────────────────────────────────────────────────────────
interface SettingsModalProps {
  indicator: ActiveIndicator
  def: IndicatorDef
  onClose: () => void
  onApply: (id:string, params:Record<string,number>) => void
}
function SettingsModal({indicator,def,onClose,onApply}:SettingsModalProps){
  const [params,setParams]=useState({...indicator.params})
  return(
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60"
         onClick={onClose}>
      <div className="bg-[#1e222d] border border-[#2b2b43] rounded-lg p-5 w-72 shadow-2xl"
           onClick={e=>e.stopPropagation()}>
        <div className="flex items-center justify-between mb-4">
          <span className="font-bold text-white">{def.label} 設定</span>
          <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={16}/></button>
        </div>
        {Object.keys(params).map(k=>(
          <div key={k} className="flex items-center justify-between mb-3">
            <label className="text-sm text-gray-300">{def.paramLabels[k]??k}</label>
            <input
              type="number" value={params[k]}
              onChange={e=>setParams(p=>({...p,[k]:Number(e.target.value)}))}
              className="w-24 bg-[#131722] border border-[#2b2b43] rounded px-2 py-1 text-sm text-white text-right outline-none"
            />
          </div>
        ))}
        <div className="flex gap-2 mt-4">
          <button onClick={onClose}
            className="flex-1 py-1.5 rounded text-sm border border-[#2b2b43] text-gray-300 hover:bg-[#2b2b43]">
            取消
          </button>
          <button onClick={()=>{onApply(indicator.id,params);onClose()}}
            className="flex-1 py-1.5 rounded text-sm font-bold"
            style={{backgroundColor:'#f0b90b',color:'#000'}}>
            套用
          </button>
        </div>
      </div>
    </div>
  )
}

// ── Indicator Panel ───────────────────────────────────────────────────────────
interface IndicatorPanelProps {
  active: ActiveIndicator[]
  onToggleAdd: (defName:string) => void
  onOpenSettings: (id:string) => void
  onClose: () => void
}
function IndicatorPanel({active,onToggleAdd,onOpenSettings,onClose}:IndicatorPanelProps){
  const activeNames = new Set(active.map(a=>a.defName))
  return(
    <div className="absolute top-8 right-0 z-50 w-64 bg-[#1e222d] border border-[#2b2b43] rounded-lg shadow-2xl"
         onClick={e=>e.stopPropagation()}>
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#2b2b43]">
        <span className="text-sm font-bold">指標</span>
        <button onClick={onClose} className="text-gray-400 hover:text-white"><X size={14}/></button>
      </div>
      {INDICATOR_DEFS.map(def=>{
        const isOn = activeNames.has(def.name)
        const inst = active.find(a=>a.defName===def.name)
        return(
          <div key={def.name} className="flex items-center justify-between px-3 py-2 hover:bg-[#2b2b43]">
            <div className="flex items-center gap-2">
              {/* checkbox */}
              <div
                onClick={()=>onToggleAdd(def.name)}
                className="w-4 h-4 rounded border flex items-center justify-center cursor-pointer"
                style={{borderColor: isOn?'#f0b90b':'#555',backgroundColor:isOn?'#f0b90b':'transparent'}}>
                {isOn && <span style={{color:'#000',fontSize:'10px',fontWeight:'bold'}}>✓</span>}
              </div>
              <span className="text-sm text-gray-200">{def.label}</span>
            </div>
            {/* gear only if active */}
            {isOn && inst && (
              <button onClick={()=>onOpenSettings(inst.id)} className="text-gray-400 hover:text-white">
                <Settings size={13}/>
              </button>
            )}
          </div>
        )
      })}
    </div>
  )
}

// ── Main Component ────────────────────────────────────────────────────────────
export default function ChartPage(){
  const chartId  = 'kline-main'
  const chartRef = useRef<Chart|null>(null)
  const wsRef    = useRef<WebSocket|null>(null)
  const rcTimer  = useRef<ReturnType<typeof setTimeout>|null>(null)
  const tickRef  = useRef<ReturnType<typeof setInterval>|null>(null)

  const symRef  = useRef(getSaved('chart_symbol','BTCUSDT'))
  const ivRef   = useRef(getSaved('chart_interval','1h'))
  const mtRef   = useRef<MarketType>((getSaved('chart_market','futures') as MarketType))

  const [symbol,      setSym]    = useState(symRef.current)
  const [interval,    setIv]     = useState(ivRef.current)
  const [marketType,  setMt]     = useState<MarketType>(mtRef.current)
  const [loading,     setLoading]= useState(false)
  const [error,       setError]  = useState<string|null>(null)
  const [wsStatus,    setWsSt]   = useState<'connecting'|'live'|'disconnected'>('disconnected')

  const [price,       setPrice]  = useState<number|null>(null)
  const [ticker,      setTicker] = useState<TickerInfo|null>(null)
  const [lastTs,      setLastTs] = useState<number|null>(null)
  const [barTs,       setBarTs]  = useState<number|null>(null)
  const [agoStr,      setAgoStr] = useState('')

  const [searchQ,     setSearchQ]= useState('')
  const [showSymP,    setShowSymP]= useState(false)
  const [showIndP,    setShowIndP]= useState(false)

  // Active indicators: [{id, defName, visible, params}]
  const [activeInds,  setActiveInds] = useState<ActiveIndicator[]>([])
  // Settings modal target indicator id
  const [settingsId,  setSettingsId] = useState<string|null>(null)
  // Hover overlay on indicator rows
  const [hoverInd,    setHoverInd]   = useState<string|null>(null)

  // ── Init chart ──────────────────────────────────────────────────────────────
  useEffect(()=>{
    const chart = init(chartId,{
      layout:[
        { type:'candle',    options:{ gap:{ bottom:2 } } },
        { type:'indicator', content:['VOL'], options:{ height:60, gap:{ top:4 } } },
      ],
      styles:{
        grid:{ horizontal:{color:'#1e2328'}, vertical:{color:'#1e2328'} },
        candle:{
          bar:{ upColor:'#26a69a', downColor:'#ef5350', noChangeColor:'#888' },
          tooltip:{ labels:['時間','開','高','低','收','量'] },
        },
        indicator:{ ohlc:{ upColor:'#26a69a', downColor:'#ef5350' } },
        xAxis:{ tickText:{color:'#848e9c'}, axisLine:{color:'#2b2b43'} },
        yAxis:{ tickText:{color:'#848e9c'}, axisLine:{color:'#2b2b43'} },
        crosshair:{
          horizontal:{ line:{color:'#444'}, text:{color:'#fff',backgroundColor:'#2b2b43'} },
          vertical:  { line:{color:'#444'}, text:{color:'#fff',backgroundColor:'#2b2b43'} },
        },
        background:'#131722',
      },
      locale:'zh-TW',
      timezone:'Asia/Taipei',
    })
    if(chart){
      // default indicators: MA on candle, VOL already in layout, MACD sub
      const maId   = chart.createIndicator('MA',   false, {id:'candle_pane'}) as string
      const macdId = chart.createIndicator('MACD', false, {height:60}) as string
      chartRef.current = chart
      setActiveInds([
        { id:maId,   defName:'MA',   visible:true, params:{ period:14 } },
        { id:'vol_pane',  defName:'VOL',  visible:true, params:{} },       // VOL is in layout
        { id:macdId, defName:'MACD', visible:true, params:{ shortPeriod:12, longPeriod:26, signalPeriod:9 } },
      ])
    }
    return ()=>{ dispose(chartId) }
  },[])

  // ── Ticker every second ─────────────────────────────────────────────────────
  useEffect(()=>{
    tickRef.current = setInterval(()=>{
      if(lastTs!==null) setAgoStr(timeAgo(lastTs))
    },1000)
    return ()=>{ if(tickRef.current) clearInterval(tickRef.current) }
  },[lastTs])

  // ── WebSocket ────────────────────────────────────────────────────────────────
  const connectWS = useCallback((sym:string,iv:string,mt:MarketType)=>{
    if(wsRef.current){wsRef.current.onclose=null;wsRef.current.close();wsRef.current=null}
    if(rcTimer.current){clearTimeout(rcTimer.current);rcTimer.current=null}
    setWsSt('connecting')
    const ws=new WebSocket(`${mt==='futures'?FUTURES_WS_BASE:SPOT_WS_BASE}/${sym.toLowerCase()}@kline_${iv}`)
    wsRef.current=ws
    ws.onopen=()=>setWsSt('live')
    ws.onmessage=(ev)=>{
      try{
        const k=JSON.parse(ev.data)?.k; if(!k) return
        chartRef.current?.updateData({
          timestamp:k.t,open:parseFloat(k.o),high:parseFloat(k.h),
          low:parseFloat(k.l),close:parseFloat(k.c),
          volume:parseFloat(k.v),turnover:parseFloat(k.q)
        })
        setPrice(parseFloat(k.c)); setBarTs(k.t); setLastTs(Date.now())
      }catch(e){console.warn('ws parse',e)}
    }
    ws.onerror=()=>setWsSt('disconnected')
    ws.onclose=(e)=>{
      setWsSt('disconnected')
      if(e.code!==1000) rcTimer.current=setTimeout(
        ()=>connectWS(symRef.current,ivRef.current,mtRef.current),3000)
    }
  },[])

  // ── Load chart data ──────────────────────────────────────────────────────────
  const loadChart = useCallback(async(sym:string,iv:string,mt:MarketType)=>{
    if(!chartRef.current) return
    setLoading(true); setError(null)
    try{
      const [candles,tick]=await Promise.all([fetchKlines(mt,sym,iv,3000),fetchTicker(mt,sym)])
      if(!candles.length) throw new Error('Binance 回傳空資料')
      chartRef.current.applyNewData(candles)
      const last=candles[candles.length-1]
      setPrice(last.close); setBarTs(last.timestamp); setLastTs(Date.now()); setTicker(tick)
    }catch(err:any){ setError(err.message||'載入失敗'); setLoading(false); return }
    setLoading(false)
    connectWS(sym,iv,mt)
  },[connectWS])

  useEffect(()=>{
    const t=setTimeout(()=>loadChart(symRef.current,ivRef.current,mtRef.current),100)
    return ()=>clearTimeout(t)
  },[loadChart])

  // ── Symbol / interval / market handlers ─────────────────────────────────────
  const changeSym=(sym:string)=>{
    symRef.current=sym; localStorage.setItem('chart_symbol',sym)
    setSym(sym); setShowSymP(false); setSearchQ('')
    loadChart(sym,ivRef.current,mtRef.current)
  }
  const changeIv=(iv:string)=>{
    ivRef.current=iv; localStorage.setItem('chart_interval',iv)
    setIv(iv); loadChart(symRef.current,iv,mtRef.current)
  }
  const changeMt=(mt:MarketType)=>{
    mtRef.current=mt; localStorage.setItem('chart_market',mt)
    setMt(mt); loadChart(symRef.current,ivRef.current,mt)
  }

  // ── Indicator actions ────────────────────────────────────────────────────────
  const toggleIndicator=(defName:string)=>{
    const chart=chartRef.current; if(!chart) return
    const def=INDICATOR_DEFS.find(d=>d.name===defName)!
    const existing=activeInds.find(a=>a.defName===defName)
    if(existing){
      // remove
      chart.removeIndicator(existing.id)
      setActiveInds(p=>p.filter(a=>a.defName!==defName))
    } else {
      // add
      const params=def.defaultParams
      const opts = def.pane==='candle'
        ? { id:'candle_pane' }
        : { height:60 }
      const newId = chart.createIndicator(defName, false, opts) as string
      setActiveInds(p=>[...p,{id:newId,defName,visible:true,params:{...params}}])
    }
  }

  const toggleVisible=(id:string)=>{
    const chart=chartRef.current; if(!chart) return
    setActiveInds(prev=>prev.map(a=>{
      if(a.id!==id) return a
      const next=!a.visible
      // KLineChart: overrideIndicator with visible flag if supported
      try{ chart.overrideIndicator({name:a.defName,visible:next},a.id) }catch(_){}
      return {...a,visible:next}
    }))
  }

  const applySettings=(id:string,params:Record<string,number>)=>{
    const chart=chartRef.current; if(!chart) return
    const ind=activeInds.find(a=>a.id===id); if(!ind) return
    // re-create with new params is most reliable
    chart.removeIndicator(id)
    const def=INDICATOR_DEFS.find(d=>d.name===ind.defName)!
    const opts = def.pane==='candle' ? {id:'candle_pane'} : {height:60}
    const newId=chart.createIndicator(ind.defName,false,{...opts, calcParams:Object.values(params)}) as string
    setActiveInds(prev=>prev.map(a=>a.id===id?{...a,id:newId,params}:a))
  }

  const filteredSyms = POPULAR_SYMBOLS.filter(s=>s.toLowerCase().includes(searchQ.toLowerCase()))
  const priceUp   = (ticker?.priceChange??0)>=0
  const priceColor= priceUp ? '#26a69a' : '#ef5350'
  const wsColor   = wsStatus==='live'?'#26a69a':wsStatus==='connecting'?'#f0b90b':'#ef5350'

  const settingsInd  = settingsId ? activeInds.find(a=>a.id===settingsId) : null
  const settingsDef  = settingsInd ? INDICATOR_DEFS.find(d=>d.name===settingsInd.defName) : null

  return(
    <div className="flex flex-col bg-[#131722] text-gray-200"
         style={{height:'100vh',overflow:'hidden'}}
         onClick={()=>{ setShowSymP(false); setShowIndP(false) }}>

      <PageHeader title="K 線圖表"/>

      {/* ══ ROW 1: Toolbar ══ */}
      <div className="flex items-center gap-2 px-3 border-b border-[#2b2b43] bg-[#1e222d]"
           style={{height:'36px',flexShrink:0}}>

        {/* Symbol picker */}
        <div className="relative" onClick={e=>e.stopPropagation()}>
          <button onClick={()=>setShowSymP(v=>!v)}
            className="flex items-center gap-1 px-2 py-0.5 rounded text-sm font-bold hover:bg-[#2b2b43]"
            style={{color:'#f0b90b'}}>
            {symbol}<ChevronDown size={12}/>
          </button>
          {showSymP&&(
            <div className="absolute top-8 left-0 z-50 w-52 bg-[#1e222d] border border-[#2b2b43] rounded shadow-xl">
              <div className="p-2 border-b border-[#2b2b43]">
                <div className="flex items-center gap-2 bg-[#131722] rounded px-2 py-1">
                  <Search size={12} className="text-gray-400"/>
                  <input autoFocus value={searchQ} onChange={e=>setSearchQ(e.target.value)}
                    placeholder="搜尋..." className="bg-transparent text-xs outline-none w-full"/>
                </div>
              </div>
              <div className="max-h-48 overflow-y-auto">
                {filteredSyms.map(s=>(
                  <button key={s} onClick={()=>changeSym(s)}
                    className="w-full text-left px-3 py-1.5 text-xs hover:bg-[#2b2b43]"
                    style={{color:s===symbol?'#f0b90b':undefined,fontWeight:s===symbol?700:undefined}}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Spot / Futures */}
        <div className="flex rounded overflow-hidden border border-[#2b2b43]" style={{height:'22px'}}>
          {(['spot','futures'] as MarketType[]).map(mt=>(
            <button key={mt} onClick={()=>changeMt(mt)}
              style={{
                padding:'0 8px', fontSize:'11px', fontWeight:600,
                backgroundColor: marketType===mt ? '#f0b90b' : 'transparent',
                color: marketType===mt ? '#000' : '#848e9c',
              }}>
              {mt==='spot'?'現貨':'合約'}
            </button>
          ))}
        </div>

        <div style={{flex:1}}/>

        {/* WS status */}
        <div className="flex items-center gap-1">
          <div className="w-2 h-2 rounded-full" style={{backgroundColor:wsColor}}/>
          <span style={{fontSize:'10px',color:'#848e9c'}}>
            {wsStatus==='live'?'即時':wsStatus==='connecting'?'連線中':'離線'}
          </span>
        </div>

        {/* Refresh */}
        <button onClick={()=>loadChart(symRef.current,ivRef.current,mtRef.current)}
          disabled={loading}
          className="p-1 rounded hover:bg-[#2b2b43] text-gray-400 hover:text-white"
          style={{opacity:loading?0.5:1}}>
          <RefreshCw size={13} className={loading?'animate-spin':''}/>
        </button>
      </div>

      {/* ══ ROW 2: Price info bar ══ */}
      <div className="flex items-center gap-4 px-3 border-b border-[#2b2b43] bg-[#131722]"
           style={{height:'44px',flexShrink:0}}>

        {/* Big price */}
        <div className="flex flex-col justify-center" style={{minWidth:'120px'}}>
          <span className="font-mono font-bold" style={{fontSize:'20px',color:priceColor,lineHeight:1.1}}>
            {price!=null ? fmtPrice(price) : '—'}
          </span>
          {ticker&&(
            <span style={{fontSize:'11px',color:priceColor,lineHeight:1.1}}>
              {priceUp?'+':''}{fmtPrice(ticker.priceChange)} ({priceUp?'+':''}{ticker.priceChangePct.toFixed(2)}%)
            </span>
          )}
        </div>

        <div style={{width:'1px',height:'28px',backgroundColor:'#2b2b43'}}/>

        {/* 24h stats */}
        {ticker&&(
          <div className="flex items-center gap-4">
            <div className="flex flex-col">
              <span style={{fontSize:'9px',color:'#848e9c'}}>24H 最高</span>
              <span style={{fontSize:'12px',color:'#eee'}}>{fmtPrice(ticker.high24h)}</span>
            </div>
            <div className="flex flex-col">
              <span style={{fontSize:'9px',color:'#848e9c'}}>24H 最低</span>
              <span style={{fontSize:'12px',color:'#eee'}}>{fmtPrice(ticker.low24h)}</span>
            </div>
            <div className="flex flex-col">
              <span style={{fontSize:'9px',color:'#848e9c'}}>24H 量</span>
              <span style={{fontSize:'12px',color:'#eee'}}>{fmtVol(ticker.volume24h)}</span>
            </div>
          </div>
        )}

        <div style={{flex:1}}/>

        {/* Bar time + update age */}
        <div className="flex flex-col items-end">
          {barTs&&<span style={{fontSize:'11px',color:'#848e9c'}}>{fmtTs(barTs)} ({INTERVAL_LABELS[interval]})</span>}
          {agoStr&&<span style={{fontSize:'10px',color:'#555'}}>更新 {agoStr}</span>}
        </div>
      </div>

      {/* ══ ROW 3: Interval bar + Indicators button ══ */}
      <div className="flex items-center px-2 border-b border-[#2b2b43] bg-[#1e222d]"
           style={{height:'30px',flexShrink:0,gap:'2px'}}>

        {INTERVALS.map(iv=>{
          const active = interval===iv
          return(
            <button key={iv} onClick={()=>changeIv(iv)}
              style={{
                padding:'2px 7px', borderRadius:'3px', fontSize:'12px', fontWeight: active?700:400,
                backgroundColor: active ? '#f0b90b' : 'transparent',
                color: active ? '#000' : '#848e9c',
                transition:'background 0.15s',
              }}>
              {INTERVAL_LABELS[iv]}
            </button>
          )
        })}

        <div style={{flex:1}}/>

        {/* Indicators button */}
        <div className="relative" onClick={e=>e.stopPropagation()}>
          <button onClick={()=>setShowIndP(v=>!v)}
            className="flex items-center gap-1 px-2 py-0.5 rounded hover:bg-[#2b2b43]"
            style={{fontSize:'12px',color:showIndP?'#f0b90b':'#848e9c',height:'22px'}}>
            <BarChart2 size={13}/>
            指標
          </button>
          {showIndP&&(
            <IndicatorPanel
              active={activeInds}
              onToggleAdd={toggleIndicator}
              onOpenSettings={id=>{ setSettingsId(id); setShowIndP(false) }}
              onClose={()=>setShowIndP(false)}
            />
          )}
        </div>
      </div>

      {/* ══ ROW 4: Active indicator overlay row ══ */}
      {activeInds.length>0&&(
        <div className="flex items-center gap-1 px-3 bg-[#131722]"
             style={{height:'24px',flexShrink:0,overflow:'hidden'}}>
          {activeInds.map(ind=>{
            const def=INDICATOR_DEFS.find(d=>d.name===ind.defName)
            return(
              <div key={ind.id}
                   onMouseEnter={()=>setHoverInd(ind.id)}
                   onMouseLeave={()=>setHoverInd(null)}
                   className="flex items-center gap-0.5 rounded px-1.5"
                   style={{
                     fontSize:'11px',color:'#848e9c',cursor:'default',
                     backgroundColor:hoverInd===ind.id?'#1e222d':'transparent',
                   }}>
                <span style={{color:'#ccc'}}>{def?.label}</span>
                {Object.entries(ind.params).length>0&&(
                  <span style={{color:'#555',marginLeft:'2px'}}>
                    ({Object.values(ind.params).join(',')})
                  </span>
                )}
                {hoverInd===ind.id&&(
                  <div className="flex items-center gap-1 ml-1">
                    {/* Eye toggle */}
                    <button onClick={()=>toggleVisible(ind.id)}
                      className="hover:text-white" title={ind.visible?'隱藏':'顯示'}>
                      {ind.visible ? <Eye size={11}/> : <EyeOff size={11}/>}
                    </button>
                    {/* Settings */}
                    <button onClick={()=>setSettingsId(ind.id)}
                      className="hover:text-white" title="設定">
                      <Settings size={11}/>
                    </button>
                    {/* Remove */}
                    <button onClick={()=>toggleIndicator(ind.defName)}
                      className="hover:text-red-400" title="移除">
                      <X size={11}/>
                    </button>
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}

      {/* Error */}
      {error&&(
        <div className="px-3 py-1 text-xs text-red-400 bg-red-900/20 border-b border-red-900">
          {error}
        </div>
      )}

      {/* ══ ROW 5: Chart (fills remaining height) ══ */}
      <div style={{flex:1,minHeight:0,position:'relative'}}>
        {loading&&(
          <div className="absolute inset-0 flex items-center justify-center z-10 bg-black/40">
            <div className="flex items-center gap-2 text-sm text-gray-300">
              <RefreshCw size={16} className="animate-spin"/> 載入中...
            </div>
          </div>
        )}
        <div id={chartId} style={{width:'100%',height:'100%'}}/>
      </div>

      {/* Settings Modal */}
      {settingsId&&settingsInd&&settingsDef&&(
        <SettingsModal
          indicator={settingsInd}
          def={settingsDef}
          onClose={()=>setSettingsId(null)}
          onApply={applySettings}
        />
      )}
    </div>
  )
}
