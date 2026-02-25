import { useState, useEffect } from 'react'
import { Play, Sparkles, Plus, Trash2, ChevronDown, ChevronUp, Settings2 } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import LoadingSpinner from '../components/LoadingSpinner'
import { useStrategyStore } from '../store/strategyStore'
import { backtestApi } from '../services/api'

interface ParamRange {
  id: string
  name: string
  min_val: number
  max_val: number
  step: number
}

const SORT_OPTIONS = [
  { value: 'profit_pct', label: '最大盈利 %' },
  { value: 'win_rate', label: '最高勝率' },
  { value: 'profit_factor', label: '最高盈虧比' },
  { value: 'max_drawdown', label: '最低 MDD' },
  { value: 'total_trades', label: '最多交易筆數' },
]

const INTERVALS = ['1m','5m','15m','30m','1h','4h','1d','1w']
const SOURCES = ['binance','coingecko','coincap']

const POPULAR_SYMBOLS = [
  'BTCUSDT','ETHUSDT','BNBUSDT','SOLUSDT','XRPUSDT','ADAUSDT','DOGEUSDT','AVAXUSDT','DOTUSDT','MATICUSDT'
]

const AI_PRESETS: Record<string, ParamRange[]> = {
  'EMA Cross': [
    { id: '1', name: 'fastLength', min_val: 5, max_val: 20, step: 1 },
    { id: '2', name: 'slowLength', min_val: 15, max_val: 50, step: 5 },
  ],
  'RSI': [
    { id: '1', name: 'rsiLength', min_val: 7, max_val: 21, step: 7 },
    { id: '2', name: 'overbought', min_val: 65, max_val: 80, step: 5 },
    { id: '3', name: 'oversold', min_val: 20, max_val: 35, step: 5 },
  ],
  'MACD': [
    { id: '1', name: 'fastLength', min_val: 8, max_val: 16, step: 4 },
    { id: '2', name: 'slowLength', min_val: 20, max_val: 32, step: 4 },
    { id: '3', name: 'signalLength', min_val: 7, max_val: 11, step: 2 },
  ],
  'Bollinger Bands': [
    { id: '1', name: 'length', min_val: 10, max_val: 30, step: 5 },
    { id: '2', name: 'mult', min_val: 1.5, max_val: 3.0, step: 0.5 },
  ],
}

export default function OptimizePage() {
  const { strategies, fetchStrategies, setOptimizeResults } = useStrategyStore()
  const [selectedStrategyId, setSelectedStrategyId] = useState('')
  const [symbol, setSymbol] = useState('BTCUSDT')
  const [interval, setIntervalVal] = useState('1h')
  const [source, setSource] = useState('binance')
  const [startDate, setStartDate] = useState('2023-01-01')
  const [endDate, setEndDate] = useState(new Date().toISOString().split('T')[0])
  const [initialCapital, setInitialCapital] = useState(10000)
  const [commission, setCommission] = useState(0.001)
  const [quantity, setQuantity] = useState(1)
  const [sortBy, setSortBy] = useState('profit_pct')
  const [maxCombinations, setMaxCombinations] = useState(200)
  const [params, setParams] = useState<ParamRange[]>([
    { id: '1', name: 'fastLength', min_val: 5, max_val: 20, step: 1 },
    { id: '2', name: 'slowLength', min_val: 15, max_val: 50, step: 5 },
  ])
  const [isRunning, setIsRunning] = useState(false)
  const [progress, setProgress] = useState(0)
  const [showAiMenu, setShowAiMenu] = useState(false)
  const [resultCount, setResultCount] = useState<number | null>(null)
  const [error, setError] = useState('')

  useEffect(() => { fetchStrategies() }, [])
  useEffect(() => {
    if (strategies.length > 0 && !selectedStrategyId) {
      setSelectedStrategyId(strategies[0].id)
    }
  }, [strategies])

  const addParam = () => {
    const id = Date.now().toString()
    setParams(prev => [...prev, { id, name: 'newParam', min_val: 1, max_val: 10, step: 1 }])
  }

  const removeParam = (id: string) => setParams(prev => prev.filter(p => p.id !== id))

  const updateParam = (id: string, field: keyof ParamRange, value: string | number) => {
    setParams(prev => prev.map(p => p.id === id ? { ...p, [field]: field === 'name' ? value : Number(value) } : p))
  }

  const applyAiPreset = (presetName: string) => {
    setParams(AI_PRESETS[presetName].map((p, i) => ({ ...p, id: String(i + 1) })))
    setShowAiMenu(false)
  }

  const estimateCombinations = () => {
    return params.reduce((total, p) => {
      const count = Math.floor((p.max_val - p.min_val) / p.step) + 1
      return total * count
    }, 1)
  }

  const handleRun = async () => {
    if (!selectedStrategyId) { setError('請選擇策略'); return }
    if (params.length === 0) { setError('請至少設定一個參數範圍'); return }
    setError('')
    setIsRunning(true)
    setProgress(0)
    setResultCount(null)

    const ticker = setInterval(() => {
      setProgress(prev => Math.min(prev + Math.random() * 8, 90))
    }, 500)

    try {
      const res = await backtestApi.optimize({
        strategy_id: selectedStrategyId,
        symbol, interval,
        start_date: startDate,
        end_date: endDate,
        initial_capital: initialCapital,
        commission,
        quantity,
        data_source: source,
        params: params.map(p => ({ name: p.name, min_val: p.min_val, max_val: p.max_val, step: p.step })),
        max_combinations: maxCombinations,
        sort_by: sortBy,
      })
      setProgress(100)
      const results = res.data.results || []
      setOptimizeResults(results)
      setResultCount(results.length)
    } catch (e: any) {
      setError(e.response?.data?.detail || e.message || '優化失敗')
    } finally {
      clearInterval(ticker)
      setIsRunning(false)
    }
  }

  const estimated = estimateCombinations()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="參數優化"
        subtitle="設定參數範圍，自動尋找最佳策略組合"
        actions={
          <button
            onClick={handleRun}
            disabled={isRunning || !selectedStrategyId}
            className="flex items-center gap-2 btn-success px-4 py-2 text-sm"
          >
            {isRunning ? <LoadingSpinner size={16} /> : <Play size={16} />}
            {isRunning ? '優化中...' : '開始優化'}
          </button>
        }
      />

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {error && (
          <div className="bg-[#ef5350]/10 border border-[#ef5350]/30 rounded-lg px-4 py-3 text-[#ef5350] text-sm">
            {error}
          </div>
        )}

        {isRunning && (
          <div className="card">
            <div className="flex items-center justify-between mb-2">
              <span className="text-[#787b86] text-sm">優化進度</span>
              <span className="text-white text-sm font-mono">{Math.round(progress)}%</span>
            </div>
            <div className="h-2 bg-[#2a2e39] rounded-full overflow-hidden">
              <div className="h-full bg-[#2196f3] rounded-full transition-all duration-300" style={{ width: `${progress}%` }} />
            </div>
            <p className="text-[#787b86] text-xs mt-2">正在測試參數組合，請稍候...</p>
          </div>
        )}

        {resultCount !== null && !isRunning && (
          <div className="bg-[#26a69a]/10 border border-[#26a69a]/30 rounded-lg px-4 py-3 flex items-center justify-between">
            <span className="text-[#26a69a] text-sm font-medium">優化完成！找到 {resultCount} 個結果</span>
            <a href="/results" className="text-[#2196f3] text-sm hover:underline">查看結果 →</a>
          </div>
        )}

        <div className="card space-y-4">
          <h2 className="text-white font-semibold text-sm flex items-center gap-2">
            <Settings2 size={16} className="text-[#2196f3]" /> 基本設定
          </h2>
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
            <div>
              <label className="block text-xs text-[#787b86] mb-1.5">選擇策略</label>
              <select value={selectedStrategyId} onChange={e => setSelectedStrategyId(e.target.value)} className="select-field w-full">
                {strategies.length === 0 && <option value="">-- 無策略，請先新增 --</option>}
                {strategies.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#787b86] mb-1.5">交易對</label>
              <input list="symbols-list" value={symbol} onChange={e => setSymbol(e.target.value.toUpperCase())} className="input-field" placeholder="BTCUSDT" />
              <datalist id="symbols-list">{POPULAR_SYMBOLS.map(s => <option key={s} value={s} />)}</datalist>
            </div>
            <div>
              <label className="block text-xs text-[#787b86] mb-1.5">時間週期</label>
              <select value={interval} onChange={e => setIntervalVal(e.target.value)} className="select-field w-full">
                {INTERVALS.map(iv => <option key={iv} value={iv}>{iv}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs text-[#787b86] mb-1.5">開始日期</label>
              <input type="date" value={startDate} onChange={e => setStartDate(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="block text-xs text-[#787b86] mb-1.5">結束日期</label>
              <input type="date" value={endDate} onChange={e => setEndDate(e.target.value)} className="input-field" />
            </div>
            <div>
              <label className="block text-xs text-[#787b86] mb-1.5">數據來源</label>
              <select value={source} onChange={e => setSource(e.target.value)} className="select-field w-full">
                {SOURCES.map(s => <option key={s} value={s}>{s.charAt(0).toUpperCase() + s.slice(1)}</option>)}
              </select>
            </div>
          </div>
        </div>

        <div className="card space-y-4">
          <h2 className="text-white font-semibold text-sm">交易設定</h2>
          <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
            <div>
              <label className="block text-xs text-[#787b86] mb-1.5">初始資金 (USD)</label>
              <input type="number" value={initialCapital} onChange={e => setInitialCapital(Number(e.target.value))} className="input-field" min={100} />
            </div>
            <div>
              <label className="block text-xs text-[#787b86] mb-1.5">手續費率</label>
              <input type="number" value={commission} onChange={e => setCommission(Number(e.target.value))} className="input-field" min={0} max={0.1} step={0.0001} />
            </div>
            <div>
              <label className="block text-xs text-[#787b86] mb-1.5">下單口數</label>
              <input type="number" value={quantity} onChange={e => setQuantity(Number(e.target.value))} className="input-field" min={0.001} step={0.001} />
            </div>
            <div>
              <label className="block text-xs text-[#787b86] mb-1.5">最大組合數</label>
              <input type="number" value={maxCombinations} onChange={e => setMaxCombinations(Number(e.target.value))} className="input-field" min={10} max={2000} />
            </div>
          </div>
        </div>

        <div className="card space-y-3">
          <h2 className="text-white font-semibold text-sm">回測結果排序</h2>
          <div className="flex flex-wrap gap-2">
            {SORT_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => setSortBy(opt.value)}
                className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition-all ${
                  sortBy === opt.value
                    ? 'bg-[#2196f3]/15 border-[#2196f3]/40 text-[#2196f3]'
                    : 'bg-[#131722] border-[#2a2e39] text-[#787b86] hover:text-white hover:border-[#363a45]'
                }`}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </div>

        <div className="card space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-white font-semibold text-sm">參數範圍設定</h2>
              <p className="text-[#787b86] text-xs mt-0.5">
                預估組合數：<span className={estimated > maxCombinations ? 'text-[#ef5350]' : 'text-[#26a69a]'}>{estimated.toLocaleString()}</span>
                {estimated > maxCombinations && <span className="text-[#ef5350]"> (將隨機抽樣 {maxCombinations} 組)</span>}
              </p>
            </div>
            <div className="flex gap-2">
              <div className="relative">
                <button onClick={() => setShowAiMenu(!showAiMenu)} className="flex items-center gap-1.5 px-3 py-1.5 bg-gradient-to-r from-[#7c3aed]/20 to-[#2196f3]/20 border border-[#7c3aed]/30 rounded-lg text-xs text-[#a78bfa] hover:border-[#7c3aed]/60 transition-colors">
                  <Sparkles size={13} /> AI 快速設定
                </button>
                {showAiMenu && (
                  <div className="absolute right-0 top-full mt-1 bg-[#1e2328] border border-[#2a2e39] rounded-lg shadow-xl z-50 min-w-[160px]">
                    <div className="px-3 py-1.5 border-b border-[#2a2e39]"><span className="text-[#787b86] text-xs">選擇策略類型</span></div>
                    {Object.keys(AI_PRESETS).map(name => (
                      <button key={name} onClick={() => applyAiPreset(name)} className="w-full text-left px-3 py-2 text-sm text-[#d1d4dc] hover:bg-[#2a2e39] transition-colors">{name}</button>
                    ))}
                  </div>
                )}
              </div>
              <button onClick={addParam} className="flex items-center gap-1 px-3 py-1.5 bg-[#2a2e39] hover:bg-[#363a45] rounded-lg text-xs text-[#d1d4dc] transition-colors">
                <Plus size={13} /> 新增參數
              </button>
            </div>
          </div>

          {params.length === 0 ? (
            <div className="text-center py-8 text-[#787b86] text-sm">尚未設定參數範圍，點擊「新增參數」或使用「AI 快速設定」</div>
          ) : (
            <div className="space-y-2">
              <div className="grid grid-cols-12 gap-2 px-2 text-xs text-[#787b86] font-medium">
                <div className="col-span-3">參數名稱</div>
                <div className="col-span-3">最小值</div>
                <div className="col-span-3">最大值</div>
                <div className="col-span-2">步長</div>
                <div className="col-span-1"></div>
              </div>
              {params.map(p => (
                <div key={p.id} className="grid grid-cols-12 gap-2 items-center bg-[#131722] rounded-lg p-2 border border-[#2a2e39]">
                  <div className="col-span-3"><input value={p.name} onChange={e => updateParam(p.id, 'name', e.target.value)} className="input-field py-1.5 text-xs font-mono" /></div>
                  <div className="col-span-3"><input type="number" value={p.min_val} onChange={e => updateParam(p.id, 'min_val', e.target.value)} className="input-field py-1.5 text-xs" /></div>
                  <div className="col-span-3"><input type="number" value={p.max_val} onChange={e => updateParam(p.id, 'max_val', e.target.value)} className="input-field py-1.5 text-xs" /></div>
                  <div className="col-span-2"><input type="number" value={p.step} onChange={e => updateParam(p.id, 'step', e.target.value)} className="input-field py-1.5 text-xs" min={0.001} step={0.001} /></div>
                  <div className="col-span-1 flex justify-center">
                    <button onClick={() => removeParam(p.id)} className="p-1 rounded hover:bg-[#ef5350]/20 text-[#787b86] hover:text-[#ef5350] transition-colors"><Trash2 size={13} /></button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="flex justify-end pb-4">
          <button onClick={handleRun} disabled={isRunning || !selectedStrategyId} className="flex items-center gap-2 btn-success px-6 py-2.5 text-sm font-medium disabled:opacity-40 disabled:cursor-not-allowed">
            {isRunning ? <LoadingSpinner size={18} /> : <Play size={18} />}
            {isRunning ? '優化中...' : '開始優化'}
          </button>
        </div>
      </div>
    </div>
  )
}