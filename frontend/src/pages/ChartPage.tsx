/**
 * ChartPage v10 — Full KLineChart-style UI
 *
 * Layout (mirrors preview.klinecharts.com):
 *   ┌─────────────────────────────────────────────┐
 *   │  TOP BAR: symbol | intervals | indicators   │
 *   │           screenshot | fullscreen           │
 *   ├──┬──────────────────────────────────────────┤
 *   │L │                                          │
 *   │E │         KLineChart canvas                │
 *   │F │    (OHLCV + indicator tooltips built-in) │
 *   │T │                                          │
 *   │  │                                          │
 *   └──┴──────────────────────────────────────────┘
 *
 * Left sidebar: drawing tools (line, hline, vline, rect, circle,
 *   parallelogram, fibonacciLine, arrow, text, …)
 *
 * All indicator labels + values are rendered by KLineChart's own
 * canvas tooltip (showRule:'always'). Zero React DOM hover hacks.
 *
 * Drawing overlays are pure KLineChart createOverlay() calls.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { init, dispose, Chart, registerOverlay } from 'klinecharts'
import {
  Search, X, Settings, BarChart2, RefreshCw, ChevronDown,
  Eye, EyeOff, Plus, Minus, Camera, Maximize2, Minimize2,
  Minus as HLine, AlignJustify, TrendingUp, Triangle,
  Square, Circle, Sliders, Type, ArrowRight, Trash2,
} from 'lucide-react'
import PageHeader from '../components/PageHeader'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const INTERVALS = ['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','1w']
const INTERVAL_LABELS: Record<string,string> = {
  '1m':'1m','3m':'3m','5m':'5m','15m':'15m','30m':'30m',
  '1h':'1H','2h':'2H','4h':'4H','6h':'6H','12h':'12H','1d':'1D','1w':'1W',
}
const POPULAR_SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','MATICUSDT',
  'LINKUSDT','UNIUSDT','LTCUSDT','ATOMUSDT','NEARUSDT',
]
const LINE_COLORS = ['#f0b90b','#2196f3','#e040fb','#00e5ff','#ff5252','#69f0ae','#ff6d00','#40c4ff']

// ─────────────────────────────────────────────────────────────────────────────
// Drawing tool definitions
// ─────────────────────────────────────────────────────────────────────────────
interface DrawTool {
  id: string        // KLineChart overlay name
  label: string
  icon: React.ReactNode
  group: string
}

const DRAW_TOOLS: DrawTool[] = [
  // Lines
  { id: 'straightLine',      label: '直線',       icon: <TrendingUp size={16}/>,   group: 'line' },
  { id: 'horizontalStraightLine', label: '水平線', icon: <HLine size={16}/>,       group: 'line' },
  { id: 'verticalStraightLine',   label: '垂直線', icon: <AlignJustify size={16}/>, group: 'line' },
  { id: 'rayLine',           label: '射線',       icon: <ArrowRight size={16}/>,   group: 'line' },
  { id: 'segment',           label: '線段',       icon: <Minus size={16}/>,        group: 'line' },
  // Channels
  { id: 'parallelStraightLine', label: '平行線',  icon: <AlignJustify size={16}/>, group: 'channel' },
  // Fibonacci
  { id: 'fibonacciLine',     label: 'Fib 回撤',   icon: <Sliders size={16}/>,      group: 'fib' },
  { id: 'fibonacciSegment',  label: 'Fib 線段',   icon: <Sliders size={16}/>,      group: 'fib' },
  // Shapes
  { id: 'rect',              label: '矩形',       icon: <Square size={16}/>,       group: 'shape' },
  { id: 'circle',            label: '圓形',       icon: <Circle size={16}/>,       group: 'shape' },
  { id: 'triangle',          label: '三角形',     icon: <Triangle size={16}/>,     group: 'shape' },
  // Annotations
  { id: 'arrow',             label: '箭頭',       icon: <ArrowRight size={16}/>,   group: 'annotation' },
  { id: 'text',              label: '文字',       icon: <Type size={16}/>,         group: 'annotation' },
]

// Group separators
const TOOL_GROUPS = ['line','channel','fib','shape','annotation']

// ─────────────────────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────────────────────
type MarketType = 'spot' | 'futures'

interface RawKline {
  timestamp: number; open: number; high: number; low: number
  close: number; volume: number; turnover: number
}
interface TickerInfo {
  priceChange: number; priceChangePct: number
  high24h: number; low24h: number; volume24h: number
}

interface PeriodEntry { value: number; visible: boolean }

interface ActiveIndicator {
  defName: string
  paneId: string
  periods?: PeriodEntry[]
  params: Record<string, number>
  visible: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Indicator catalogue
// ─────────────────────────────────────────────────────────────────────────────
interface IndicatorDef {
  name: string; label: string; pane: 'main' | 'sub'
  multiPeriod?: boolean; defaultPeriods?: number[]
  defaultParams: Record<string, number>
  paramLabels: Record<string, string>
}

const INDICATOR_DEFS: IndicatorDef[] = [
  { name:'MA',   label:'MA 移動均線',   pane:'main', multiPeriod:true, defaultPeriods:[5,10,20,60], defaultParams:{}, paramLabels:{} },
  { name:'EMA',  label:'EMA 指數均線',  pane:'main', multiPeriod:true, defaultPeriods:[5,10,20,60], defaultParams:{}, paramLabels:{} },
  { name:'BOLL', label:'BOLL 布林帶',   pane:'main', defaultParams:{ period:20, multiplier:2 }, paramLabels:{ period:'週期', multiplier:'倍數' } },
  { name:'SAR',  label:'SAR 拋物線',    pane:'main', defaultParams:{ step:0.02, max:0.2 },      paramLabels:{ step:'步長', max:'最大值' } },
  { name:'VOL',  label:'VOL 成交量',    pane:'sub',  defaultParams:{}, paramLabels:{} },
  { name:'MACD', label:'MACD',          pane:'sub',  defaultParams:{ shortPeriod:12, longPeriod:26, signalPeriod:9 }, paramLabels:{ shortPeriod:'短期', longPeriod:'長期', signalPeriod:'訊號' } },
  { name:'RSI',  label:'RSI',           pane:'sub',  defaultParams:{ period:14 }, paramLabels:{ period:'週期' } },
  { name:'KDJ',  label:'KDJ',           pane:'sub',  defaultParams:{ period:9, signalPeriod:3 }, paramLabels:{ period:'週期', signalPeriod:'訊號' } },
  { name:'OBV',  label:'OBV 能量潮',    pane:'sub',  defaultParams:{}, paramLabels:{} },
  { name:'DMI',  label:'DMI 趨向指標',  pane:'sub',  defaultParams:{ period:14, adxPeriod:6 }, paramLabels:{ period:'週期', adxPeriod:'ADX週期' } },
]

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────
const SPOT_REST      = 'https://api.binance.com/api/v3/klines'
const FUTURES_REST   = 'https://fapi.binance.com/fapi/v1/klines'
const SPOT_TICKER    = 'https://api.binance.com/api/v3/ticker/24hr'
const FUTURES_TICKER = 'https://fapi.binance.com/fapi/v1/ticker/24hr'
const SPOT_WS_BASE   = 'wss://stream.binance.com:9443/ws'
const FUTURES_WS_BASE= 'wss://fstream.binance.com/ws'

const getSaved = (k: string, def: string) => localStorage.getItem(k) ?? def

async function fetchBatch(mt: MarketType, sym: string, iv: string, limit: number, endTime?: number): Promise<RawKline[]> {
  const base = mt === 'futures' ? FUTURES_REST : SPOT_REST
  const max  = mt === 'futures' ? 1500 : 1000
  const p = new URLSearchParams({ symbol: sym, interval: iv, limit: String(Math.min(limit, max)) })
  if (endTime) p.set('endTime', String(endTime))
  const res = await fetch(`${base}?${p}`)
  if (!res.ok) throw new Error(`Binance ${res.status}`)
  const raw: any[][] = await res.json()
  return raw.map(k => ({ timestamp: k[0], open: +k[1], high: +k[2], low: +k[3], close: +k[4], volume: +k[5], turnover: +k[7] }))
}

async function fetchKlines(mt: MarketType, sym: string, iv: string, target = 1500): Promise<RawKline[]> {
  const bs = mt === 'futures' ? 1500 : 1000
  const batches = Math.ceil(target / bs)
  let all: RawKline[] = []; let endTime: number | undefined
  for (let i = 0; i < batches; i++) {
    const b = await fetchBatch(mt, sym, iv, bs, endTime)
    if (!b.length) break
    all = [...b, ...all]; endTime = b[0].timestamp - 1
  }
  const seen = new Set<number>()
  return all
    .filter(k => { if (seen.has(k.timestamp)) return false; seen.add(k.timestamp); return true })
    .sort((a, b) => a.timestamp - b.timestamp)
}

async function fetchTicker(mt: MarketType, sym: string): Promise<TickerInfo> {
  const res = await fetch(`${mt === 'futures' ? FUTURES_TICKER : SPOT_TICKER}?symbol=${sym}`)
  if (!res.ok) throw new Error(`Ticker ${res.status}`)
  const d = await res.json()
  return {
    priceChange: +d.priceChange, priceChangePct: +d.priceChangePercent,
    high24h: +d.highPrice, low24h: +d.lowPrice, volume24h: +d.volume,
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Format helpers
// ─────────────────────────────────────────────────────────────────────────────
function fmtPrice(p: number): string {
  if (p >= 1000) return p.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  if (p >= 1)    return p.toFixed(4)
  return p.toFixed(6)
}
function fmtVol(v: number): string {
  if (v >= 1e9) return (v / 1e9).toFixed(2) + 'B'
  if (v >= 1e6) return (v / 1e6).toFixed(2) + 'M'
  if (v >= 1e3) return (v / 1e3).toFixed(2) + 'K'
  return v.toFixed(2)
}
function buildCalcParams(periods: PeriodEntry[]): number[] {
  return periods.filter(p => p.visible).map(p => p.value)
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings Modal
// ─────────────────────────────────────────────────────────────────────────────
function SettingsModal({ indicator, def, onClose, onApply }: {
  indicator: ActiveIndicator; def: IndicatorDef; onClose: () => void
  onApply: (defName: string, periods?: PeriodEntry[], params?: Record<string, number>) => void
}) {
  const [periods, setPeriods] = useState<PeriodEntry[]>(indicator.periods ? [...indicator.periods] : [])
  const [params,  setParams]  = useState({ ...indicator.params })

  const togglePeriod   = (i: number) => setPeriods(prev => prev.map((p, idx) => idx === i ? { ...p, visible: !p.visible } : p))
  const setPeriodValue = (i: number, v: number) => setPeriods(prev => prev.map((p, idx) => idx === i ? { ...p, value: v } : p))
  const addPeriod      = () => { if (periods.length >= 8) return; const last = periods[periods.length-1]?.value ?? 20; setPeriods(prev => [...prev, { value: last+10, visible: true }]) }
  const removePeriod   = (i: number) => { if (periods.length <= 1) return; setPeriods(prev => prev.filter((_, idx) => idx !== i)) }

  return (
    <div style={{ position:'fixed', inset:0, zIndex:200, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(0,0,0,.6)' }} onClick={onClose}>
      <div style={{ background:'#1e222d', border:'1px solid #2b2b43', borderRadius:8, width:300, overflow:'hidden', boxShadow:'0 8px 32px rgba(0,0,0,.6)' }} onClick={e => e.stopPropagation()}>
        <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'10px 14px', borderBottom:'1px solid #2b2b43' }}>
          <span style={{ fontWeight:700, color:'#fff', fontSize:13 }}>{def.label} 設定</span>
          <span role="button" onClick={onClose} style={{ cursor:'pointer', color:'#848e9c', display:'flex' }}><X size={14}/></span>
        </div>
        <div style={{ padding:'12px 14px' }}>
          {def.multiPeriod && (
            <>
              {periods.map((p, i) => (
                <div key={i} style={{ display:'flex', alignItems:'center', gap:8, marginBottom:8 }}>
                  <div style={{ width:12, height:12, borderRadius:'50%', background: LINE_COLORS[i % LINE_COLORS.length], flexShrink:0 }} />
                  <div
                    onClick={() => togglePeriod(i)}
                    style={{ width:14, height:14, borderRadius:3, border:`1px solid ${p.visible ? '#f0b90b' : '#555'}`, background: p.visible ? '#f0b90b' : 'transparent', display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', flexShrink:0 }}
                  >
                    {p.visible && <span style={{ fontSize:9, fontWeight:900, color:'#000', lineHeight:1 }}>✓</span>}
                  </div>
                  <input
                    type="number" value={p.value}
                    onChange={e => setPeriodValue(i, +e.target.value)}
                    style={{ width:60, background:'#131722', border:'1px solid #2b2b43', borderRadius:4, padding:'3px 7px', fontSize:12, color:'#fff', outline:'none' }}
                  />
                  <span
                    role="button" onClick={() => removePeriod(i)}
                    style={{ cursor: periods.length > 1 ? 'pointer' : 'not-allowed', color: periods.length > 1 ? '#848e9c' : '#333', display:'flex', marginLeft:'auto' }}
                  >
                    <Minus size={13}/>
                  </span>
                </div>
              ))}
              {periods.length < 8 && (
                <div role="button" onClick={addPeriod} style={{ display:'flex', alignItems:'center', gap:6, padding:'4px 0', cursor:'pointer', color:'#848e9c', fontSize:12 }}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#d1d4dc')}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '#848e9c')}
                >
                  <Plus size={13}/> 新增均線
                </div>
              )}
            </>
          )}
          {!def.multiPeriod && (
            Object.keys(params).length === 0
              ? <p style={{ color:'#848e9c', fontSize:13, textAlign:'center', padding:'8px 0' }}>此指標無可調參數</p>
              : Object.keys(params).map(k => (
                <div key={k} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', marginBottom:12 }}>
                  <label style={{ fontSize:13, color:'#d1d4dc' }}>{def.paramLabels[k] ?? k}</label>
                  <input
                    type="number" value={params[k]}
                    onChange={e => setParams(p => ({ ...p, [k]: +e.target.value }))}
                    style={{ width:90, background:'#131722', border:'1px solid #2b2b43', borderRadius:4, padding:'4px 8px', fontSize:13, color:'#fff', textAlign:'right', outline:'none' }}
                  />
                </div>
              ))
          )}
        </div>
        <div style={{ display:'flex', gap:8, padding:'8px 14px 14px' }}>
          <button onClick={onClose} style={{ flex:1, padding:'6px 0', borderRadius:4, fontSize:13, border:'1px solid #2b2b43', background:'transparent', color:'#d1d4dc', cursor:'pointer' }}>取消</button>
          <button
            onClick={() => { onApply(indicator.defName, def.multiPeriod ? periods : undefined, def.multiPeriod ? undefined : params); onClose() }}
            style={{ flex:1, padding:'6px 0', borderRadius:4, fontSize:13, fontWeight:700, border:'none', background:'#f0b90b', color:'#000', cursor:'pointer' }}
          >套用</button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Indicator Row (inside dropdown)
// ─────────────────────────────────────────────────────────────────────────────
function IndicatorRow({ def, isOn, onToggle, onSettings }: {
  def: IndicatorDef; isOn: boolean; onToggle: () => void; onSettings: () => void
}) {
  return (
    <div
      style={{ display:'flex', alignItems:'center', gap:8, padding:'7px 12px', cursor:'pointer' }}
      onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#2b2b43' }}
      onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = 'transparent' }}
      onClick={onToggle}
    >
      <div style={{
        width:14, height:14, borderRadius:3, flexShrink:0,
        border:`1px solid ${isOn ? '#f0b90b' : '#555'}`,
        background: isOn ? '#f0b90b' : 'transparent',
        display:'flex', alignItems:'center', justifyContent:'center',
      }}>
        {isOn && <span style={{ fontSize:9, fontWeight:900, color:'#000', lineHeight:1 }}>✓</span>}
      </div>
      <span style={{ fontSize:12, color:'#d1d4dc', flex:1 }}>{def.label}</span>
      {isOn && (
        <span
          role="button"
          onClick={e => { e.stopPropagation(); onSettings() }}
          title="設定"
          style={{ display:'flex', alignItems:'center', cursor:'pointer', color:'#848e9c', padding:1, flexShrink:0 }}
          onMouseEnter={e => { e.stopPropagation(); (e.currentTarget as HTMLElement).style.color = '#d1d4dc' }}
          onMouseLeave={e => { e.stopPropagation(); (e.currentTarget as HTMLElement).style.color = '#848e9c' }}
        >
          <Settings size={12}/>
        </span>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Indicator Dropdown Panel
// ─────────────────────────────────────────────────────────────────────────────
function IndicatorPanel({ activeInds, onToggle, onOpenSettings, onClose }: {
  activeInds: ActiveIndicator[]; onToggle: (n: string) => void
  onOpenSettings: (n: string) => void; onClose: () => void
}) {
  const activeNames = new Set(activeInds.map(a => a.defName))
  const mainDefs = INDICATOR_DEFS.filter(d => d.pane === 'main')
  const subDefs  = INDICATOR_DEFS.filter(d => d.pane === 'sub')
  return (
    <div style={{ position:'absolute', top:'100%', right:0, marginTop:4, zIndex:100, width:230, background:'#1e222d', border:'1px solid #2b2b43', borderRadius:8, boxShadow:'0 8px 24px rgba(0,0,0,.5)', overflow:'hidden' }}>
      <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', padding:'8px 12px', borderBottom:'1px solid #2b2b43' }}>
        <span style={{ fontSize:12, fontWeight:700, color:'#d1d4dc' }}>技術指標</span>
        <span role="button" onClick={onClose} style={{ cursor:'pointer', color:'#848e9c', display:'flex' }}><X size={13}/></span>
      </div>
      <div style={{ padding:'4px 12px 2px', fontSize:10, color:'#848e9c', fontWeight:600, letterSpacing:1, marginTop:4 }}>主圖</div>
      {mainDefs.map(def => (
        <IndicatorRow key={def.name} def={def} isOn={activeNames.has(def.name)} onToggle={() => onToggle(def.name)} onSettings={() => onOpenSettings(def.name)} />
      ))}
      <div style={{ padding:'6px 12px 2px', fontSize:10, color:'#848e9c', fontWeight:600, letterSpacing:1, borderTop:'1px solid #1e2328', marginTop:4 }}>副圖</div>
      {subDefs.map(def => (
        <IndicatorRow key={def.name} def={def} isOn={activeNames.has(def.name)} onToggle={() => onToggle(def.name)} onSettings={() => onOpenSettings(def.name)} />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Left Drawing Toolbar
// ─────────────────────────────────────────────────────────────────────────────
function DrawToolbar({ activeTool, onSelect, onClear }: {
  activeTool: string | null
  onSelect: (id: string) => void
  onClear: () => void
}) {
  const [tooltip, setTooltip] = useState<{ label: string; y: number } | null>(null)

  let lastGroup = ''
  return (
    <div style={{
      width: 36, flexShrink: 0, background: '#1e222d',
      borderRight: '1px solid #2b2b43',
      display: 'flex', flexDirection: 'column', alignItems: 'center',
      paddingTop: 6, paddingBottom: 6, gap: 2, position: 'relative', overflowY: 'auto',
    }}>
      {DRAW_TOOLS.map(tool => {
        const showSep = tool.group !== lastGroup
        if (showSep) lastGroup = tool.group
        const isActive = activeTool === tool.id
        return (
          <div key={tool.id}>
            {showSep && lastGroup !== DRAW_TOOLS[0].group && (
              <div style={{ width: 24, height: 1, background: '#2b2b43', margin: '3px auto' }} />
            )}
            <div
              role="button"
              title={tool.label}
              onClick={() => onSelect(tool.id)}
              style={{
                width: 28, height: 28, borderRadius: 4, display: 'flex', alignItems: 'center', justifyContent: 'center',
                cursor: 'pointer',
                background: isActive ? '#f0b90b22' : 'transparent',
                color: isActive ? '#f0b90b' : '#848e9c',
                border: isActive ? '1px solid #f0b90b66' : '1px solid transparent',
              }}
              onMouseEnter={e => {
                if (!isActive) (e.currentTarget as HTMLElement).style.color = '#d1d4dc'
                const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
                const parentRect = (e.currentTarget as HTMLElement).closest('[data-sidebar]')?.getBoundingClientRect()
                setTooltip({ label: tool.label, y: rect.top - (parentRect?.top ?? 0) + 4 })
              }}
              onMouseLeave={e => {
                if (!isActive) (e.currentTarget as HTMLElement).style.color = '#848e9c'
                setTooltip(null)
              }}
            >
              {tool.icon}
            </div>
          </div>
        )
      })}

      {/* Divider */}
      <div style={{ width:24, height:1, background:'#2b2b43', margin:'3px auto' }} />

      {/* Clear all overlays */}
      <div
        role="button" title="清除所有繪圖" onClick={onClear}
        style={{ width:28, height:28, borderRadius:4, display:'flex', alignItems:'center', justifyContent:'center', cursor:'pointer', color:'#848e9c', border:'1px solid transparent' }}
        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#ef5350'; (e.currentTarget as HTMLElement).style.borderColor = '#ef535066' }}
        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#848e9c'; (e.currentTarget as HTMLElement).style.borderColor = 'transparent' }}
      >
        <Trash2 size={15}/>
      </div>

      {/* Tooltip popup */}
      {tooltip && (
        <div style={{
          position: 'absolute', left: 38, top: tooltip.y, zIndex: 200,
          background: '#2b2b43', color: '#d1d4dc', fontSize: 11,
          padding: '3px 8px', borderRadius: 4, whiteSpace: 'nowrap',
          pointerEvents: 'none', boxShadow: '0 2px 8px rgba(0,0,0,.4)',
        }}>
          {tooltip.label}
        </div>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function ChartPage() {
  const CHART_ID = 'kline-chart'
  const chartRef   = useRef<Chart | null>(null)
  const wsRef      = useRef<WebSocket | null>(null)
  const rcRef      = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickRef    = useRef<ReturnType<typeof setInterval> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const symRef = useRef(getSaved('chart_symbol',   'BTCUSDT'))
  const ivRef  = useRef(getSaved('chart_interval',  '1h'))
  const mtRef  = useRef<MarketType>(getSaved('chart_market', 'futures') as MarketType)

  const [symbol,     setSym]    = useState(symRef.current)
  const [interval,   setIv]     = useState(ivRef.current)
  const [marketType, setMt]     = useState<MarketType>(mtRef.current)
  const [loading,    setLoading] = useState(false)
  const [error,      setError]   = useState<string | null>(null)
  const [wsStatus,   setWsSt]    = useState<'connecting'|'live'|'disconnected'>('disconnected')

  const [price,  setPrice]  = useState<number | null>(null)
  const [ticker, setTicker] = useState<TickerInfo | null>(null)

  const [searchQ,  setSearchQ]  = useState('')
  const [showSymP, setShowSymP] = useState(false)
  const [showIndP, setShowIndP] = useState(false)
  const [isFullscreen, setIsFullscreen] = useState(false)

  const [activeInds,   setActiveInds]   = useState<ActiveIndicator[]>([])
  const [settingsName, setSettingsName] = useState<string | null>(null)

  // Drawing tool state
  const [activeTool, setActiveTool] = useState<string | null>(null)
  const activeToolRef = useRef<string | null>(null)

  // ── Chart init ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = init(CHART_ID, {
      styles: {
        grid: {
          horizontal: { color: '#1e2328', size: 1, style: 'dashed', show: true },
          vertical:   { color: '#1e2328', size: 1, style: 'dashed', show: true },
        },
        candle: {
          bar: { upColor: '#26a69a', downColor: '#ef5350', noChangeColor: '#888', upBorderColor: '#26a69a', downBorderColor: '#ef5350', upWickColor: '#26a69a', downWickColor: '#ef5350' },
          tooltip: {
            showRule: 'always',
            showType: 'standard',
            labels: ['T', 'O', 'H', 'L', 'C', 'V'],
            values: null,
            defaultValue: 'n/a',
            rect: { paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 6, offsetLeft: 8, offsetTop: 8, offsetRight: 8, borderRadius: 4, borderSize: 1, borderColor: '#2b2b43', color: '#1e222d' },
            text: { size: 11, family: 'Helvetica Neue', weight: 'normal', color: '#848e9c', marginLeft: 8, marginTop: 6, marginRight: 8, marginBottom: 0 },
          },
        },
        indicator: {
          ohlc: { upColor: '#26a69a', downColor: '#ef5350', noChangeColor: '#888' },
          tooltip: {
            showRule: 'always',
            showType: 'standard',
            rect: { paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 6, offsetLeft: 8, offsetTop: 8, offsetRight: 8, borderRadius: 4, borderSize: 1, borderColor: '#2b2b43', color: '#1e222d' },
            text: { size: 11, family: 'Helvetica Neue', weight: 'normal', color: '#848e9c', marginLeft: 8, marginTop: 6, marginRight: 8, marginBottom: 0 },
          },
        },
        xAxis: {
          show: true,
          axisLine: { show: true, color: '#2b2b43', size: 1 },
          tickLine: { show: true, size: 1, length: 3, distance: 0, color: '#2b2b43' },
          tickText: { show: true, color: '#848e9c', family: 'Helvetica Neue', weight: 'normal', size: 11, marginStart: 4, marginEnd: 4 },
        },
        yAxis: {
          show: true,
          axisLine: { show: false, color: '#2b2b43', size: 1 },
          tickLine: { show: false, size: 1, length: 3, distance: 0, color: '#2b2b43' },
          tickText: { show: true, color: '#848e9c', family: 'Helvetica Neue', weight: 'normal', size: 11, marginStart: 4, marginEnd: 4 },
        },
        separator: {
          size: 1, color: '#2b2b43', fill: true,
          activeBackgroundColor: 'rgba(230, 230, 230, .15)',
        },
        crosshair: {
          show: true,
          horizontal: { show: true, line: { show: true, style: 'dashed', dashedValue: [4,2], size: 1, color: '#44475a' }, text: { show: true, size: 11, family: 'Helvetica Neue', weight: 'normal', color: '#d1d4dc', paddingLeft: 4, paddingRight: 4, paddingTop: 3, paddingBottom: 3, borderSize: 1, borderRadius: 2, borderColor: '#2b2b43', backgroundColor: '#2b2b43' } },
          vertical:   { show: true, line: { show: true, style: 'dashed', dashedValue: [4,2], size: 1, color: '#44475a' }, text: { show: true, size: 11, family: 'Helvetica Neue', weight: 'normal', color: '#d1d4dc', paddingLeft: 4, paddingRight: 4, paddingTop: 3, paddingBottom: 3, borderSize: 1, borderRadius: 2, borderColor: '#2b2b43', backgroundColor: '#2b2b43' } },
        },
        overlay: {
          line: { style: 'solid', smooth: false, size: 1, color: '#f0b90b', dashedValue: [2,2] },
          rect: { style: 'stroke_fill', color: 'rgba(240,185,11,.1)', borderColor: '#f0b90b', borderSize: 1, borderStyle: 'solid', borderRadius: 0 },
          circle: { style: 'stroke_fill', color: 'rgba(240,185,11,.1)', borderColor: '#f0b90b', borderSize: 1, borderStyle: 'solid' },
          arc: { style: 'solid', color: '#f0b90b', size: 1 },
          polygon: { style: 'stroke_fill', color: 'rgba(240,185,11,.1)', borderColor: '#f0b90b', borderSize: 1, borderStyle: 'solid' },
          text: { style: 'fill', color: '#f0b90b', size: 13, family: 'Helvetica Neue', weight: 'normal', paddingLeft: 0, paddingRight: 0, paddingTop: 0, paddingBottom: 0, borderSize: 1, borderRadius: 2, borderColor: '#f0b90b', backgroundColor: 'transparent' },
          point: { color: '#f0b90b', borderColor: '#f0b90b', borderSize: 1, radius: 4, activeRadius: 6, activeColor: '#f0b90b', activeBorderColor: '#fff', activeBorderSize: 2 },
        },
      },
    })
    chartRef.current = chart as Chart

    return () => { dispose(CHART_ID) }
  }, [])

  // ── WebSocket ──────────────────────────────────────────────────────────────
  const connectWS = useCallback((mt: MarketType, sym: string, iv: string) => {
    wsRef.current?.close()
    setWsSt('connecting')
    const base  = mt === 'futures' ? FUTURES_WS_BASE : SPOT_WS_BASE
    const stream = `${sym.toLowerCase()}@kline_${iv}`
    const ws     = new WebSocket(`${base}/${stream}`)
    wsRef.current = ws

    ws.onopen  = () => setWsSt('live')
    ws.onclose = () => {
      setWsSt('disconnected')
      if (rcRef.current) clearTimeout(rcRef.current)
      rcRef.current = setTimeout(() => connectWS(mt, sym, iv), 3000)
    }
    ws.onerror = () => ws.close()
    ws.onmessage = e => {
      const d = JSON.parse(e.data)?.k
      if (!d) return
      const bar = { timestamp: d.t, open: +d.o, high: +d.h, low: +d.l, close: +d.c, volume: +d.v, turnover: +d.q }
      chartRef.current?.updateData(bar)
      setPrice(+d.c)
    }
  }, [])

  // ── Load data ──────────────────────────────────────────────────────────────
  const loadData = useCallback(async (mt: MarketType, sym: string, iv: string) => {
    const chart = chartRef.current; if (!chart) return
    setLoading(true); setError(null)
    try {
      const [klines, tkr] = await Promise.all([
        fetchKlines(mt, sym, iv, 1500),
        fetchTicker(mt, sym),
      ])
      chart.applyNewData(klines)
      setPrice(klines[klines.length - 1]?.close ?? null)
      setTicker(tkr)
    } catch (err: any) {
      setError(err?.message ?? '載入失敗')
    } finally {
      setLoading(false)
    }
  }, [])

  // ── Switch pair ────────────────────────────────────────────────────────────
  const switchPair = useCallback((mt: MarketType, sym: string, iv: string) => {
    symRef.current = sym; ivRef.current = iv; mtRef.current = mt
    localStorage.setItem('chart_symbol', sym)
    localStorage.setItem('chart_interval', iv)
    localStorage.setItem('chart_market', mt)
    setSym(sym); setIv(iv); setMt(mt)
    setActiveInds([])
    if (rcRef.current) clearTimeout(rcRef.current)
    loadData(mt, sym, iv)
    connectWS(mt, sym, iv)
  }, [loadData, connectWS])

  useEffect(() => {
    switchPair(mtRef.current, symRef.current, ivRef.current)
    return () => {
      wsRef.current?.close()
      if (rcRef.current)  clearTimeout(rcRef.current)
      if (tickRef.current) clearInterval(tickRef.current)
    }
  }, [])

  // ── Drawing tool handler ───────────────────────────────────────────────────
  const handleToolSelect = useCallback((toolId: string) => {
    const chart = chartRef.current; if (!chart) return
    // Toggle off if same tool selected again
    if (activeToolRef.current === toolId) {
      activeToolRef.current = null
      setActiveTool(null)
      chart.removeOverlay()
      return
    }
    activeToolRef.current = toolId
    setActiveTool(toolId)
    // Create overlay — KLineChart handles mouse interaction automatically
    try {
      chart.createOverlay({ name: toolId })
    } catch (err) {
      console.warn('createOverlay error', toolId, err)
    }
  }, [])

  const handleClearOverlays = useCallback(() => {
    const chart = chartRef.current; if (!chart) return
    chart.removeOverlay()
    activeToolRef.current = null
    setActiveTool(null)
  }, [])

  // ── Indicator toggle ───────────────────────────────────────────────────────
  const toggleIndicator = useCallback((defName: string) => {
    const chart = chartRef.current; if (!chart) return
    const def = INDICATOR_DEFS.find(d => d.name === defName)!

    setActiveInds(prev => {
      const existing = prev.find(a => a.defName === defName)
      if (existing) {
        try {
          if (def.pane === 'main') chart.removeIndicator('candle_pane', defName)
          else chart.removeIndicator(existing.paneId, defName)
        } catch (err) { console.warn('remove error', err) }
        return prev.filter(a => a.defName !== defName)
      } else {
        let paneId: string
        try {
          if (def.pane === 'main') {
            chart.createIndicator(defName, false, { id: 'candle_pane' })
            paneId = 'candle_pane'
            if (def.multiPeriod && def.defaultPeriods) {
              const periods = def.defaultPeriods.map(v => ({ value: v, visible: true }))
              chart.overrideIndicator({ name: defName, calcParams: buildCalcParams(periods) }, 'candle_pane')
              return [...prev, { defName, paneId, visible: true, periods, params: {} }]
            }
          } else {
            paneId = (chart.createIndicator(defName, false, { height: 100 }) ?? `${defName}_pane`) as string
          }
        } catch (err) {
          console.warn('createIndicator error', err)
          paneId = `${defName}_pane`
        }
        return [...prev, { defName, paneId, visible: true, params: { ...def.defaultParams } }]
      }
    })
  }, [])

  // ── Apply settings ─────────────────────────────────────────────────────────
  const applySettings = useCallback((defName: string, periods?: PeriodEntry[], params?: Record<string, number>) => {
    const chart = chartRef.current; if (!chart) return
    const def = INDICATOR_DEFS.find(d => d.name === defName)!
    setActiveInds(prev => prev.map(a => {
      if (a.defName !== defName) return a
      if (def.multiPeriod && periods) {
        const calcParams = buildCalcParams(periods)
        if (calcParams.length > 0) {
          try { chart.overrideIndicator({ name: defName, calcParams }, a.paneId) }
          catch (err) { console.warn(err) }
        }
        return { ...a, periods }
      }
      if (params) {
        try { chart.overrideIndicator({ name: defName, calcParams: Object.values(params) }, a.paneId) }
        catch (err) { console.warn(err) }
        return { ...a, params }
      }
      return a
    }))
  }, [])

  const openSettings = useCallback((defName: string) => {
    setSettingsName(defName); setShowIndP(false)
  }, [])

  // ── Screenshot ─────────────────────────────────────────────────────────────
  const handleScreenshot = useCallback(() => {
    const chart = chartRef.current; if (!chart) return
    try {
      const url = (chart as any).getConvertPictureUrl?.('png', 'transparent')
      if (url) {
        const a = document.createElement('a')
        a.href = url; a.download = `${symbol}_${interval}_${Date.now()}.png`; a.click()
      }
    } catch (err) { console.warn('screenshot', err) }
  }, [symbol, interval])

  // ── Fullscreen ─────────────────────────────────────────────────────────────
  const handleFullscreen = useCallback(() => {
    const el = containerRef.current; if (!el) return
    if (!document.fullscreenElement) {
      el.requestFullscreen().then(() => setIsFullscreen(true)).catch(() => {})
    } else {
      document.exitFullscreen().then(() => setIsFullscreen(false)).catch(() => {})
    }
  }, [])

  useEffect(() => {
    const handler = () => setIsFullscreen(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', handler)
    return () => document.removeEventListener('fullscreenchange', handler)
  }, [])

  // ── Derived ────────────────────────────────────────────────────────────────
  const settingsInd  = settingsName ? activeInds.find(a => a.defName === settingsName) : null
  const settingsDef  = settingsName ? INDICATOR_DEFS.find(d => d.name === settingsName) : null
  const filteredSyms = POPULAR_SYMBOLS.filter(s => s.includes(searchQ.toUpperCase()))
  const pctColor     = (ticker?.priceChangePct ?? 0) >= 0 ? '#26a69a' : '#ef5350'

  // ── Render ─────────────────────────────────────────────────────────────────
  return (
    <div ref={containerRef} style={{ display:'flex', flexDirection:'column', height:'100vh', overflow:'hidden', background:'#131722', color:'#d1d4dc' }}>
      <PageHeader title="K線圖表" />

      {/* ── TOP BAR ─────────────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', gap:0, padding:'0 8px', borderBottom:'1px solid #2b2b43', flexShrink:0, height:40 }}>

        {/* Symbol */}
        <div style={{ position:'relative', marginRight:8 }}>
          <button
            onClick={() => { setShowSymP(v => !v); setShowIndP(false) }}
            style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 10px', background:'transparent', border:'1px solid #2b2b43', borderRadius:4, color:'#d1d4dc', fontSize:13, fontWeight:700, cursor:'pointer' }}
          >
            {symbol} <ChevronDown size={12}/>
          </button>
          {showSymP && (
            <div style={{ position:'absolute', top:'100%', left:0, marginTop:4, zIndex:100, background:'#1e222d', border:'1px solid #2b2b43', borderRadius:6, width:200, boxShadow:'0 8px 24px rgba(0,0,0,.5)' }}>
              <div style={{ padding:'6px 8px', borderBottom:'1px solid #2b2b43', display:'flex', alignItems:'center', gap:6 }}>
                <Search size={12} color="#848e9c"/>
                <input autoFocus value={searchQ} onChange={e => setSearchQ(e.target.value)}
                  placeholder="搜尋..." style={{ background:'transparent', border:'none', outline:'none', color:'#d1d4dc', fontSize:12, width:'100%' }}/>
              </div>
              <div style={{ maxHeight:220, overflowY:'auto' }}>
                {filteredSyms.map(s => (
                  <div key={s}
                    onClick={() => { switchPair(marketType, s, interval); setShowSymP(false); setSearchQ('') }}
                    style={{ padding:'6px 12px', fontSize:12, cursor:'pointer', background: s === symbol ? '#2b2b43' : 'transparent', color: s === symbol ? '#f0b90b' : '#d1d4dc' }}
                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = '#2b2b43' }}
                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = s === symbol ? '#2b2b43' : 'transparent' }}
                  >{s}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Spot / Futures */}
        <div style={{ display:'flex', background:'#1e222d', borderRadius:4, border:'1px solid #2b2b43', overflow:'hidden', marginRight:8 }}>
          {(['spot','futures'] as MarketType[]).map(m => (
            <button key={m} onClick={() => switchPair(m, symbol, interval)}
              style={{ padding:'3px 9px', fontSize:11, cursor:'pointer', border:'none', fontWeight: marketType===m ? 700 : 400, background: marketType===m ? '#f0b90b' : 'transparent', color: marketType===m ? '#000' : '#848e9c' }}
            >{m === 'spot' ? '現貨' : '合約'}</button>
          ))}
        </div>

        {/* Divider */}
        <div style={{ width:1, height:20, background:'#2b2b43', marginRight:8 }}/>

        {/* Interval tabs */}
        <div style={{ display:'flex', alignItems:'center', gap:1 }}>
          {INTERVALS.map(iv => (
            <button key={iv} onClick={() => switchPair(marketType, symbol, iv)}
              style={{
                padding:'3px 7px', fontSize:12, cursor:'pointer', border:'none', borderRadius:3,
                background: interval===iv ? '#f0b90b' : 'transparent',
                color: interval===iv ? '#000' : '#848e9c',
                fontWeight: interval===iv ? 700 : 400,
              }}
              onMouseEnter={e => { if (interval !== iv) (e.currentTarget as HTMLElement).style.color = '#d1d4dc' }}
              onMouseLeave={e => { if (interval !== iv) (e.currentTarget as HTMLElement).style.color = '#848e9c' }}
            >{INTERVAL_LABELS[iv]}</button>
          ))}
        </div>

        <div style={{ flex:1 }}/>

        {/* WS dot */}
        <div style={{ display:'flex', alignItems:'center', gap:4, fontSize:11, color: wsStatus==='live' ? '#26a69a' : '#848e9c', marginRight:10 }}>
          <span style={{ width:6, height:6, borderRadius:'50%', display:'inline-block', backgroundColor: wsStatus==='live' ? '#26a69a' : wsStatus==='connecting' ? '#f0b90b' : '#ef5350' }}/>
          {wsStatus==='live' ? '即時' : wsStatus==='connecting' ? '連線中' : '斷線'}
        </div>

        {/* Refresh */}
        <button onClick={() => switchPair(marketType, symbol, interval)}
          title="重新載入"
          style={{ background:'transparent', border:'none', cursor:'pointer', padding:'4px 6px', display:'flex', alignItems:'center', color:'#848e9c', borderRadius:4 }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#d1d4dc' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#848e9c' }}
        ><RefreshCw size={14} color={loading ? '#f0b90b' : undefined}/></button>

        {/* Indicator button */}
        <div style={{ position:'relative', marginLeft:2 }}>
          <button onClick={() => { setShowIndP(v => !v); setShowSymP(false) }}
            style={{ display:'flex', alignItems:'center', gap:4, padding:'4px 8px', fontSize:12, cursor:'pointer', background: showIndP ? '#2b2b43' : 'transparent', border:'1px solid #2b2b43', borderRadius:4, color:'#d1d4dc', marginLeft:2 }}
          ><BarChart2 size={13}/> 指標</button>
          {showIndP && (
            <IndicatorPanel activeInds={activeInds} onToggle={toggleIndicator} onOpenSettings={openSettings} onClose={() => setShowIndP(false)}/>
          )}
        </div>

        {/* Screenshot */}
        <button onClick={handleScreenshot} title="截圖"
          style={{ background:'transparent', border:'1px solid #2b2b43', cursor:'pointer', padding:'4px 6px', display:'flex', alignItems:'center', color:'#848e9c', borderRadius:4, marginLeft:4 }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#d1d4dc' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#848e9c' }}
        ><Camera size={13}/></button>

        {/* Fullscreen */}
        <button onClick={handleFullscreen} title="全螢幕"
          style={{ background:'transparent', border:'1px solid #2b2b43', cursor:'pointer', padding:'4px 6px', display:'flex', alignItems:'center', color:'#848e9c', borderRadius:4, marginLeft:4 }}
          onMouseEnter={e => { (e.currentTarget as HTMLElement).style.color = '#d1d4dc' }}
          onMouseLeave={e => { (e.currentTarget as HTMLElement).style.color = '#848e9c' }}
        >{isFullscreen ? <Minimize2 size={13}/> : <Maximize2 size={13}/>}</button>
      </div>

      {/* ── PRICE BAR ───────────────────────────────────────────────────── */}
      <div style={{ display:'flex', alignItems:'center', gap:12, padding:'3px 12px', borderBottom:'1px solid #2b2b43', flexShrink:0 }}>
        <div style={{ display:'flex', alignItems:'baseline', gap:8 }}>
          <span style={{ fontSize:22, fontFamily:'monospace', fontWeight:700, color: pctColor }}>
            {price != null ? fmtPrice(price) : '—'}
          </span>
          {ticker && (
            <span style={{ fontSize:12, color: pctColor }}>
              {ticker.priceChange >= 0 ? '+' : ''}{fmtPrice(ticker.priceChange)}{'  '}
              ({ticker.priceChangePct >= 0 ? '+' : ''}{ticker.priceChangePct.toFixed(2)}%)
            </span>
          )}
        </div>
        {ticker && (
          <>
            <div style={{ width:1, height:28, background:'#2b2b43' }}/>
            <div style={{ display:'flex', gap:16, fontSize:11 }}>
              <span style={{ color:'#848e9c' }}>24h高 <span style={{ color:'#26a69a' }}>{fmtPrice(ticker.high24h)}</span></span>
              <span style={{ color:'#848e9c' }}>24h低 <span style={{ color:'#ef5350' }}>{fmtPrice(ticker.low24h)}</span></span>
              <span style={{ color:'#848e9c' }}>24h量 <span style={{ color:'#d1d4dc' }}>{fmtVol(ticker.volume24h)}</span></span>
            </div>
          </>
        )}
      </div>

      {/* ── MAIN AREA: left sidebar + chart ─────────────────────────────── */}
      <div style={{ flex:1, minHeight:0, display:'flex', overflow:'hidden' }}>

        {/* Left drawing toolbar */}
        <div data-sidebar>
          <DrawToolbar activeTool={activeTool} onSelect={handleToolSelect} onClear={handleClearOverlays}/>
        </div>

        {/* Chart container */}
        <div style={{ flex:1, minWidth:0, position:'relative' }}>
          {loading && (
            <div style={{ position:'absolute', inset:0, display:'flex', alignItems:'center', justifyContent:'center', background:'rgba(19,23,34,.7)', zIndex:10 }}>
              <span style={{ color:'#f0b90b', fontSize:13 }}>載入中...</span>
            </div>
          )}
          {error && (
            <div style={{ position:'absolute', top:8, left:'50%', transform:'translateX(-50%)', background:'#2d1a1a', border:'1px solid #ef5350', borderRadius:4, padding:'4px 12px', fontSize:12, color:'#ef5350', zIndex:10 }}>
              {error}
            </div>
          )}
          {activeTool && (
            <div style={{ position:'absolute', top:8, left:'50%', transform:'translateX(-50%)', background:'rgba(240,185,11,.15)', border:'1px solid #f0b90b66', borderRadius:4, padding:'3px 10px', fontSize:11, color:'#f0b90b', zIndex:10, pointerEvents:'none' }}>
              繪圖模式：{DRAW_TOOLS.find(t => t.id === activeTool)?.label} — 點擊圖示再次點擊可取消
            </div>
          )}
          <div id={CHART_ID} style={{ width:'100%', height:'100%' }}/>
        </div>
      </div>

      {/* ── Settings Modal ───────────────────────────────────────────────── */}
      {settingsName && settingsInd && settingsDef && (
        <SettingsModal indicator={settingsInd} def={settingsDef} onClose={() => setSettingsName(null)} onApply={applySettings}/>
      )}

      {/* Click-outside to close dropdowns */}
      {(showSymP || showIndP) && (
        <div style={{ position:'fixed', inset:0, zIndex:49 }} onClick={() => { setShowSymP(false); setShowIndP(false) }}/>
      )}
    </div>
  )
}
