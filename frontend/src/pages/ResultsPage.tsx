import { useState } from 'react'
import { Copy, ChevronDown, ChevronUp, TrendingUp, TrendingDown, BarChart2, Trophy, Filter } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import { useStrategyStore, BacktestResult } from '../store/strategyStore'
import { useNavigate } from 'react-router-dom'

const SORT_OPTIONS = [
  { value: 'profit_pct', label: '最大盈利', icon: TrendingUp },
  { value: 'win_rate', label: '勝率', icon: Trophy },
  { value: 'profit_factor', label: '盈虧比', icon: BarChart2 },
  { value: 'max_drawdown', label: '最低MDD', icon: TrendingDown },
]

function generatePineScript(baseScript: string, params: Record<string, number>): string {
  let script = baseScript
  for (const [key, val] of Object.entries(params)) {
    const regex = new RegExp(`(${key}\s*=\s*input(?:\.int|\.float)?\s*\()([^,)]+)`, 'g')
    script = script.replace(regex, `$1${val}`)
  }
  return script
}

function ResultCard({ result, index, strategy, onClick }: {
  result: BacktestResult
  index: number
  strategy: any
  onClick: () => void
}) {
  const isProfitable = result.profit_pct > 0
  const mddColor = result.max_drawdown > 30 ? 'text-[#ef5350]' : result.max_drawdown > 15 ? 'text-[#f59e0b]' : 'text-[#26a69a]'

  return (
    <div onClick={onClick} className="card cursor-pointer hover:border-[#2196f3]/40 transition-all duration-200 hover:shadow-lg hover:shadow-[#2196f3]/5 group">
      <div className="flex items-start justify-between mb-3">
        <div className="flex items-center gap-2">
          <span className="w-6 h-6 rounded bg-[#2196f3]/20 text-[#2196f3] text-xs font-bold flex items-center justify-center">{index + 1}</span>
          <div>
            <div className="text-white text-sm font-medium">{strategy?.name || '策略'}</div>
            <div className="text-[#787b86] text-xs">{result.symbol} · {result.interval}</div>
          </div>
        </div>
        <div className={`text-lg font-bold font-mono ${isProfitable ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
          {isProfitable ? '+' : ''}{result.profit_pct.toFixed(2)}%
        </div>
      </div>
      {result.params && Object.keys(result.params).length > 0 && (
        <div className="flex flex-wrap gap-1 mb-3">
          {Object.entries(result.params).map(([k, v]) => (
            <span key={k} className="px-2 py-0.5 bg-[#2a2e39] rounded text-xs text-[#787b86] font-mono">
              {k}: <span className="text-[#d1d4dc]">{v}</span>
            </span>
          ))}
        </div>
      )}
      <div className="grid grid-cols-4 gap-2">
        <div className="text-center">
          <div className={`text-sm font-bold font-mono ${result.win_rate >= 50 ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>{result.win_rate.toFixed(1)}%</div>
          <div className="text-[#787b86] text-xs mt-0.5">勝率</div>
        </div>
        <div className="text-center">
          <div className="text-sm font-bold font-mono text-white">{result.winning_trades}<span className="text-[#787b86] font-normal">/{result.total_trades}</span></div>
          <div className="text-[#787b86] text-xs mt-0.5">盈利/總數</div>
        </div>
        <div className="text-center">
          <div className={`text-sm font-bold font-mono ${mddColor}`}>-{result.max_drawdown.toFixed(1)}%</div>
          <div className="text-[#787b86] text-xs mt-0.5">MDD</div>
        </div>
        <div className="text-center">
          <div className={`text-sm font-bold font-mono ${result.profit_factor >= 1.5 ? 'text-[#26a69a]' : result.profit_factor >= 1 ? 'text-[#f59e0b]' : 'text-[#ef5350]'}`}>{result.profit_factor.toFixed(2)}</div>
          <div className="text-[#787b86] text-xs mt-0.5">盈虧比</div>
        </div>
      </div>
      <div className="mt-3 pt-3 border-t border-[#2a2e39] flex items-center justify-between">
        <span className="text-[#787b86] text-xs">點擊查看詳情與複製代碼</span>
        <ChevronDown size={14} className="text-[#787b86] group-hover:text-[#2196f3] transition-colors" />
      </div>
    </div>
  )
}

function ResultModal({ result, strategy, onClose }: { result: BacktestResult, strategy: any, onClose: () => void }) {
  const [copied, setCopied] = useState(false)
  const [showTrades, setShowTrades] = useState(false)

  const optimizedScript = strategy?.pine_script ? generatePineScript(strategy.pine_script, result.params) : ''

  const handleCopy = () => {
    navigator.clipboard.writeText(optimizedScript)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="fixed inset-0 bg-black/70 z-50 flex items-center justify-center p-4" onClick={onClose}>
      <div className="bg-[#1e2328] border border-[#2a2e39] rounded-xl w-full max-w-2xl max-h-[90vh] overflow-hidden flex flex-col" onClick={e => e.stopPropagation()}>
        <div className="px-5 py-4 border-b border-[#2a2e39] flex items-center justify-between">
          <div>
            <h3 className="text-white font-semibold">{strategy?.name}</h3>
            <p className="text-[#787b86] text-xs mt-0.5">{result.symbol} · {result.interval}</p>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xl font-bold font-mono ${result.profit_pct > 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
              {result.profit_pct > 0 ? '+' : ''}{result.profit_pct.toFixed(2)}%
            </span>
            <button onClick={onClose} className="p-1.5 rounded hover:bg-[#2a2e39] text-[#787b86]">✕</button>
          </div>
        </div>
        <div className="overflow-y-auto flex-1">
          <div className="grid grid-cols-4 gap-3 p-5">
            {[
              { label: '勝率', value: `${result.win_rate.toFixed(1)}%`, color: result.win_rate >= 50 ? 'green' : 'red' },
              { label: '交易筆數', value: `${result.winning_trades}/${result.total_trades}`, color: 'default' },
              { label: 'MDD', value: `-${result.max_drawdown.toFixed(1)}%`, color: result.max_drawdown < 15 ? 'green' : result.max_drawdown < 30 ? 'yellow' : 'red' },
              { label: '盈虧比', value: result.profit_factor.toFixed(2), color: result.profit_factor >= 1.5 ? 'green' : result.profit_factor >= 1 ? 'yellow' : 'red' },
            ].map(stat => (
              <div key={stat.label} className="bg-[#131722] rounded-lg p-3 text-center">
                <div className={`text-lg font-bold font-mono ${stat.color === 'green' ? 'text-[#26a69a]' : stat.color === 'red' ? 'text-[#ef5350]' : stat.color === 'yellow' ? 'text-[#f59e0b]' : 'text-white'}`}>{stat.value}</div>
                <div className="text-[#787b86] text-xs mt-1">{stat.label}</div>
              </div>
            ))}
          </div>
          <div className="px-5 pb-4">
            <h4 className="text-[#787b86] text-xs font-medium mb-2">優化參數</h4>
            <div className="flex flex-wrap gap-2">
              {Object.entries(result.params).map(([k, v]) => (
                <span key={k} className="px-3 py-1.5 bg-[#2196f3]/10 border border-[#2196f3]/20 rounded text-xs font-mono text-[#2196f3]">
                  {k} = <span className="text-white font-bold">{v}</span>
                </span>
              ))}
            </div>
          </div>
          <div className="px-5 pb-4">
            <div className="flex items-center justify-between mb-2">
              <h4 className="text-[#787b86] text-xs font-medium">帶入新參數的 Pine Script</h4>
              <button onClick={handleCopy} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#26a69a]/20 hover:bg-[#26a69a]/30 border border-[#26a69a]/30 rounded text-xs text-[#26a69a] transition-colors">
                <Copy size={12} /> {copied ? '已複製！' : '複製程式碼'}
              </button>
            </div>
            <div className="bg-[#0f1117] rounded-lg border border-[#2a2e39] p-4 max-h-48 overflow-y-auto">
              <pre className="text-[#d1d4dc] font-mono text-xs leading-relaxed whitespace-pre-wrap">{optimizedScript}</pre>
            </div>
          </div>
          {result.trades && result.trades.length > 0 && (
            <div className="px-5 pb-5">
              <button onClick={() => setShowTrades(!showTrades)} className="flex items-center gap-2 text-[#787b86] text-xs font-medium hover:text-white transition-colors">
                {showTrades ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                交易記錄 ({result.trades.length} 筆)
              </button>
              {showTrades && (
                <div className="mt-2 border border-[#2a2e39] rounded-lg overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-[#131722] text-[#787b86]">
                        <th className="px-3 py-2 text-left">進場</th>
                        <th className="px-3 py-2 text-right">進場價</th>
                        <th className="px-3 py-2 text-right">出場價</th>
                        <th className="px-3 py-2 text-right">盈虧</th>
                        <th className="px-3 py-2 text-right">%</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.trades.slice(0, 50).map((t, i) => (
                        <tr key={i} className="border-t border-[#2a2e39] hover:bg-[#2a2e39]/30">
                          <td className="px-3 py-2 text-[#787b86]">{new Date(t.entry_time * 1000).toLocaleDateString('zh-TW')}</td>
                          <td className="px-3 py-2 text-right font-mono">{t.entry_price.toLocaleString()}</td>
                          <td className="px-3 py-2 text-right font-mono">{t.exit_price.toLocaleString()}</td>
                          <td className={`px-3 py-2 text-right font-mono font-bold ${t.pnl > 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>{t.pnl > 0 ? '+' : ''}{t.pnl.toFixed(2)}</td>
                          <td className={`px-3 py-2 text-right font-mono ${t.pnl_pct > 0 ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>{t.pnl_pct > 0 ? '+' : ''}{t.pnl_pct.toFixed(2)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default function ResultsPage() {
  const { optimizeResults, strategies, currentResult, setCurrentResult } = useStrategyStore()
  const [sortBy, setSortBy] = useState('profit_pct')
  const [filterSymbol, setFilterSymbol] = useState('')
  const navigate = useNavigate()

  const sorted = [...optimizeResults].sort((a, b) => {
    if (sortBy === 'max_drawdown') return a.max_drawdown - b.max_drawdown
    return (b[sortBy as keyof BacktestResult] as number) - (a[sortBy as keyof BacktestResult] as number)
  })

  const filtered = filterSymbol ? sorted.filter(r => r.symbol.includes(filterSymbol.toUpperCase())) : sorted
  const getStrategy = (id: string) => strategies.find(s => s.id === id)

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="回測結果"
        subtitle={`共 ${optimizeResults.length} 筆優化結果`}
        actions={optimizeResults.length === 0 ? (
          <button onClick={() => navigate('/optimize')} className="btn-primary text-xs py-1.5 px-3">前往優化 →</button>
        ) : null}
      />
      <div className="px-4 py-2 border-b border-[#2a2e39] bg-[#1e2328] flex items-center gap-3 flex-wrap shrink-0">
        <div className="flex items-center gap-1">
          <Filter size={13} className="text-[#787b86]" />
          <span className="text-[#787b86] text-xs">排序：</span>
        </div>
        {SORT_OPTIONS.map(opt => (
          <button key={opt.value} onClick={() => setSortBy(opt.value)} className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-xs font-medium transition-colors ${sortBy === opt.value ? 'bg-[#2196f3]/15 text-[#2196f3]' : 'text-[#787b86] hover:text-white'}`}>
            <opt.icon size={12} />{opt.label}
          </button>
        ))}
        <div className="ml-auto">
          <input value={filterSymbol} onChange={e => setFilterSymbol(e.target.value)} placeholder="篩選交易對..." className="input-field py-1 text-xs w-32" />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-4">
        {filtered.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#2a2e39] flex items-center justify-center"><BarChart2 size={32} className="text-[#787b86]" /></div>
            <div>
              <p className="text-white font-semibold mb-1">尚無回測結果</p>
              <p className="text-[#787b86] text-sm">前往「參數優化」頁面執行回測</p>
            </div>
            <button onClick={() => navigate('/optimize')} className="btn-primary">前往優化頁面</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3">
            {filtered.map((result, i) => (
              <ResultCard key={result.id} result={result} index={i} strategy={getStrategy(result.strategy_id)} onClick={() => setCurrentResult(result)} />
            ))}
          </div>
        )}
      </div>
      {currentResult && (
        <ResultModal result={currentResult} strategy={getStrategy(currentResult.strategy_id)} onClose={() => setCurrentResult(null)} />
      )}
    </div>
  )
}