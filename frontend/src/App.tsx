// ===============================================
// 主程式入口模組
// -----------------------------------------------
// v1.4.0 - 2026-03-02 - 新增 /markets 路由與導覽項目
// v1.3.0 - 2026-03-01 - 移除 /results、/performance，新增 /report/:id
// v1.2.0 - 2026-02-28 - 新增首頁（市場概覽 + 近期策略）
// v1.1.0 - 2026-02-26 - 新增「參數優化」與「績效分析」頁面
// ===============================================

import { BrowserRouter, Routes, Route, NavLink } from 'react-router-dom'
import { Home, LineChart, Code2, Target, TrendingUp, BarChart2 } from 'lucide-react'
import HomePage from './pages/HomePage'
import ChartPage from './pages/ChartPage'
import StrategyPage from './pages/StrategyPage'
import OptimizePage from './pages/OptimizePage'
import ReportPage from './pages/ReportPage'
import MarketsPage from './pages/MarketsPage'
import { useStrategyStore } from './store/strategyStore'

const navItems = [
  { path: '/',           label: '首頁',       icon: Home         },
  { path: '/markets',    label: '市場',        icon: BarChart2    },
  { path: '/chart',      label: '圖表瀏覽器', icon: LineChart    },
  { path: '/strategy',   label: '策略程式碼', icon: Code2        },
  { path: '/optimize',   label: '參數優化',   icon: Target       },
]

export default function App() {
  const { strategies } = useStrategyStore()

  return (
    <BrowserRouter>
      <div className="flex h-screen bg-slate-900 overflow-hidden">
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
                end={path === '/'}
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
        </nav>

        <main className="flex-1 overflow-y-auto">
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/markets" element={<MarketsPage />} />
            <Route path="/chart" element={<ChartPage />} />
            <Route path="/strategy" element={<StrategyPage />} />
            <Route path="/optimize" element={<OptimizePage />} />
            <Route path="/report/:id" element={<ReportPage />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}
