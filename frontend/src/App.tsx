// =============================================================================
// 修改歷程記錄
// -----------------------------------------------------------------------------
// v1.1.0 - 2026-02-26 - 導覽列名稱更新
//   - 「參數優化」改名為「策略優化」以符合新頁面功能
// =============================================================================

import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { LineChart, Code2, Target, BarChart3, TrendingUp } from 'lucide-react'
import ChartPage from './pages/ChartPage'
import StrategyPage from './pages/StrategyPage'
import OptimizePage from './pages/OptimizePage'
import ResultsPage from './pages/ResultsPage'
import PerformancePage from './pages/PerformancePage'
import { useStrategyStore } from './store/strategyStore'

const navItems = [
  { path: '/chart', label: '即時行情', icon: LineChart },
  { path: '/strategy', label: '策略管理', icon: Code2 },
  { path: '/optimize', label: '策略優化', icon: Target },
  { path: '/results', label: '回測結果', icon: BarChart3 },
  { path: '/performance', label: '績效分析', icon: TrendingUp },
]

export default function App() {
  const { strategies } = useStrategyStore()

  return (
    <BrowserRouter>
      <div className="flex h-screen bg-slate-900 overflow-hidden">
        {/* Sidebar */}
        <nav className="w-56 flex-shrink-0 bg-slate-800/80 backdrop-blur border-r border-white/10 flex flex-col">
          <div className="p-5 border-b border-white/10">
            <div className="flex items-center gap-2.5">
              <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-purple-500 to-violet-600 flex items-center justify-center">
                <TrendingUp className="w-4 h-4 text-white" />
              </div>
              <div>
                <div className="text-white font-bold text-sm">Pine Backtester</div>
                <div className="text-gray-500 text-xs">{strategies.length} strategies</div>
              </div>
            </div>
          </div>

          <div className="flex-1 p-3 space-y-1 overflow-y-auto">
            {navItems.map(({ path, label, icon: Icon }) => (
              <NavLink
                key={path}
                to={path}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium transition-all ${
                    isActive
                      ? 'bg-purple-500/20 text-purple-300 border border-purple-500/30'
                      : 'text-gray-400 hover:text-white hover:bg-white/5'
                  }`
                }
              >
                <Icon className="w-4 h-4 flex-shrink-0" />
                {label}
              </NavLink>
            ))}
          </div>

          <div className="p-4 border-t border-white/10">
            <div className="text-xs text-gray-600 text-center">Pine Backtester v2.0</div>
          </div>
        </nav>

        {/* Main content */}
        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<Navigate to="/chart" replace />} />
            <Route path="/chart" element={<ChartPage />} />
            <Route path="/strategy" element={<StrategyPage />} />
            <Route path="/optimize" element={<OptimizePage />} />
            <Route path="/results" element={<ResultsPage />} />
            <Route path="/performance" element={<PerformancePage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
