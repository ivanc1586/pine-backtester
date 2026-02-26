/**
 * ChartPage v10
 *
 * Fix vs v9:
 * - IndicatorTag: child span onMouseLeave now calls e.stopPropagation()
 *   so parent's setHov(false) is NOT triggered when mouse moves onto icon buttons.
 *   This means 👁 ⚙ ✕ stay visible while hovering over them.
 * - IndicatorRow gear icon: same fix.
 *
 * Key changes vs v8:
 * 1. MA/EMA now support multiple periods (like Binance/TradingView).
 *    One createIndicator('MA') call with calcParams:[5,10,20,60].
 *    Settings modal shows each period on its own row with toggle + input.
 *
 * 2. Indicator tags in the interval row use KLineChart's native tooltip
 *    (showRule:'always') for the text inside the canvas.
 *    The React IndicatorTag in the toolbar row is REMOVED for main-pane
 *    indicators. Instead we render a thin overlay div on top of the chart
 *    canvas that shows 👁 ⚙ ✕ when the mouse enters the top-left legend area.
 *    This way the controls appear exactly where the KLineChart legend text is.
 *
 * 3. OHLCV row always visible (candle.tooltip.showRule:'always').
 *
 * 4. IndicatorPanel gear icon restored.
 *
 * 5. Sub-pane direction: add → time axis moves DOWN; remove → moves UP.
 */

import { useEffect, useRef, useState, useCallback } from 'react'
import { init, dispose, Chart } from 'klinecharts'
import { Search, X, Settings, BarChart2, RefreshCw, ChevronDown, Eye, EyeOff, Plus, Minus } from 'lucide-react'
import PageHeader from '../components/PageHeader'

// ─────────────────────────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────────────────────────
const INTERVALS = ['1m','3m','5m','15m','30m','1h','2h','4h','6h','12h','1d','1w']
const INTERVAL_LABELS: Record<string,string> = {
  '1m':'1分','3m':'3分','5m':'5分','15m':'15分','30m':'30分',
  '1h':'1時','2h':'2時','4h':'4時','6h':'6時','12h':'12時','1d':'日','1w':'週',
}
const POPULAR_SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT',
  'ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','MATICUSDT',
  'LINKUSDT','UNIUSDT','LTCUSDT','ATOMUSDT','NEARUSDT',
]

// MA/EMA line colours (one per period slot, max 8)
const LINE_COLORS = ['#f0b90b','#2196f3','#e040fb','#00e5ff','#ff5252','#69f0ae','#ff6d00','#40c4ff']

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

// For MA/EMA: periods is an array of {value, visible}
// For BOLL: params = {period, multiplier}
// For sub-pane indicators: params = {shortPeriod?, longPeriod?, signalPeriod?, period?}
interface PeriodEntry { value: number; visible: boolean }

interface ActiveIndicator {
  defName: string
  paneId: string
  // Multi-period indicators (MA, EMA): periods array
  periods?: PeriodEntry[]
  // Single/fixed param indicators (BOLL, MACD, RSI, KDJ): flat params
  params: Record<string, number>
  visible: boolean
}

// ─────────────────────────────────────────────────────────────────────────────
// Indicator catalogue
// ─────────────────────────────────────────────────────────────────────────────
interface IndicatorDef {
  name: string
  label: string
  pane: 'main' | 'sub'
  multiPeriod?: boolean          // true → MA/EMA style (calcParams array)
  defaultPeriods?: number[]      // initial periods for multiPeriod indicators
  defaultParams: Record<string, number>
  paramLabels: Record<string, string>
}

const INDICATOR_DEFS: IndicatorDef[] = [
  {
    name: 'MA', label: 'MA 均線', pane: 'main',
    multiPeriod: true,
    defaultPeriods: [5, 10, 20, 60],
    defaultParams: {},
    paramLabels: {},
  },
  {
    name: 'EMA', label: 'EMA 指數均線', pane: 'main',
    multiPeriod: true,
    defaultPeriods: [5, 10, 20, 60],
    defaultParams: {},
    paramLabels: {},
  },
  {
    name: 'BOLL', label: 'BOLL 布林帶', pane: 'main',
    defaultParams: { period: 20, multiplier: 2 },
    paramLabels: { period: '週期', multiplier: '倍數' },
  },
  {
    name: 'VOL',  label: 'VOL 成交量', pane: 'sub',
    defaultParams: {},
    paramLabels: {},
  },
  {
    name: 'MACD', label: 'MACD', pane: 'sub',
    defaultParams: { shortPeriod: 12, longPeriod: 26, signalPeriod: 9 },
    paramLabels: { shortPeriod: '短期', longPeriod: '長期', signalPeriod: '訊號' },
  },
  {
    name: 'RSI', label: 'RSI', pane: 'sub',
    defaultParams: { period: 14 },
    paramLabels: { period: '週期' },
  },
  {
    name: 'KDJ', label: 'KDJ', pane: 'sub',
    defaultParams: { period: 9, signalPeriod: 3 },
    paramLabels: { period: '週期', signalPeriod: '訊號' },
  },
]

// ─────────────────────────────────────────────────────────────────────────────
// API helpers
// ─────────────────────────────────────────────────────────────────────────────
const SPOT_REST       = 'https://api.binance.com/api/v3/klines'
const FUTURES_REST    = 'https://fapi.binance.com/fapi/v1/klines'
const SPOT_TICKER     = 'https://api.binance.com/api/v3/ticker/24hr'
const FUTURES_TICKER  = 'https://fapi.binance.com/fapi/v1/ticker/24hr'
const SPOT_WS_BASE    = 'wss://stream.binance.com:9443/ws'
const FUTURES_WS_BASE = 'wss://fstream.binance.com/ws'

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
function fmtTs(ts: number): string {
  return new Date(ts).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  })
}
function timeAgo(ts: number): string {
  const s = Math.floor((Date.now() - ts) / 1000)
  if (s < 5)    return '剛剛'
  if (s < 60)   return `${s} 秒前`
  if (s < 3600) return `${Math.floor(s / 60)} 分前`
  return `${Math.floor(s / 3600)} 時前`
}

// Build calcParams array from PeriodEntry[]
function buildCalcParams(periods: PeriodEntry[]): number[] {
  return periods.filter(p => p.visible).map(p => p.value)
}

// Build label string shown in interval row, e.g. "MA(5,10,20,60)"
function mainIndLabel(ind: ActiveIndicator): string {
  if (ind.periods) {
    const vis = ind.periods.filter(p => p.visible).map(p => p.value)
    return vis.length ? `${ind.defName}(${vis.join(',')})` : ind.defName
  }
  const vals = Object.values(ind.params)
  return vals.length ? `${ind.defName}(${vals.join(',')})` : ind.defName
}

// ─────────────────────────────────────────────────────────────────────────────
// IndicatorTag — shown in the interval toolbar row (above chart).
// Plain text always visible. 👁 ⚙ ✕ only appear on hover.
// The controls appear to the RIGHT of the label text, no background.
// ─────────────────────────────────────────────────────────────────────────────
function IndicatorTag({
  label, visible, onToggleVisible, onSettings, onRemove,
}: {
  label: string; visible: boolean
  onToggleVisible: () => void; onSettings: () => void; onRemove: () => void
}) {
  const [hov, setHov] = useState(false)
  return (
    <span
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 2,
        fontSize: 11, lineHeight: '18px',
        color: visible ? '#848e9c' : '#444',
        cursor: 'default', userSelect: 'none',
        padding: '0 3px', borderRadius: 3,
        background: hov ? 'rgba(255,255,255,0.04)' : 'transparent',
      }}
    >
      <span style={{ fontWeight: 500 }}>{label}</span>

      {hov && (
        <>
          <span
            role="button" title={visible ? '隱藏' : '顯示'}
            onClick={e => { e.stopPropagation(); onToggleVisible() }}
            onMouseLeave={e => e.stopPropagation()}
            style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', color: '#848e9c', padding: '0 1px' }}
            onMouseEnter={e => { e.stopPropagation(); (e.currentTarget as HTMLElement).style.color = '#d1d4dc' }}
          >
            {visible ? <Eye size={10} /> : <EyeOff size={10} />}
          </span>
          <span
            role="button" title="設定"
            onClick={e => { e.stopPropagation(); onSettings() }}
            onMouseLeave={e => e.stopPropagation()}
            style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', color: '#848e9c', padding: '0 1px' }}
            onMouseEnter={e => { e.stopPropagation(); (e.currentTarget as HTMLElement).style.color = '#d1d4dc' }}
          >
            <Settings size={10} />
          </span>
          <span
            role="button" title="移除"
            onClick={e => { e.stopPropagation(); onRemove() }}
            onMouseLeave={e => e.stopPropagation()}
            style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', color: '#848e9c', padding: '0 1px' }}
            onMouseEnter={e => { e.stopPropagation(); (e.currentTarget as HTMLElement).style.color = '#ef5350' }}
          >
            <X size={10} />
          </span>
        </>
      )}
    </span>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Settings Modal
//
// For multi-period indicators (MA/EMA):
//   Shows a list of periods. Each row: colour swatch | toggle checkbox | period input.
//   User can add/remove period rows (up to 8).
//
// For other indicators (BOLL/MACD/RSI/KDJ/VOL):
//   Shows flat key-value inputs as before.
// ─────────────────────────────────────────────────────────────────────────────
function SettingsModal({ indicator, def, onClose, onApply }: {
  indicator: ActiveIndicator
  def: IndicatorDef
  onClose: () => void
  onApply: (defName: string, periods?: PeriodEntry[], params?: Record<string, number>) => void
}) {
  const [periods, setPeriods] = useState<PeriodEntry[]>(
    indicator.periods ? [...indicator.periods] : []
  )
  const [params, setParams] = useState({ ...indicator.params })

  const togglePeriod = (i: number) =>
    setPeriods(prev => prev.map((p, idx) => idx === i ? { ...p, visible: !p.visible } : p))

  const setPeriodValue = (i: number, v: number) =>
    setPeriods(prev => prev.map((p, idx) => idx === i ? { ...p, value: v } : p))

  const addPeriod = () => {
    if (periods.length >= 8) return
    const last = periods[periods.length - 1]?.value ?? 20
    setPeriods(prev => [...prev, { value: last + 10, visible: true }])
  }

  const removePeriod = (i: number) => {
    if (periods.length <= 1) return
    setPeriods(prev => prev.filter((_, idx) => idx !== i))
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, zIndex: 200, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(0,0,0,.6)' }}
      onClick={onClose}
    >
      <div
        style={{ background: '#1e222d', border: '1px solid #2b2b43', borderRadius: 8, padding: 0, width: 300, boxShadow: '0 8px 32px rgba(0,0,0,.6)', overflow: 'hidden' }}
        onClick={e => e.stopPropagation()}
      >
        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '10px 14px', borderBottom: '1px solid #2b2b43' }}>
          <span style={{ fontWeight: 700, color: '#fff', fontSize: 13 }}>{def.label}</span>
          <span role="button" onClick={onClose} style={{ cursor: 'pointer', color: '#848e9c', display: 'flex' }}><X size={15} /></span>
        </div>

        <div style={{ padding: '12px 14px' }}>
          {/* ── Multi-period mode (MA / EMA) ── */}
          {def.multiPeriod && periods.length > 0 && (
            <>
              <div style={{ fontSize: 10, color: '#848e9c', letterSpacing: 1, marginBottom: 8, textTransform: 'uppercase' }}>均線週期</div>
              {periods.map((p, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 8 }}>
                  {/* Colour swatch */}
                  <div style={{ width: 12, height: 12, borderRadius: 2, background: LINE_COLORS[i % LINE_COLORS.length], flexShrink: 0 }} />

                  {/* Toggle visibility */}
                  <span
                    role="button"
                    onClick={() => togglePeriod(i)}
                    title={p.visible ? '隱藏此均線' : '顯示此均線'}
                    style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', color: p.visible ? '#d1d4dc' : '#444', flexShrink: 0 }}
                  >
                    {p.visible ? <Eye size={13} /> : <EyeOff size={13} />}
                  </span>

                  {/* Label */}
                  <span style={{ fontSize: 12, color: p.visible ? '#d1d4dc' : '#555', flex: 1 }}>
                    MA{p.value}
                  </span>

                  {/* Period input */}
                  <input
                    type="number" min={1} max={999} value={p.value}
                    onChange={e => setPeriodValue(i, Math.max(1, +e.target.value))}
                    style={{
                      width: 64, background: '#131722', border: '1px solid #2b2b43',
                      borderRadius: 4, padding: '3px 8px', fontSize: 12, color: '#fff',
                      textAlign: 'right', outline: 'none',
                    }}
                  />

                  {/* Remove row */}
                  <span
                    role="button"
                    onClick={() => removePeriod(i)}
                    title="移除此週期"
                    style={{ display: 'flex', alignItems: 'center', cursor: periods.length > 1 ? 'pointer' : 'not-allowed', color: periods.length > 1 ? '#848e9c' : '#333', flexShrink: 0 }}
                    onMouseEnter={e => { if (periods.length > 1) (e.currentTarget as HTMLElement).style.color = '#ef5350' }}
                    onMouseLeave={e => { if (periods.length > 1) (e.currentTarget as HTMLElement).style.color = '#848e9c' }}
                  >
                    <Minus size={13} />
                  </span>
                </div>
              ))}

              {/* Add period row */}
              {periods.length < 8 && (
                <div
                  role="button"
                  onClick={addPeriod}
                  style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 0', cursor: 'pointer', color: '#848e9c', fontSize: 12 }}
                  onMouseEnter={e => ((e.currentTarget as HTMLElement).style.color = '#d1d4dc')}
                  onMouseLeave={e => ((e.currentTarget as HTMLElement).style.color = '#848e9c')}
                >
                  <Plus size={13} /> 新增均線
                </div>
              )}
            </>
          )}

          {/* ── Flat params mode (BOLL / MACD / RSI / KDJ) ── */}
          {!def.multiPeriod && (
            Object.keys(params).length === 0
              ? <p style={{ color: '#848e9c', fontSize: 13, textAlign: 'center', padding: '8px 0' }}>此指標無可調參數</p>
              : Object.keys(params).map(k => (
                <div key={k} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                  <label style={{ fontSize: 13, color: '#d1d4dc' }}>{def.paramLabels[k] ?? k}</label>
                  <input
                    type="number" value={params[k]}
                    onChange={e => setParams(p => ({ ...p, [k]: +e.target.value }))}
                    style={{ width: 90, background: '#131722', border: '1px solid #2b2b43', borderRadius: 4, padding: '4px 8px', fontSize: 13, color: '#fff', textAlign: 'right', outline: 'none' }}
                  />
                </div>
              ))
          )}
        </div>

        {/* Footer */}
        <div style={{ display: 'flex', gap: 8, padding: '8px 14px 14px' }}>
          <button
            onClick={onClose}
            style={{ flex: 1, padding: '6px 0', borderRadius: 4, fontSize: 13, border: '1px solid #2b2b43', background: 'transparent', color: '#d1d4dc', cursor: 'pointer' }}
          >
            取消
          </button>
          <button
            onClick={() => {
              onApply(indicator.defName, def.multiPeriod ? periods : undefined, def.multiPeriod ? undefined : params)
              onClose()
            }}
            style={{ flex: 1, padding: '6px 0', borderRadius: 4, fontSize: 13, fontWeight: 700, border: 'none', background: '#f0b90b', color: '#000', cursor: 'pointer' }}
          >
            套用
          </button>
        </div>
      </div>
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Indicator Row (inside the dropdown panel)
// ─────────────────────────────────────────────────────────────────────────────
function IndicatorRow({ def, isOn, onToggle, onSettings }: {
  def: IndicatorDef; isOn: boolean; onToggle: () => void; onSettings: () => void
}) {
  const [hov, setHov] = useState(false)
  return (
    <div
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '6px 12px', cursor: 'pointer', background: hov ? '#2b2b43' : 'transparent' }}
    >
      <div
        onClick={onToggle}
        style={{
          width: 14, height: 14, borderRadius: 3, flexShrink: 0,
          border: `1px solid ${isOn ? '#f0b90b' : '#555'}`,
          background: isOn ? '#f0b90b' : 'transparent',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
        }}
      >
        {isOn && <span style={{ fontSize: 9, fontWeight: 900, color: '#000', lineHeight: 1 }}>✓</span>}
      </div>

      <span onClick={onToggle} style={{ fontSize: 12, color: '#d1d4dc', flex: 1 }}>{def.label}</span>

      {isOn && hov && (
        <span
          role="button"
          onClick={e => { e.stopPropagation(); onSettings() }}
          title="設定"
          style={{ display: 'flex', alignItems: 'center', cursor: 'pointer', color: '#848e9c', padding: 1, flexShrink: 0 }}
          onMouseEnter={e => { e.stopPropagation(); (e.currentTarget as HTMLElement).style.color = '#d1d4dc' }}
          onMouseLeave={e => { e.stopPropagation(); (e.currentTarget as HTMLElement).style.color = '#848e9c' }}
        >
          <Settings size={12} />
        </span>
      )}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Indicator Dropdown Panel
// ─────────────────────────────────────────────────────────────────────────────
function IndicatorPanel({
  activeInds, onToggle, onOpenSettings, onClose,
}: {
  activeInds: ActiveIndicator[]
  onToggle: (defName: string) => void
  onOpenSettings: (defName: string) => void
  onClose: () => void
}) {
  const activeNames = new Set(activeInds.map(a => a.defName))
  return (
    <div style={{
      position: 'absolute', top: '100%', right: 0, marginTop: 4, zIndex: 100,
      width: 230, background: '#1e222d', border: '1px solid #2b2b43',
      borderRadius: 8, boxShadow: '0 8px 24px rgba(0,0,0,.5)', overflow: 'hidden',
    }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '8px 12px', borderBottom: '1px solid #2b2b43' }}>
        <span style={{ fontSize: 12, fontWeight: 700, color: '#d1d4dc' }}>技術指標</span>
        <span role="button" onClick={onClose} style={{ cursor: 'pointer', color: '#848e9c', display: 'flex' }}><X size={13} /></span>
      </div>

      <div style={{ padding: '4px 12px 2px', fontSize: 10, color: '#848e9c', fontWeight: 600, letterSpacing: 1, marginTop: 4 }}>主圖</div>
      {INDICATOR_DEFS.filter(d => d.pane === 'main').map(def => (
        <IndicatorRow
          key={def.name} def={def}
          isOn={activeNames.has(def.name)}
          onToggle={() => onToggle(def.name)}
          onSettings={() => onOpenSettings(def.name)}
        />
      ))}

      <div style={{ padding: '6px 12px 2px', fontSize: 10, color: '#848e9c', fontWeight: 600, letterSpacing: 1, borderTop: '1px solid #1e2328', marginTop: 4 }}>副圖</div>
      {INDICATOR_DEFS.filter(d => d.pane === 'sub').map(def => (
        <IndicatorRow
          key={def.name} def={def}
          isOn={activeNames.has(def.name)}
          onToggle={() => onToggle(def.name)}
          onSettings={() => onOpenSettings(def.name)}
        />
      ))}
    </div>
  )
}

// ─────────────────────────────────────────────────────────────────────────────
// Main Component
// ─────────────────────────────────────────────────────────────────────────────
export default function ChartPage() {
  const CHART_ID = 'kline-chart'
  const chartRef = useRef<Chart | null>(null)
  const wsRef    = useRef<WebSocket | null>(null)
  const rcRef    = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickRef  = useRef<ReturnType<typeof setInterval> | null>(null)

  const symRef = useRef(getSaved('chart_symbol', 'BTCUSDT'))
  const ivRef  = useRef(getSaved('chart_interval', '1h'))
  const mtRef  = useRef<MarketType>(getSaved('chart_market', 'futures') as MarketType)

  const [symbol,     setSym]    = useState(symRef.current)
  const [interval,   setIv]     = useState(ivRef.current)
  const [marketType, setMt]     = useState<MarketType>(mtRef.current)
  const [loading,    setLoading] = useState(false)
  const [error,      setError]   = useState<string | null>(null)
  const [wsStatus,   setWsSt]    = useState<'connecting' | 'live' | 'disconnected'>('disconnected')

  const [price,  setPrice]  = useState<number | null>(null)
  const [ticker, setTicker] = useState<TickerInfo | null>(null)
  const [barTs,  setBarTs]  = useState<number | null>(null)
  const [lastTs, setLastTs] = useState(0)
  const [agoStr, setAgoStr] = useState('')

  const [searchQ,  setSearchQ]  = useState('')
  const [showSymP, setShowSymP] = useState(false)
  const [showIndP, setShowIndP] = useState(false)

  const [activeInds,   setActiveInds]   = useState<ActiveIndicator[]>([])
  const [settingsName, setSettingsName] = useState<string | null>(null)

  // ── Chart init ──────────────────────────────────────────────────────────
  useEffect(() => {
    const chart = init(CHART_ID, {
      layout: [
        { type: 'candle', options: { gap: { bottom: 2 } } },
        { type: 'xAxis' },
      ],
      styles: {
        grid: { horizontal: { color: '#1e2328' }, vertical: { color: '#1e2328' } },
        candle: {
          bar: { upColor: '#26a69a', downColor: '#ef5350', noChangeColor: '#888' },
          tooltip: {
            // OHLCV always shown in top-left of candle pane
            showRule: 'always',
            showType: 'standard',
            labels: ['時間', '開', '高', '低', '收', '量'],
            text: { size: 11, color: '#848e9c' },
          },
        },
        indicator: {
          ohlc: { upColor: '#26a69a', downColor: '#ef5350' },
          tooltip: {
            // Indicator name+values always shown in each pane top-left
            showRule: 'always',
            showType: 'standard',
            text: { size: 11, color: '#848e9c' },
          },
        },
        xAxis:     { tickText: { color: '#848e9c', size: 11 }, axisLine: { color: '#2b2b43' } },
        yAxis:     { tickText: { color: '#848e9c', size: 11 }, axisLine: { color: '#2b2b43' } },
        crosshair: {
          horizontal: { line: { color: '#444' }, text: { color: '#fff', backgroundColor: '#2b2b43' } },
          vertical:   { line: { color: '#444' }, text: { color: '#fff', backgroundColor: '#2b2b43' } },
        },
        background: '#131722',
      },
      locale: 'zh-TW',
      timezone: 'Asia/Taipei',
    })
    if (!chart) return
    chartRef.current = chart

    // Default: MA with 4 periods on main pane
    const defaultPeriods: PeriodEntry[] = [5, 10, 20, 60].map(v => ({ value: v, visible: true }))
    chart.createIndicator('MA', false, { id: 'candle_pane' })
    // Apply multi-period calcParams
    chart.overrideIndicator({
      name: 'MA',
      calcParams: buildCalcParams(defaultPeriods),
    }, 'candle_pane')
    setActiveInds([{
      defName: 'MA',
      paneId: 'candle_pane',
      visible: true,
      periods: defaultPeriods,
      params: {},
    }])

    return () => { dispose(CHART_ID) }
  }, [])

  // ── Load klines ──────────────────────────────────────────────────────────
  const loadData = useCallback(async (mt: MarketType, sym: string, iv: string) => {
    const chart = chartRef.current; if (!chart) return
    setLoading(true); setError(null)
    try {
      const [klines, tk] = await Promise.all([fetchKlines(mt, sym, iv, 1500), fetchTicker(mt, sym)])
      chart.applyNewData(klines)
      setTicker(tk)
      if (klines.length) setPrice(klines[klines.length - 1].close)
    } catch (e: any) { setError(e.message) }
    finally { setLoading(false) }
  }, [])

  // ── WebSocket ─────────────────────────────────────────────────────────────
  const connectWS = useCallback((mt: MarketType, sym: string, iv: string) => {
    if (wsRef.current) { wsRef.current.close(); wsRef.current = null }
    const base = mt === 'futures' ? FUTURES_WS_BASE : SPOT_WS_BASE
    const ws = new WebSocket(`${base}/${sym.toLowerCase()}@kline_${iv}`)
    wsRef.current = ws; setWsSt('connecting')
    ws.onopen  = () => setWsSt('live')
    ws.onclose = () => {
      setWsSt('disconnected')
      rcRef.current = setTimeout(() => connectWS(mtRef.current, symRef.current, ivRef.current), 3000)
    }
    ws.onerror = () => ws.close()
    ws.onmessage = e => {
      const { k } = JSON.parse(e.data)
      chartRef.current?.updateData({ timestamp: k.t, open: +k.o, high: +k.h, low: +k.l, close: +k.c, volume: +k.v, turnover: +k.q })
      setPrice(+k.c); setBarTs(k.t); setLastTs(Date.now())
    }
  }, [])

  // ── "X ago" ticker ─────────────────────────────────────────────────────────
  useEffect(() => {
    tickRef.current = setInterval(() => { if (lastTs) setAgoStr(timeAgo(lastTs)) }, 1000)
    return () => { if (tickRef.current) clearInterval(tickRef.current) }
  }, [lastTs])

  // ── Switch symbol / interval ───────────────────────────────────────────────
  const switchPair = useCallback((mt: MarketType, sym: string, iv: string) => {
    symRef.current = sym; ivRef.current = iv; mtRef.current = mt
    localStorage.setItem('chart_symbol', sym)
    localStorage.setItem('chart_interval', iv)
    localStorage.setItem('chart_market', mt)
    setSym(sym); setIv(iv); setMt(mt)
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

  // ── Toggle indicator ───────────────────────────────────────────────────────
  const toggleIndicator = useCallback((defName: string) => {
    const chart = chartRef.current; if (!chart) return
    const def = INDICATOR_DEFS.find(d => d.name === defName)!

    setActiveInds(prev => {
      const existing = prev.find(a => a.defName === defName)
      if (existing) {
        // Remove
        try {
          if (def.pane === 'main') {
            chart.removeIndicator('candle_pane', defName)
          } else {
            chart.removePane(existing.paneId)
          }
        } catch (err) { console.warn('remove error', err) }
        return prev.filter(a => a.defName !== defName)
      } else {
        // Add
        let paneId: string
        try {
          if (def.pane === 'main') {
            paneId = (chart.createIndicator(defName, false, { id: 'candle_pane' }) ?? 'candle_pane') as string
            // For multi-period indicators apply calcParams immediately
            if (def.multiPeriod && def.defaultPeriods) {
              const defaultPeriods = def.defaultPeriods.map(v => ({ value: v, visible: true }))
              chart.overrideIndicator({
                name: defName,
                calcParams: buildCalcParams(defaultPeriods),
              }, 'candle_pane')
              return [...prev, { defName, paneId: 'candle_pane', visible: true, periods: defaultPeriods, params: {} }]
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
  const applySettings = useCallback((
    defName: string,
    periods?: PeriodEntry[],
    params?: Record<string, number>,
  ) => {
    const chart = chartRef.current; if (!chart) return
    const def = INDICATOR_DEFS.find(d => d.name === defName)!

    setActiveInds(prev => prev.map(a => {
      if (a.defName !== defName) return a

      if (def.multiPeriod && periods) {
        // Update calcParams (only visible periods are calculated)
        const calcParams = buildCalcParams(periods)
        if (calcParams.length > 0) {
          try {
            chart.overrideIndicator({ name: defName, calcParams }, a.paneId)
          } catch (err) { console.warn('overrideIndicator error', err) }
        }
        return { ...a, periods }
      }

      if (params) {
        const calcParams = Object.values(params)
        try {
          chart.overrideIndicator({ name: defName, calcParams }, a.paneId)
        } catch (err) { console.warn('overrideIndicator error', err) }
        return { ...a, params }
      }

      return a
    }))
  }, [])

  // ── Toggle visibility ──────────────────────────────────────────────────────
  const toggleVisibility = useCallback((defName: string) => {
    const chart = chartRef.current; if (!chart) return
    setActiveInds(prev => prev.map(a => {
      if (a.defName !== defName) return a
      const next = !a.visible
      try {
        chart.overrideIndicator({ name: defName, visible: next }, a.paneId)
      } catch (err) { console.warn('toggleVisibility error', err) }
      return { ...a, visible: next }
    }))
  }, [])

  // ── Open settings ──────────────────────────────────────────────────────────
  const openSettings = useCallback((defName: string) => {
    setSettingsName(defName)
    setShowIndP(false)
  }, [])

  // ── Derived ────────────────────────────────────────────────────────────────
  const settingsInd  = settingsName ? activeInds.find(a => a.defName === settingsName) : null
  const settingsDef  = settingsName ? INDICATOR_DEFS.find(d => d.name === settingsName) : null
  const filteredSyms = POPULAR_SYMBOLS.filter(s => s.includes(searchQ.toUpperCase()))
  const pctColor     = (ticker?.priceChangePct ?? 0) >= 0 ? '#26a69a' : '#ef5350'

  // Only main-pane indicators show React tags in the interval row
  const mainInds = activeInds.filter(a => INDICATOR_DEFS.find(d => d.name === a.defName)?.pane === 'main')

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────
  return (
    <div style={{ display: 'flex', flexDirection: 'column', height: '100vh', overflow: 'hidden', background: '#131722', color: '#d1d4dc' }}>
      <PageHeader title="K線圖表" />

      {/* ── ROW 1: Toolbar ──────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, padding: '4px 10px', borderBottom: '1px solid #2b2b43', flexShrink: 0 }}>

        {/* Symbol picker */}
        <div style={{ position: 'relative' }}>
          <button
            onClick={() => { setShowSymP(v => !v); setShowIndP(false) }}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '3px 8px', background: '#1e222d', border: '1px solid #2b2b43', borderRadius: 4, color: '#d1d4dc', fontSize: 13, fontWeight: 700, cursor: 'pointer' }}
          >
            {symbol} <ChevronDown size={13} />
          </button>
          {showSymP && (
            <div style={{ position: 'absolute', top: '100%', left: 0, marginTop: 4, zIndex: 100, background: '#1e222d', border: '1px solid #2b2b43', borderRadius: 6, width: 200, boxShadow: '0 8px 24px rgba(0,0,0,.5)' }}>
              <div style={{ padding: '6px 8px', borderBottom: '1px solid #2b2b43', display: 'flex', alignItems: 'center', gap: 6 }}>
                <Search size={13} color="#848e9c" />
                <input
                  autoFocus value={searchQ} onChange={e => setSearchQ(e.target.value)}
                  placeholder="搜尋..." style={{ background: 'transparent', border: 'none', outline: 'none', color: '#d1d4dc', fontSize: 12, width: '100%' }}
                />
              </div>
              <div style={{ maxHeight: 200, overflowY: 'auto' }}>
                {filteredSyms.map(s => (
                  <div
                    key={s}
                    onClick={() => { switchPair(marketType, s, interval); setShowSymP(false); setSearchQ('') }}
                    style={{ padding: '6px 12px', fontSize: 12, cursor: 'pointer', background: s === symbol ? '#2b2b43' : 'transparent', color: s === symbol ? '#f0b90b' : '#d1d4dc' }}
                    onMouseEnter={e => (e.currentTarget.style.background = '#2b2b43')}
                    onMouseLeave={e => (e.currentTarget.style.background = s === symbol ? '#2b2b43' : 'transparent')}
                  >
                    {s}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Spot / Futures toggle */}
        <div style={{ display: 'flex', background: '#1e222d', borderRadius: 4, border: '1px solid #2b2b43', overflow: 'hidden' }}>
          {(['spot', 'futures'] as MarketType[]).map(m => (
            <button
              key={m} onClick={() => switchPair(m, symbol, interval)}
              style={{ padding: '3px 9px', fontSize: 11, cursor: 'pointer', border: 'none', fontWeight: marketType === m ? 700 : 400, background: marketType === m ? '#f0b90b' : 'transparent', color: marketType === m ? '#000' : '#848e9c' }}
            >
              {m === 'spot' ? '現貨' : '合約'}
            </button>
          ))}
        </div>

        <div style={{ flex: 1 }} />

        {/* WS status */}
        <div style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 11, color: wsStatus === 'live' ? '#26a69a' : '#848e9c' }}>
          <span style={{
            width: 6, height: 6, borderRadius: '50%', display: 'inline-block',
            backgroundColor: wsStatus === 'live' ? '#26a69a' : wsStatus === 'connecting' ? '#f0b90b' : '#ef5350',
          }} />
          {wsStatus === 'live' ? '即時' : wsStatus === 'connecting' ? '連線中' : '斷線'}
        </div>

        {/* Refresh */}
        <button
          onClick={() => switchPair(marketType, symbol, interval)}
          style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: 3, display: 'flex', alignItems: 'center' }}
        >
          <RefreshCw size={14} color={loading ? '#f0b90b' : '#848e9c'} />
        </button>
      </div>

      {/* ── ROW 2: Price bar ────────────────────────────────────────────── */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '3px 12px', borderBottom: '1px solid #2b2b43', flexShrink: 0 }}>
        <div style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
          <span style={{ fontSize: 22, fontFamily: 'monospace', fontWeight: 700, color: pctColor }}>
            {price != null ? fmtPrice(price) : '—'}
          </span>
          {ticker && (
            <span style={{ fontSize: 12, color: pctColor }}>
              {ticker.priceChange >= 0 ? '+' : ''}{fmtPrice(ticker.priceChange)}{'  '}
              ({ticker.priceChangePct >= 0 ? '+' : ''}{ticker.priceChangePct.toFixed(2)}%)
            </span>
          )}
        </div>
        <div style={{ width: 1, height: 28, background: '#2b2b43' }} />
        <div style={{ display: 'flex', gap: 16, fontSize: 11 }}>
          {ticker ? (
            <>
              <div style={{ color: '#848e9c' }}>24h高 <span style={{ color: '#d1d4dc' }}>{fmtPrice(ticker.high24h)}</span></div>
              <div style={{ color: '#848e9c' }}>24h低 <span style={{ color: '#d1d4dc' }}>{fmtPrice(ticker.low24h)}</span></div>
              <div style={{ color: '#848e9c' }}>24h量 <span style={{ color: '#d1d4dc' }}>{fmtVol(ticker.volume24h)}</span></div>
            </>
          ) : (
            <div style={{ color: '#444' }}>載入中...</div>
          )}
        </div>
        <div style={{ flex: 1 }} />
        <div style={{ fontSize: 11, color: '#848e9c', textAlign: 'right' }}>
          {barTs && <span style={{ color: '#d1d4dc' }}>{fmtTs(barTs)}</span>}
          {' '}({INTERVAL_LABELS[interval]})
          {agoStr && <span style={{ marginLeft: 8 }}>更新 {agoStr}</span>}
        </div>
      </div>

      {/* ── ROW 3: Interval + indicator tags + indicator button ────────── */}
      {/*
          Layout: [1分][3分]...[週] | [MA(5,10,20,60) ← hover→👁⚙✕] [EMA...] | spacer | [指標▼]

          The IndicatorTag shows PLAIN GREY TEXT always. The 👁 ⚙ ✕ icons only
          appear when the mouse is hovering over that specific tag element.

          NOTE: The KLineChart canvas ALSO renders the indicator legend (MA5, MA10…)
          inside the top-left of the candle pane via indicator.tooltip.showRule:'always'.
          Those native canvas labels show values on crosshair hover. The React tag
          in this toolbar row is a separate, complementary control strip.
      */}
      <div style={{ display: 'flex', alignItems: 'center', padding: '2px 8px', borderBottom: '1px solid #2b2b43', flexShrink: 0, gap: 2, minHeight: 28, flexWrap: 'nowrap', overflowX: 'auto' }}>

        {/* Interval buttons */}
        {INTERVALS.map(iv => {
          const active = iv === interval
          return (
            <button
              key={iv} onClick={() => switchPair(marketType, symbol, iv)}
              style={{
                padding: '2px 7px', fontSize: 11, borderRadius: 3, border: 'none', cursor: 'pointer',
                fontWeight: active ? 700 : 400,
                background: active ? '#f0b90b' : 'transparent',
                color: active ? '#000' : '#848e9c',
                flexShrink: 0,
              }}
            >
              {INTERVAL_LABELS[iv]}
            </button>
          )
        })}

        {/* Divider before indicator tags */}
        {mainInds.length > 0 && (
          <div style={{ width: 1, height: 14, background: '#2b2b43', margin: '0 4px', flexShrink: 0 }} />
        )}

        {/* Main-pane indicator tags */}
        {mainInds.map(ind => (
          <IndicatorTag
            key={ind.defName}
            label={mainIndLabel(ind)}
            visible={ind.visible}
            onToggleVisible={() => toggleVisibility(ind.defName)}
            onSettings={() => openSettings(ind.defName)}
            onRemove={() => toggleIndicator(ind.defName)}
          />
        ))}

        <div style={{ flex: 1 }} />

        {/* Indicator panel button */}
        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button
            onClick={() => { setShowIndP(v => !v); setShowSymP(false) }}
            style={{ display: 'flex', alignItems: 'center', gap: 4, padding: '2px 8px', fontSize: 11, cursor: 'pointer', background: showIndP ? '#2b2b43' : 'transparent', border: '1px solid #2b2b43', borderRadius: 4, color: '#d1d4dc' }}
          >
            <BarChart2 size={13} /> 指標
          </button>
          {showIndP && (
            <IndicatorPanel
              activeInds={activeInds}
              onToggle={toggleIndicator}
              onOpenSettings={openSettings}
              onClose={() => setShowIndP(false)}
            />
          )}
        </div>
      </div>

      {/* ── ROW 4: Chart canvas ─────────────────────────────────────────── */}
      <div style={{ flex: 1, minHeight: 0, position: 'relative' }}>
        {loading && (
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'rgba(19,23,34,.7)', zIndex: 10 }}>
            <span style={{ color: '#f0b90b', fontSize: 13 }}>載入中...</span>
          </div>
        )}
        {error && (
          <div style={{ position: 'absolute', top: 8, left: '50%', transform: 'translateX(-50%)', background: '#2d1a1a', border: '1px solid #ef5350', borderRadius: 4, padding: '4px 12px', fontSize: 12, color: '#ef5350', zIndex: 10 }}>
            {error}
          </div>
        )}
        <div id={CHART_ID} style={{ width: '100%', height: '100%' }} />
      </div>

      {/* ── Settings Modal ──────────────────────────────────────────────── */}
      {settingsName && settingsInd && settingsDef && (
        <SettingsModal
          indicator={settingsInd}
          def={settingsDef}
          onClose={() => setSettingsName(null)}
          onApply={applySettings}
        />
      )}

      {/* Click-outside to close dropdowns */}
      {(showSymP || showIndP) && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 49 }} onClick={() => { setShowSymP(false); setShowIndP(false) }} />
      )}
    </div>
  )
}
