// =============================================================================
// 修改歷程記錄
// -----------------------------------------------------------------------------
// v2.0.0 - 2026-02-26 - 策略優化頁面（全新重寫）
//   - 頁面標題改為「策略優化」
//   - 新增 Pine Script 貼入區塊，支援 AI 自動解析 input 參數
//   - 動態參數偵測 UI：自動顯示參數列表，可勾選/設定優化範圍
//   - Gemini AI 轉譯 + Optuna 優化後端串接
//   - 前 10 名結果列表：顯示總盈虧、MDD、盈虧比、勝率等
//   - 點擊結果連動：Lightweight Charts 顯示對應回測圖表
//   - 每月績效柱狀圖
//   - 一鍵複製優化代碼功能
// =============================================================================

import { useState, useRef, useEffect, useCallback } from 'react'
import {
  Play, Sparkles, ChevronDown, ChevronUp, Settings2,
  Copy, Check, TrendingUp, TrendingDown, BarChart2,
  Zap, AlertCircle, RefreshCw, Target
} from 'lucide-react'
import PageHeader from '../components/PageHeader'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface DetectedParam {
  name: string
  title: string
  type: 'int' | 'float' | 'bool' | 'string'
  default: number | boolean | string
  min_val?: number
  max_val?: number
  step?: number
}

interface ParamRange {
  name: string
  title: string
  enabled: boolean
  min_val: number
  max_val: number
  step: number
  is_int: boolean
  default_val: number
}

interface OptimizeResult {
  rank: number
  params: Record<string, number>
  total_trades: number
  win_rate: number
  profit_pct: number
  profit_factor: number
  max_drawdown: number
  sharpe_ratio: number
  final_equity: number
  gross_profit: number
  gross_loss: number
  monthly_pnl: Record<string, number>
  trades: Trade[]
  equity_curve: number[]
}

interface Trade {
  entry_time: string
  exit_time: string
  entry_price: number
  exit_price: number
  side: 'long' | 'short'
  pnl: number
  pnl_pct: number
}

const SORT_OPTIONS = [
  { value: 'profit_pct', label: '最大盈利 %' },
  { value: 'win_rate', label: '最高勝率' },
  { value: 'profit_factor', label: '最高盈虧比' },
  { value: 'max_drawdown', label: '最低 MDD' },
  { value: 'sharpe_ratio', label: '最高夏普比率' },
  { value: 'total_trades', label: '最多交易筆數' },
]

const INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d', '1w']
const SOURCES = ['binance', 'coingecko', 'coincap']
const POPULAR_SYMBOLS = [
  'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT',
  'ADAUSDT', 'DOGEUSDT', 'AVAXUSDT', 'DOTUSDT', 'MATICUSDT'
]

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

function MetricBadge({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <div className={`text-center px-3 py-2 rounded-lg ${highlight ? 'bg-emerald-500/20' : 'bg-white/5'}`}>
      <div className={`text-xs font-medium ${highlight ? 'text-emerald-400' : 'text-gray-400'}`}>{label}</div>
      <div className={`text-sm font-bold mt-0.5 ${highlight ? 'text-emerald-300' : 'text-white'}`}>{value}</div>
    </div>
  )
}

function MonthlyBarChart({ data }: { data: Record<string, number> }) {
  const entries = Object.entries(data).sort(([a], [b]) => a.localeCompare(b))
  if (!entries.length) return null

  const vals = entries.map(([, v]) => v)
  const maxAbs = Math.max(...vals.map(Math.abs), 1)

  return (
    <div className="mt-4">
      <div className="text-xs text-gray-400 mb-2 font-medium">每月績效</div>
      <div className="flex items-end gap-1 h-24 overflow-x-auto pb-1">
        {entries.map(([month, pnl]) => {
          const pct = (pnl / maxAbs) * 100
          const isPos = pnl >= 0
          return (
            <div key={month} className="flex flex-col items-center min-w-[32px]">
              <div className="relative w-full flex items-end justify-center" style={{ height: '64px' }}>
                <div
                  className={`w-6 rounded-sm transition-all ${isPos ? 'bg-emerald-500' : 'bg-rose-500'}`}
                  style={{ height: `${Math.max(4, Math.abs(pct) * 0.64)}px` }}
                  title={`${month}: ${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}`}
                />
              </div>
              <div className="text-gray-500 mt-1" style={{ fontSize: '9px' }}>
                {month.slice(5)}
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Main Component
// ---------------------------------------------------------------------------

export default function OptimizePage() {
  // Pine Script
  const [pineScript, setPineScript] = useState('')
  const [isParsing, setIsParsing] = useState(false)
  const [detectedParams, setDetectedParams] = useState<DetectedParam[]>([])
  const [paramRanges, setParamRanges] = useState<ParamRange[]>([])
  const [parseError, setParseError] = useState('')

  // Market settings
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setIntervalVal] = useState('1h')
  const [source, setSource] = useState('binance')
  const [startDate, setStartDate] = useState('2023-01-01')
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0])
  const [initialCapital, setInitialCapital] = useState(10000)
  const [commission, setCommission] = useState(0.001)
  const [quantity, setQuantity] = useState(1)
  const [sortBy, setSortBy] = useState('profit_pct')
  const [nTrials, setNTrials] = useState(100)

  // Optimization state
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [progressText, setProgressText] = useState('')
  const [results, setResults] = useState<OptimizeResult[]>([])
  const [selectedResult, setSelectedResult] = useState<OptimizeResult | null>(null)
  const [copiedCode, setCopiedCode] = useState(false)
  const [errorMsg, setErrorMsg] = useState('')

  // UI state
  const [showSettings, setShowSettings] = useState(true)
  const [showScript, setShowScript] = useState(true)

  // Chart refs
  const equityChartRef = useRef<HTMLDivElement>(null)
  const equityChartApi = useRef<any>(null)
  const equitySeriesRef = useRef<any>(null)

  // ---------------------------------------------------------------------------
  // Parse Pine Script inputs
  // ---------------------------------------------------------------------------

  const parsePineScript = useCallback(async () => {
    if (!pineScript.trim()) {
      setParseError('請先貼入 Pine Script 代碼')
      return
    }

    setIsParsing(true)
    setParseError('')

    try {
      const res = await fetch('/api/optimize/parse', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pine_script: pineScript }),
      })

      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()

      setDetectedParams(data.params)

      // Build param ranges from detected params (only int/float)
      const ranges: ParamRange[] = data.params
        .filter((p: DetectedParam) => p.type === 'int' || p.type === 'float')
        .map((p: DetectedParam) => {
          const defVal = typeof p.default === 'number' ? p.default : 1
          return {
            name: p.name,
            title: p.title,
            enabled: true,
            min_val: p.min_val ?? Math.max(1, Math.floor(defVal * 0.5)),
            max_val: p.max_val ?? Math.ceil(defVal * 2),
            step: p.step ?? (p.type === 'int' ? 1 : 0.1),
            is_int: p.type === 'int',
            default_val: defVal,
          }
        })

      setParamRanges(ranges)

      if (data.params.length === 0) {
        setParseError('未偵測到任何 input 參數，請確認 Pine Script 包含 input.int / input.float 等宣告')
      }
    } catch (err: any) {
      setParseError(`解析失敗：${err.message}`)
    } finally {
      setIsParsing(false)
    }
  }, [pineScript])

  // ---------------------------------------------------------------------------
  // Update param range
  // ---------------------------------------------------------------------------

  const updateRange = (name: string, field: keyof ParamRange, value: any) => {
    setParamRanges(prev => prev.map(p => p.name === name ? { ...p, [field]: value } : p))
  }

  // ---------------------------------------------------------------------------
  // Run optimization
  // ---------------------------------------------------------------------------

  const runOptimization = async () => {
    if (!pineScript.trim()) {
      setErrorMsg('請先貼入 Pine Script 代碼並解析參數')
      return
    }

    const enabledRanges = paramRanges.filter(p => p.enabled)
    if (enabledRanges.length === 0) {
      setErrorMsg('請至少勾選一個參數進行優化')
      return
    }

    setIsRunning(true)
    setProgress(0)
    setProgressText('正在初始化...')
    setResults([])
    setSelectedResult(null)
    setErrorMsg('')

    try {
      const res = await fetch('/api/optimize/run', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          pine_script: pineScript,
          symbol, interval, source,
          start_date: startDate,
          end_date: endDate,
          initial_capital: initialCapital,
          commission,
          quantity,
          param_ranges: enabledRanges.map(p => ({
            name: p.name,
            min_val: p.min_val,
            max_val: p.max_val,
            step: p.step,
            is_int: p.is_int,
          })),
          sort_by: sortBy,
          n_trials: nTrials,
          top_n: 10,
        }),
      })

      if (!res.ok) {
        const err = await res.json()
        throw new Error(err.detail || '優化請求失敗')
      }

      const reader = res.body?.getReader()
      if (!reader) throw new Error('無法讀取串流回應')

      const decoder = new TextDecoder()
      let buffer = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break

        buffer += decoder.decode(value, { stream: true })
        const lines = buffer.split('\n')
        buffer = lines.pop() || ''

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const payload = line.slice(6).trim()
          if (!payload) continue

          try {
            const data = JSON.parse(payload)
            if (data.type === 'progress') {
              setProgress(data.progress)
              setProgressText(`已完成 ${data.completed} / ${data.total} 次試驗`)
            } else if (data.type === 'result') {
              setResults(data.results)
              setProgress(100)
              setProgressText(`優化完成！共 ${data.results.length} 個最佳組合`)
            } else if (data.type === 'error') {
              throw new Error(data.message)
            }
          } catch (parseErr) {
            // ignore malformed SSE lines
          }
        }
      }
    } catch (err: any) {
      setErrorMsg(`優化失敗：${err.message}`)
    } finally {
      setIsRunning(false)
    }
  }

  // ---------------------------------------------------------------------------
  // Equity curve chart
  // ---------------------------------------------------------------------------

  useEffect(() => {
    if (!equityChartRef.current) return

    if (equityChartApi.current) {
      equityChartApi.current.remove()
      equityChartApi.current = null
    }

    const resizeObserver = new ResizeObserver(() => {
      if (equityChartRef.current && equityChartApi.current) {
        equityChartApi.current.applyOptions({ width: equityChartRef.current.clientWidth })
      }
    })
    resizeObserver.observe(equityChartRef.current)
    return () => { resizeObserver.disconnect() }
  }, [])

  useEffect(() => {
    if (!selectedResult || !equitySeriesRef.current) return
    const eq = selectedResult.equity_curve
    if (!eq || eq.length === 0) return

    const chartData = eq.map((val, i) => ({
      time: Math.floor(Date.now() / 1000) - (eq.length - i) * 3600,
      value: val,
    }))
    equitySeriesRef.current.setData(chartData as any)
    equityChartApi.current?.timeScale().fitContent()
  }, [selectedResult])

  // ---------------------------------------------------------------------------
  // Copy optimized code
  // ---------------------------------------------------------------------------

  const copyOptimizedCode = useCallback(() => {
    if (!selectedResult) return
    let code = pineScript
    Object.entries(selectedResult.params).forEach(([name, val]) => {
      // Replace input.int/float default value for this param
      const pattern = new RegExp(`(${name}\\s*=\\s*input\\.(?:int|float)\\s*\\()[^)]*\\)`, 'g')
      code = code.replace(pattern, (match) => {
        return match.replace(/defval\s*=\s*[\d.]+|^(\s*\()[\d.]+/, (m) => {
          if (m.includes('defval')) return `defval = ${val}`
          return m.replace(/[\d.]+/, String(val))
        })
      })
    })
    navigator.clipboard.writeText(code).then(() => {
      setCopiedCode(true)
      setTimeout(() => setCopiedCode(false), 2500)
    })
  }, [selectedResult, pineScript])

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-slate-900 p-4 md:p-8">
      <PageHeader
        title="策略優化"
        subtitle="AI 自動解析 Pine Script 參數，Optuna 智能搜尋最佳組合"
        icon={<Target className="w-8 h-8" />}
      />

      <div className="max-w-7xl mx-auto mt-6 space-y-5">

        {/* ── Pine Script Input ── */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 overflow-hidden">
          <button
            onClick={() => setShowScript(!showScript)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Zap className="w-5 h-5 text-yellow-400" />
              <span className="text-white font-medium">貼入 Pine Script</span>
              {detectedParams.length > 0 && (
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400">
                  已偵測 {detectedParams.filter(p => p.type === 'int' || p.type === 'float').length} 個可優化參數
                </span>
              )}
            </div>
            {showScript ? <ChevronUp className="w-5 h-5 text-white" /> : <ChevronDown className="w-5 h-5 text-white" />}
          </button>

          {showScript && (
            <div className="p-6 border-t border-white/10 space-y-4">
              <textarea
                value={pineScript}
                onChange={(e) => { setPineScript(e.target.value); setDetectedParams([]); setParamRanges([]) }}
                placeholder={`//@version=5\nstrategy("My Strategy", overlay=true)\nfastLength = input.int(9, title="Fast EMA", minval=2, maxval=50)\nslowLength = input.int(21, title="Slow EMA", minval=5, maxval=100)\n// ... 策略邏輯`}
                className="w-full h-48 px-4 py-3 bg-black/30 border border-white/10 rounded-xl text-green-300 font-mono text-sm focus:ring-2 focus:ring-purple-500 focus:border-transparent resize-y placeholder-gray-600"
              />

              {parseError && (
                <div className="flex items-center gap-2 text-rose-400 text-sm">
                  <AlertCircle className="w-4 h-4 flex-shrink-0" />
                  {parseError}
                </div>
              )}

              <button
                onClick={parsePineScript}
                disabled={isParsing || !pineScript.trim()}
                className="flex items-center gap-2 px-5 py-2.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl font-medium transition-colors"
              >
                {isParsing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Sparkles className="w-4 h-4" />}
                {isParsing ? '解析中...' : 'AI 自動解析參數'}
              </button>
            </div>
          )}
        </div>

        {/* ── Detected Params ── */}
        {paramRanges.length > 0 && (
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 p-6">
            <h3 className="text-white font-semibold mb-4 flex items-center gap-2">
              <Settings2 className="w-5 h-5 text-purple-400" />
              參數優化設定
              <span className="text-xs text-gray-400 font-normal">（勾選要優化的參數並設定範圍）</span>
            </h3>

            <div className="space-y-3">
              {paramRanges.map((p) => (
                <div key={p.name} className={`p-4 rounded-xl border transition-colors ${p.enabled ? 'bg-purple-500/10 border-purple-500/30' : 'bg-white/5 border-white/10'}`}>
                  <div className="flex items-center gap-3 mb-3">
                    <input
                      type="checkbox"
                      checked={p.enabled}
                      onChange={(e) => updateRange(p.name, 'enabled', e.target.checked)}
                      className="w-4 h-4 rounded accent-purple-500"
                    />
                    <div>
                      <span className="text-white font-medium">{p.title}</span>
                      <span className="text-gray-500 text-xs ml-2">({p.name})</span>
                    </div>
                    <span className="ml-auto text-xs px-2 py-0.5 rounded-full bg-white/10 text-gray-300">
                      預設: {p.default_val}
                    </span>
                  </div>

                  {p.enabled && (
                    <div className="grid grid-cols-3 gap-3 mt-2">
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">最小值</label>
                        <input
                          type="number"
                          value={p.min_val}
                          step={p.is_int ? 1 : 0.01}
                          onChange={(e) => updateRange(p.name, 'min_val', parseFloat(e.target.value))}
                          className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-white text-sm focus:ring-1 focus:ring-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">最大值</label>
                        <input
                          type="number"
                          value={p.max_val}
                          step={p.is_int ? 1 : 0.01}
                          onChange={(e) => updateRange(p.name, 'max_val', parseFloat(e.target.value))}
                          className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-white text-sm focus:ring-1 focus:ring-purple-500"
                        />
                      </div>
                      <div>
                        <label className="block text-xs text-gray-400 mb-1">步長</label>
                        <input
                          type="number"
                          value={p.step}
                          step={p.is_int ? 1 : 0.01}
                          min={p.is_int ? 1 : 0.01}
                          onChange={(e) => updateRange(p.name, 'step', parseFloat(e.target.value))}
                          className="w-full px-3 py-2 bg-black/30 border border-white/10 rounded-lg text-white text-sm focus:ring-1 focus:ring-purple-500"
                        />
                      </div>
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Market & Optimize Settings ── */}
        <div className="bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 overflow-hidden">
          <button
            onClick={() => setShowSettings(!showSettings)}
            className="w-full px-6 py-4 flex items-center justify-between hover:bg-white/5 transition-colors"
          >
            <div className="flex items-center gap-3">
              <Settings2 className="w-5 h-5 text-purple-400" />
              <span className="text-white font-medium">市場與優化設定</span>
            </div>
            {showSettings ? <ChevronUp className="w-5 h-5 text-white" /> : <ChevronDown className="w-5 h-5 text-white" />}
          </button>

          {showSettings && (
            <div className="p-6 border-t border-white/10 space-y-5">
              {/* Symbol / Interval / Source */}
              <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">交易對</label>
                  <select value={symbol} onChange={(e) => setSymbol(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:ring-2 focus:ring-purple-500">
                    {POPULAR_SYMBOLS.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">時間框架</label>
                  <select value={interval} onChange={(e) => setIntervalVal(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:ring-2 focus:ring-purple-500">
                    {INTERVALS.map(i => <option key={i} value={i}>{i}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">資料來源</label>
                  <select value={source} onChange={(e) => setSource(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:ring-2 focus:ring-purple-500">
                    {SOURCES.map(s => <option key={s} value={s}>{s}</option>)}
                  </select>
                </div>
              </div>

              {/* Date range */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">開始日期</label>
                  <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:ring-2 focus:ring-purple-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">結束日期</label>
                  <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:ring-2 focus:ring-purple-500" />
                </div>
              </div>

              {/* Capital / Commission / Quantity */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">初始資金</label>
                  <input type="number" value={initialCapital} min={100} onChange={(e) => setInitialCapital(Number(e.target.value))}
                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:ring-2 focus:ring-purple-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">手續費率</label>
                  <input type="number" value={commission} step={0.0001} min={0} onChange={(e) => setCommission(Number(e.target.value))}
                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:ring-2 focus:ring-purple-500" />
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">倉位數量</label>
                  <input type="number" value={quantity} min={0.01} step={0.01} onChange={(e) => setQuantity(Number(e.target.value))}
                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:ring-2 focus:ring-purple-500" />
                </div>
              </div>

              {/* Sort / Trials */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">優化目標</label>
                  <select value={sortBy} onChange={(e) => setSortBy(e.target.value)}
                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:ring-2 focus:ring-purple-500">
                    {SORT_OPTIONS.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-gray-400 mb-1.5">試驗次數 (Trials)</label>
                  <input type="number" value={nTrials} min={10} max={2000} step={10} onChange={(e) => setNTrials(Number(e.target.value))}
                    className="w-full px-3 py-2.5 bg-white/5 border border-white/10 rounded-xl text-white focus:ring-2 focus:ring-purple-500" />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* ── Run Button ── */}
        {errorMsg && (
          <div className="flex items-center gap-2 px-4 py-3 bg-rose-500/10 border border-rose-500/20 rounded-xl text-rose-400 text-sm">
            <AlertCircle className="w-4 h-4 flex-shrink-0" />
            {errorMsg}
          </div>
        )}

        <button
          onClick={runOptimization}
          disabled={isRunning}
          className="w-full py-4 bg-gradient-to-r from-purple-600 to-violet-600 hover:from-purple-700 hover:to-violet-700 disabled:opacity-50 text-white rounded-2xl font-semibold text-lg flex items-center justify-center gap-3 transition-all shadow-lg shadow-purple-900/30"
        >
          {isRunning ? (
            <>
              <RefreshCw className="w-5 h-5 animate-spin" />
              優化中... {progress}%
            </>
          ) : (
            <>
              <Play className="w-5 h-5" />
              開始策略優化
            </>
          )}
        </button>

        {/* ── Progress Bar ── */}
        {isRunning && (
          <div className="space-y-2">
            <div className="w-full bg-white/10 rounded-full h-2 overflow-hidden">
              <div
                className="h-full bg-gradient-to-r from-purple-500 to-violet-500 transition-all duration-300 rounded-full"
                style={{ width: `${progress}%` }}
              />
            </div>
            <p className="text-center text-sm text-gray-400">{progressText}</p>
          </div>
        )}

        {/* ── Results Table ── */}
        {results.length > 0 && (
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 overflow-hidden">
            <div className="px-6 py-4 border-b border-white/10 flex items-center justify-between">
              <h3 className="text-white font-semibold flex items-center gap-2">
                <BarChart2 className="w-5 h-5 text-purple-400" />
                前 {results.length} 名最佳參數組合
              </h3>
              <span className="text-xs text-gray-400">點擊任一列查看詳細圖表</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-white/10">
                    <th className="px-4 py-3 text-left text-gray-400 font-medium">排名</th>
                    <th className="px-4 py-3 text-left text-gray-400 font-medium">參數</th>
                    <th className="px-4 py-3 text-right text-gray-400 font-medium">總盈利%</th>
                    <th className="px-4 py-3 text-right text-gray-400 font-medium">MDD%</th>
                    <th className="px-4 py-3 text-right text-gray-400 font-medium">盈虧比</th>
                    <th className="px-4 py-3 text-right text-gray-400 font-medium">勝率%</th>
                    <th className="px-4 py-3 text-right text-gray-400 font-medium">交易數</th>
                    <th className="px-4 py-3 text-right text-gray-400 font-medium">夏普</th>
                  </tr>
                </thead>
                <tbody>
                  {results.map((r) => {
                    const isSelected = selectedResult?.rank === r.rank
                    return (
                      <tr
                        key={r.rank}
                        onClick={() => setSelectedResult(r)}
                        className={`border-b border-white/5 cursor-pointer transition-colors ${
                          isSelected ? 'bg-purple-500/20' : 'hover:bg-white/5'
                        }`}
                      >
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center justify-center w-7 h-7 rounded-full text-xs font-bold ${
                            r.rank === 1 ? 'bg-yellow-500 text-black' :
                            r.rank === 2 ? 'bg-gray-400 text-black' :
                            r.rank === 3 ? 'bg-amber-700 text-white' :
                            'bg-white/10 text-gray-300'
                          }`}>{r.rank}</span>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex flex-wrap gap-1">
                            {Object.entries(r.params).filter(([k]) => !k.startsWith('_') && k !== 'quantity').map(([k, v]) => (
                              <span key={k} className="text-xs px-2 py-0.5 rounded-md bg-white/10 text-gray-300">
                                {k}: {typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(3)) : v}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className={`px-4 py-3 text-right font-semibold ${r.profit_pct >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          {r.profit_pct >= 0 ? '+' : ''}{r.profit_pct.toFixed(2)}%
                        </td>
                        <td className="px-4 py-3 text-right text-rose-400">{r.max_drawdown.toFixed(2)}%</td>
                        <td className="px-4 py-3 text-right text-white">{r.profit_factor.toFixed(2)}</td>
                        <td className="px-4 py-3 text-right text-white">{r.win_rate.toFixed(1)}%</td>
                        <td className="px-4 py-3 text-right text-gray-300">{r.total_trades}</td>
                        <td className="px-4 py-3 text-right text-gray-300">{r.sharpe_ratio.toFixed(2)}</td>
                      </tr>
                    )
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* ── Selected Result Detail ── */}
        {selectedResult && (
          <div className="bg-white/10 backdrop-blur-lg rounded-2xl border border-white/20 p-6 space-y-5">
            <div className="flex items-center justify-between">
              <h3 className="text-white font-semibold flex items-center gap-2">
                <TrendingUp className="w-5 h-5 text-purple-400" />
                第 {selectedResult.rank} 名詳細分析
              </h3>
              <button
                onClick={copyOptimizedCode}
                className="flex items-center gap-2 px-4 py-2 bg-emerald-500/20 hover:bg-emerald-500/30 border border-emerald-500/30 rounded-xl text-emerald-400 text-sm font-medium transition-colors"
              >
                {copiedCode ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
                {copiedCode ? '已複製！' : '一鍵複製優化代碼'}
              </button>
            </div>

            {/* Metrics grid */}
            <div className="grid grid-cols-4 md:grid-cols-8 gap-2">
              <MetricBadge label="總盈利" value={`${selectedResult.profit_pct >= 0 ? '+' : ''}${selectedResult.profit_pct.toFixed(2)}%`} highlight={selectedResult.profit_pct > 0} />
              <MetricBadge label="最終資產" value={`$${selectedResult.final_equity.toFixed(0)}`} />
              <MetricBadge label="MDD" value={`${selectedResult.max_drawdown.toFixed(2)}%`} />
              <MetricBadge label="盈虧比" value={selectedResult.profit_factor.toFixed(2)} highlight={selectedResult.profit_factor > 1.5} />
              <MetricBadge label="勝率" value={`${selectedResult.win_rate.toFixed(1)}%`} highlight={selectedResult.win_rate > 50} />
              <MetricBadge label="交易數" value={String(selectedResult.total_trades)} />
              <MetricBadge label="夏普" value={selectedResult.sharpe_ratio.toFixed(2)} highlight={selectedResult.sharpe_ratio > 1} />
              <MetricBadge label="毛利/毛損" value={`${selectedResult.gross_profit.toFixed(0)}/${selectedResult.gross_loss.toFixed(0)}`} />
            </div>

            {/* Equity curve */}
            <div>
              <div className="text-xs text-gray-400 mb-2 font-medium">資產曲線</div>
              <div ref={equityChartRef} className="w-full rounded-xl overflow-hidden" />
            </div>

            {/* Monthly PnL */}
            <MonthlyBarChart data={selectedResult.monthly_pnl} />

            {/* Optimized params */}
            <div>
              <div className="text-xs text-gray-400 mb-2 font-medium">最佳參數值</div>
              <div className="flex flex-wrap gap-2">
                {Object.entries(selectedResult.params)
                  .filter(([k]) => !k.startsWith('_') && k !== 'quantity')
                  .map(([k, v]) => (
                    <div key={k} className="px-3 py-2 bg-purple-500/20 border border-purple-500/30 rounded-lg">
                      <span className="text-gray-400 text-xs">{k}: </span>
                      <span className="text-white font-semibold text-sm">
                        {typeof v === 'number' ? (Number.isInteger(v) ? v : v.toFixed(4)) : String(v)}
                      </span>
                    </div>
                  ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
