import { useEffect, useState, useRef } from 'react'
import { Plus, Trash2, Edit3, Save, X, Copy, ChevronRight, FileCode, Clock } from 'lucide-react'
import PageHeader from '../components/PageHeader'
import LoadingSpinner from '../components/LoadingSpinner'
import { useStrategyStore, Strategy } from '../store/strategyStore'

const SAMPLE_SCRIPTS: Record<string, string> = {
  'EMA Cross': `//@version=5
strategy("EMA Cross Strategy", overlay=true)
fastLength = input(9, title="Fast EMA Length")
slowLength = input(21, title="Slow EMA Length")
fastEMA = ta.ema(close, fastLength)
slowEMA = ta.ema(close, slowLength)
plot(fastEMA, color=color.new(color.blue, 0), linewidth=2)
plot(slowEMA, color=color.new(color.orange, 0), linewidth=2)
longCondition = ta.crossover(fastEMA, slowEMA)
shortCondition = ta.crossunder(fastEMA, slowEMA)
if (longCondition)
    strategy.entry("Long", strategy.long)
if (shortCondition)
    strategy.close("Long")`,
  'RSI Reversal': `//@version=5
strategy("RSI Reversal Strategy", overlay=false)
rsiLength = input(14, title="RSI Length")
overbought = input(70, title="Overbought Level")
oversold = input(30, title="Oversold Level")
rsiVal = ta.rsi(close, rsiLength)
plot(rsiVal, color=color.purple, linewidth=2)
hline(overbought, "Overbought", color=color.red)
hline(oversold, "Oversold", color=color.green)
if (ta.crossover(rsiVal, oversold))
    strategy.entry("Long", strategy.long)
if (ta.crossunder(rsiVal, overbought))
    strategy.close("Long")`,
  'MACD Strategy': `//@version=5
strategy("MACD Strategy", overlay=false)
fastLength = input(12, title="Fast Length")
slowLength = input(26, title="Slow Length")
signalLength = input(9, title="Signal Length")
[macdLine, signalLine, hist] = ta.macd(close, fastLength, slowLength, signalLength)
plot(macdLine, color=color.blue, linewidth=2)
plot(signalLine, color=color.orange, linewidth=2)
if (ta.crossover(macdLine, signalLine))
    strategy.entry("Long", strategy.long)
if (ta.crossunder(macdLine, signalLine))
    strategy.close("Long")`,
  'Bollinger Bands': `//@version=5
strategy("Bollinger Bands Strategy", overlay=true)
length = input(20, title="BB Length")
mult = input(2.0, title="BB Multiplier")
basis = ta.sma(close, length)
dev = mult * ta.stdev(close, length)
upper = basis + dev
lower = basis - dev
plot(basis, color=color.orange)
p1 = plot(upper, color=color.blue)
p2 = plot(lower, color=color.blue)
fill(p1, p2, color=color.new(color.blue, 90))
if (ta.crossover(close, lower))
    strategy.entry("Long", strategy.long)
if (ta.crossunder(close, upper))
    strategy.close("Long")`,
}

export default function StrategyPage() {
  const { strategies, selectedStrategy, fetchStrategies, createStrategy, updateStrategy, deleteStrategy, selectStrategy, isLoading } = useStrategyStore()
  const [isEditing, setIsEditing] = useState(false)
  const [editForm, setEditForm] = useState({ name: '', description: '', pine_script: '' })
  const [editingId, setEditingId] = useState<string | null>(null)
  const [showSampleMenu, setShowSampleMenu] = useState(false)
  const [copyFeedback, setCopyFeedback] = useState('')
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { fetchStrategies() }, [])

  const handleNew = () => {
    setEditingId(null)
    setEditForm({ name: '', description: '', pine_script: SAMPLE_SCRIPTS['EMA Cross'] })
    setIsEditing(true)
  }

  const handleEdit = (s: Strategy) => {
    setEditingId(s.id)
    setEditForm({ name: s.name, description: s.description, pine_script: s.pine_script })
    setIsEditing(true)
  }

  const handleSave = async () => {
    if (!editForm.name.trim() || !editForm.pine_script.trim()) return
    if (editingId) { await updateStrategy(editingId, editForm) } else { await createStrategy(editForm) }
    setIsEditing(false)
    setEditingId(null)
  }

  const handleDelete = async (id: string) => {
    if (!confirm('確定要刪除此策略嗎？')) return
    await deleteStrategy(id)
  }

  const handleCopyScript = (script: string) => {
    navigator.clipboard.writeText(script)
    setCopyFeedback('已複製！')
    setTimeout(() => setCopyFeedback(''), 2000)
  }

  const loadSample = (name: string) => {
    setEditForm(prev => ({ ...prev, pine_script: SAMPLE_SCRIPTS[name], name: prev.name || name }))
    setShowSampleMenu(false)
  }

  const formatDate = (iso: string) => new Date(iso).toLocaleDateString('zh-TW', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' })

  return (
    <div className="flex h-full overflow-hidden">
      <div className="w-72 bg-[#1e2328] border-r border-[#2a2e39] flex flex-col shrink-0">
        <div className="h-14 px-4 border-b border-[#2a2e39] flex items-center justify-between">
          <span className="text-white font-semibold text-sm">策略列表</span>
          <button onClick={handleNew} className="flex items-center gap-1.5 btn-primary text-xs py-1.5 px-3"><Plus size={14} /> 新增</button>
        </div>
        {isLoading ? (
          <div className="flex-1 flex items-center justify-center"><LoadingSpinner /></div>
        ) : strategies.length === 0 ? (
          <div className="flex-1 flex flex-col items-center justify-center gap-3 text-center p-6">
            <FileCode size={40} className="text-[#2a2e39]" />
            <p className="text-[#787b86] text-sm">尚無策略<br />點擊新增開始建立</p>
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto">
            {strategies.map(s => (
              <div key={s.id} onClick={() => selectStrategy(s)} className={`group border-b border-[#2a2e39]/50 p-3 cursor-pointer transition-colors hover:bg-[#2a2e39]/40 ${selectedStrategy?.id === s.id ? 'bg-[#2196f3]/10 border-l-2 border-l-[#2196f3]' : ''}`}>
                <div className="flex items-start justify-between gap-2">
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <ChevronRight size={12} className={`text-[#2196f3] shrink-0 transition-transform ${selectedStrategy?.id === s.id ? 'rotate-90' : ''}`} />
                      <span className="text-white text-sm font-medium truncate">{s.name}</span>
                    </div>
                    {s.description && <p className="text-[#787b86] text-xs mt-1 pl-4 truncate">{s.description}</p>}
                    <div className="flex items-center gap-1 mt-1.5 pl-4">
                      <Clock size={10} className="text-[#787b86]" />
                      <span className="text-[#787b86] text-xs">{formatDate(s.updated_at)}</span>
                    </div>
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                    <button onClick={e => { e.stopPropagation(); handleEdit(s) }} className="p-1 rounded hover:bg-[#2196f3]/20 text-[#787b86] hover:text-[#2196f3]"><Edit3 size={13} /></button>
                    <button onClick={e => { e.stopPropagation(); handleDelete(s.id) }} className="p-1 rounded hover:bg-[#ef5350]/20 text-[#787b86] hover:text-[#ef5350]"><Trash2 size={13} /></button>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
      <div className="flex-1 flex flex-col overflow-hidden">
        {isEditing ? (
          <>
            <div className="h-14 px-4 border-b border-[#2a2e39] flex items-center justify-between bg-[#1e2328]">
              <span className="text-white font-semibold text-sm">{editingId ? '編輯策略' : '新增策略'}</span>
              <div className="flex gap-2">
                <div className="relative">
                  <button onClick={() => setShowSampleMenu(!showSampleMenu)} className="btn-primary text-xs py-1.5 px-3 bg-[#2a2e39]">範例模板</button>
                  {showSampleMenu && (
                    <div className="absolute right-0 top-full mt-1 bg-[#1e2328] border border-[#2a2e39] rounded-lg shadow-xl z-50 min-w-[160px]">
                      {Object.keys(SAMPLE_SCRIPTS).map(name => (
                        <button key={name} onClick={() => loadSample(name)} className="w-full text-left px-4 py-2 text-sm text-[#d1d4dc] hover:bg-[#2a2e39] hover:text-white transition-colors">{name}</button>
                      ))}
                    </div>
                  )}
                </div>
                <button onClick={() => setIsEditing(false)} className="p-1.5 rounded hover:bg-[#2a2e39] text-[#787b86]"><X size={16} /></button>
                <button onClick={handleSave} className="flex items-center gap-1.5 btn-success text-xs py-1.5 px-3"><Save size={14} /> 儲存</button>
              </div>
            </div>
            <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-[#787b86] mb-1.5 font-medium">策略名稱 *</label>
                  <input value={editForm.name} onChange={e => setEditForm(p => ({ ...p, name: e.target.value }))} placeholder="例：EMA Cross 9/21" className="input-field" />
                </div>
                <div>
                  <label className="block text-xs text-[#787b86] mb-1.5 font-medium">說明（選填）</label>
                  <input value={editForm.description} onChange={e => setEditForm(p => ({ ...p, description: e.target.value }))} placeholder="策略說明..." className="input-field" />
                </div>
              </div>
              <div className="flex-1 flex flex-col">
                <label className="block text-xs text-[#787b86] mb-1.5 font-medium">Pine Script 程式碼 *</label>
                <div className="flex-1 relative bg-[#0f1117] rounded-lg border border-[#2a2e39] overflow-hidden" style={{ minHeight: '400px' }}>
                  <div className="absolute top-2 right-2 z-10">
                    <button onClick={() => handleCopyScript(editForm.pine_script)} className="flex items-center gap-1 px-2 py-1 bg-[#2a2e39] hover:bg-[#363a45] rounded text-xs text-[#787b86] hover:text-white transition-colors"><Copy size={11} />{copyFeedback || '複製'}</button>
                  </div>
                  <textarea ref={textareaRef} value={editForm.pine_script} onChange={e => setEditForm(p => ({ ...p, pine_script: e.target.value }))} className="w-full h-full bg-transparent text-[#d1d4dc] font-mono text-sm p-4 resize-none outline-none leading-relaxed" style={{ minHeight: '400px', tabSize: 4 }} spellCheck={false} />
                </div>
              </div>
            </div>
          </>
        ) : selectedStrategy ? (
          <>
            <PageHeader title={selectedStrategy.name} subtitle={selectedStrategy.description || '點擊編輯按鈕修改策略'} actions={
              <div className="flex gap-2">
                <button onClick={() => handleCopyScript(selectedStrategy.pine_script)} className="flex items-center gap-1.5 px-3 py-1.5 bg-[#2a2e39] hover:bg-[#363a45] rounded text-xs text-[#d1d4dc] transition-colors"><Copy size={13} /> {copyFeedback || '複製程式碼'}</button>
                <button onClick={() => handleEdit(selectedStrategy)} className="flex items-center gap-1.5 btn-primary text-xs py-1.5 px-3"><Edit3 size={13} /> 編輯</button>
              </div>
            } />
            <div className="flex-1 overflow-auto p-4">
              <div className="grid grid-cols-3 gap-3 mb-4">
                <div className="card"><div className="text-[#787b86] text-xs mb-1">建立時間</div><div className="text-white text-sm">{formatDate(selectedStrategy.created_at)}</div></div>
                <div className="card"><div className="text-[#787b86] text-xs mb-1">更新時間</div><div className="text-white text-sm">{formatDate(selectedStrategy.updated_at)}</div></div>
                <div className="card"><div className="text-[#787b86] text-xs mb-1">程式碼行數</div><div className="text-white text-sm">{selectedStrategy.pine_script.split('\n').length} 行</div></div>
              </div>
              <div className="bg-[#0f1117] rounded-lg border border-[#2a2e39] p-4 relative">
                <button onClick={() => handleCopyScript(selectedStrategy.pine_script)} className="absolute top-3 right-3 flex items-center gap-1 px-2 py-1 bg-[#2a2e39] hover:bg-[#363a45] rounded text-xs text-[#787b86] hover:text-white transition-colors"><Copy size={11} /> {copyFeedback || '複製'}</button>
                <pre className="text-[#d1d4dc] font-mono text-sm leading-relaxed overflow-auto whitespace-pre-wrap">{selectedStrategy.pine_script}</pre>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center gap-4 text-center">
            <div className="w-16 h-16 rounded-2xl bg-[#2a2e39] flex items-center justify-center"><FileCode size={32} className="text-[#787b86]" /></div>
            <div>
              <p className="text-white font-semibold mb-1">選擇或新增策略</p>
              <p className="text-[#787b86] text-sm">從左側列表選擇策略，或點擊新增按鈕建立新策略</p>
            </div>
            <button onClick={handleNew} className="flex items-center gap-2 btn-primary"><Plus size={16} /> 新增策略</button>
          </div>
        )}
      </div>
    </div>
  )
}