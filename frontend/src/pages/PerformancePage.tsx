import { useState, useMemo } from 'react'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine, Cell } from 'recharts'
import { TrendingUp, TrendingDown, Calendar, BarChart3 } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import StatCard from '../components/StatCard'
import { useStrategyStore, BacktestResult } from '../store/strategyStore'
import { useNavigate } from 'react-router-dom'

interface MonthlyData {
  month: string
  pnl: number
  pnl_pct: number
  isPositive: boolean
}

const CustomTooltip = ({ active, payload, label }: any) => {
  if (!active || !payload?.length) return null
  const val = payload[0].value
  const isPos = val >= 0
  return (
    <div className="bg-[#1e2328] border border-[#2a2e39] rounded-lg px-3 py-2 shadow-xl">
      <div className="text-[#787b86] text-xs mb-1">{label}</div>
      <div className={`text-base font-bold font-mono ${isPos ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
        {isPos ? '+' : ''}{val.toFixed(2)}%
      </div>
    </div>
  )
}

function MonthlyTable({ data }: { data: MonthlyData[] }) {
  return (
    <div className="border border-[#2a2e39] rounded-lg overflow-hidden">
      <table className="w-full text-sm">
        <thead>
          <tr className="bg-[#131722] text-[#787b86] text-xs">
            <th className="px-4 py-2.5 text-left">月份</th>
            <th className="px-4 py-2.5 text-right">盈虧金額</th>
            <th className="px-4 py-2.5 text-right">盈虧%</th>
            <th className="px-4 py-2.5 text-right">狀態</th>
          </tr>
        </thead>
        <tbody>
          {data.map((row, i) => (
            <tr key={i} className="border-t border-[#2a2e39] hover:bg-[#2a2e39]/30 transition-colors">
              <td className="px-4 py-2.5 text-[#d1d4dc] font-medium">{row.month}</td>
              <td className={`px-4 py-2.5 text-right font-mono font-semibold ${row.isPositive ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                {row.isPositive ? '+' : ''}{row.pnl.toFixed(2)}
              </td>
              <td className={`px-4 py-2.5 text-right font-mono font-semibold ${row.isPositive ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>
                {row.isPositive ? '+' : ''}{row.pnl_pct.toFixed(2)}%
              </td>
              <td className="px-4 py-2.5 text-right">
                <span className={row.isPositive ? 'tag-buy' : 'tag-sell'}>{row.isPositive ? '▲ 盈利' : '▼ 虧損'}</span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

export default function PerformancePage() {
  const { optimizeResults, strategies, backtestResults } = useStrategyStore()
  const navigate = useNavigate()
  const [selectedResultId, setSelectedResultId] = useState<string>('')

  const allResults = [...optimizeResults, ...backtestResults]

  const selectedResult: BacktestResult | undefined = useMemo(() => {
    if (selectedResultId) return allResults.find(r => r.id === selectedResultId)
    return allResults[0]
  }, [selectedResultId, allResults])

  const monthlyData: MonthlyData[] = useMemo(() => {
    if (!selectedResult?.monthly_pnl) return []
    const initialCapital = 10000
    return Object.entries(selectedResult.monthly_pnl)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([month, pnl]) => ({ month, pnl, pnl_pct: (pnl / initialCapital) * 100, isPositive: pnl >= 0 }))
  }, [selectedResult])

  const stats = useMemo(() => {
    if (!monthlyData.length) return null
    const profitable = monthlyData.filter(m => m.isPositive)
    const losing = monthlyData.filter(m => !m.isPositive)
    const totalPnl = monthlyData.reduce((sum, m) => sum + m.pnl_pct, 0)
    const bestMonth = monthlyData.reduce((best, m) => m.pnl_pct > best.pnl_pct ? m : best, monthlyData[0])
    const worstMonth = monthlyData.reduce((worst, m) => m.pnl_pct < worst.pnl_pct ? m : worst, monthlyData[0])
    return { profitable: profitable.length, losing: losing.length, totalPnl, bestMonth, worstMonth }
  }, [monthlyData])

  const strategy = selectedResult ? strategies.find(s => s.id === selectedResult.strategy_id) : null

  if (allResults.length === 0) {
    return (
      <div className="flex flex-col h-full overflow-hidden">
        <PageHeader title="月度績效" subtitle="查看策略每月盈虧分佈" />
        <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
          <div className="w-16 h-16 rounded-2xl bg-[#2a2e39] flex items-center justify-center"><BarChart3 size={32} className="text-[#787b86]" /></div>
          <div>
            <p className="text-white font-semibold mb-1">尚無績效數據</p>
            <p className="text-[#787b86] text-sm">請先執行策略優化或回測</p>
          </div>
          <button onClick={() => navigate('/optimize')} className="btn-primary">前往優化頁面</button>
        </div>
      </div>
    )
  }

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <PageHeader
        title="月度績效"
        subtitle={strategy ? `${strategy.name} · ${selectedResult?.symbol}` : '月度盈虧分析'}
        actions={
          <select value={selectedResultId || selectedResult?.id || ''} onChange={e => setSelectedResultId(e.target.value)} className="select-field text-xs py-1.5 max-w-xs">
            {allResults.map((r, i) => {
              const s = strategies.find(s => s.id === r.strategy_id)
              return <option key={r.id} value={r.id}>#{i + 1} {s?.name || '策略'} · {r.symbol} ({r.profit_pct > 0 ? '+' : ''}{r.profit_pct.toFixed(1)}%)</option>
            })}
          </select>
        }
      />
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {stats && selectedResult && (
          <div className="grid grid-cols-2 md:grid-cols-4 lg:grid-cols-6 gap-3">
            <StatCard label="總盈虧" value={`${stats.totalPnl > 0 ? '+' : ''}${stats.totalPnl.toFixed(1)}%`} color={stats.totalPnl > 0 ? 'green' : 'red'} />
            <StatCard label="獲利月份" value={`${stats.profitable} 月`} sub={`共 ${monthlyData.length} 月`} color="green" />
            <StatCard label="虧損月份" value={`${stats.losing} 月`} color="red" />
            <StatCard label="月勝率" value={`${((stats.profitable / monthlyData.length) * 100).toFixed(0)}%`} color={stats.profitable > stats.losing ? 'green' : 'red'} />
            <StatCard label="最佳月份" value={`+${stats.bestMonth.pnl_pct.toFixed(1)}%`} sub={stats.bestMonth.month} color="green" />
            <StatCard label="最差月份" value={`${stats.worstMonth.pnl_pct.toFixed(1)}%`} sub={stats.worstMonth.month} color="red" />
          </div>
        )}
        <div className="card">
          <div className="flex items-center justify-between mb-4">
            <div>
              <h2 className="text-white font-semibold text-sm">月度盈虧柱狀圖</h2>
              <p className="text-[#787b86] text-xs mt-0.5">正值朝上（獲利）、負值朝下（虧損）</p>
            </div>
            <div className="flex items-center gap-3 text-xs">
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#26a69a] inline-block" /> 獲利</span>
              <span className="flex items-center gap-1.5"><span className="w-3 h-3 rounded-sm bg-[#ef5350] inline-block" /> 虧損</span>
            </div>
          </div>
          {monthlyData.length > 0 ? (
            <ResponsiveContainer width="100%" height={320}>
              <BarChart data={monthlyData} margin={{ top: 20, right: 20, left: 10, bottom: 20 }} barCategoryGap="30%">
                <CartesianGrid strokeDasharray="3 3" stroke="#2a2e39" vertical={false} />
                <XAxis dataKey="month" tick={{ fill: '#787b86', fontSize: 11 }} axisLine={{ stroke: '#2a2e39' }} tickLine={false} angle={-30} textAnchor="end" height={45} />
                <YAxis tick={{ fill: '#787b86', fontSize: 11 }} axisLine={false} tickLine={false} tickFormatter={v => `${v > 0 ? '+' : ''}${v.toFixed(1)}%`} />
                <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
                <ReferenceLine y={0} stroke="#363a45" strokeWidth={2} />
                <Bar dataKey="pnl_pct" radius={[3, 3, 0, 0]} maxBarSize={60}>
                  {monthlyData.map((entry, index) => (
                    <Cell key={`cell-${index}`} fill={entry.isPositive ? '#26a69a' : '#ef5350'} fillOpacity={0.85} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          ) : (
            <div className="h-80 flex items-center justify-center text-[#787b86] text-sm">此結果無月度數據（可能交易筆數不足）</div>
          )}
        </div>
        {selectedResult && (
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="card">
              <h3 className="text-white font-semibold text-sm mb-3">整體績效摘要</h3>
              <div className="space-y-2.5">
                {[
                  { label: '總盈虧', value: `${selectedResult.profit_pct > 0 ? '+' : ''}${selectedResult.profit_pct.toFixed(2)}%`, pos: selectedResult.profit_pct > 0 },
                  { label: '勝率', value: `${selectedResult.win_rate.toFixed(1)}%`, pos: selectedResult.win_rate >= 50 },
                  { label: '最大回撤 (MDD)', value: `-${selectedResult.max_drawdown.toFixed(2)}%`, pos: false },
                  { label: '盈虧比', value: selectedResult.profit_factor.toFixed(2), pos: selectedResult.profit_factor >= 1 },
                  { label: '總交易筆數', value: `${selectedResult.total_trades}`, pos: null },
                  { label: '獲利筆數', value: `${selectedResult.winning_trades} (${selectedResult.win_rate.toFixed(0)}%)`, pos: true },
                ].map(row => (
                  <div key={row.label} className="flex items-center justify-between py-1.5 border-b border-[#2a2e39]/50">
                    <span className="text-[#787b86] text-sm">{row.label}</span>
                    <span className={`font-mono font-semibold text-sm ${row.pos === null ? 'text-white' : row.pos ? 'text-[#26a69a]' : 'text-[#ef5350]'}`}>{row.value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div className="card">
              <h3 className="text-white font-semibold text-sm mb-3 flex items-center gap-2">
                <Calendar size={15} className="text-[#2196f3]" /> 月度盈虧明細
              </h3>
              {monthlyData.length > 0 ? (
                <div className="max-h-64 overflow-y-auto"><MonthlyTable data={monthlyData} /></div>
              ) : (
                <div className="text-center py-8 text-[#787b86] text-sm">無月度數據</div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}