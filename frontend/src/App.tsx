import { BrowserRouter, Routes, Route, NavLink, Navigate } from 'react-router-dom'
import { LineChart, Code2, Settings, BarChart3, TrendingUp, Zap } from 'lucide-react'
import ChartPage from './pages/ChartPage'
import StrategyPage from './pages/StrategyPage'
import OptimizePage from './pages/OptimizePage'
import ResultsPage from './pages/ResultsPage'
import PerformancePage from './pages/PerformancePage'
import { useStrategyStore } from './store/strategyStore'

const navItems = [
  { path: '/chart', label: '即時行情', icon: LineChart },
  { path: '/strategy', label: '策略管理', icon: Code2 },
  { path: '/optimize', label: '參數優化', icon: Settings },
  { path: '/results', label: '回測結果', icon: BarChart3 },
  { path: '/performance', label: '月度績效', icon: TrendingUp },
]

export default function App() {
  return (
    <BrowserRouter>
      <div className="flex h-screen bg-[#131722] overflow-hidden">
        {/* Sidebar */}
        <aside className="w-16 md:w-56 bg-[#1e2328] border-r border-[#2a2e39] flex flex-col shrink-0">
          {/* Logo */}
          <div className="h-14 flex items-center px-4 border-b border-[#2a2e39] gap-3">
            <div className="w-8 h-8 bg-[#2196f3] rounded-lg flex items-center justify-center shrink-0">
              <Zap size={16} className="text-white" />
            </div>
            <span className="hidden md:block font-bold text-white text-sm tracking-wide">Pine Backtester</span>
          </div>

          {/* Nav */}
          <nav className="flex-1 py-4 flex flex-col gap-1 px-2">
            {navItems.map(({ path, label, icon: Icon }) => (
              <NavLink
                key={path}
                to={path}
                className={({ isActive }) =>
                  `flex items-center gap-3 px-3 py-2.5 rounded-lg text-sm font-medium transition-all duration-150 ${
                    isActive
                      ? 'bg-[#2196f3]/15 text-[#2196f3] border border-[#2196f3]/20'
                      : 'text-[#787b86] hover:text-[#d1d4dc] hover:bg-[#2a2e39]'
                  }`
                }
              >
                <Icon size={18} className="shrink-0" />
                <span className="hidden md:block">{label}</span>
              </NavLink>
            ))}
          </nav>

          {/* Footer */}
          <div className="p-4 border-t border-[#2a2e39]">
            <div className="hidden md:block text-[10px] text-[#787b86] text-center">
              Pine Backtester v1.0<br />
              <span className="text-[#26a69a]">● Live</span>
            </div>
          </div>
        </aside>

        {/* Main Content */}
        <main className="flex-1 overflow-hidden flex flex-col">
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
