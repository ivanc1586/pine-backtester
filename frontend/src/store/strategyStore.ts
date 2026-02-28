import { create } from 'zustand'
import api from '../services/api'

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------
export interface SavedStrategy {
  id: string
  name: string
  description: string
  pine_script: string
  saved_at: string
  updated_at?: string

  // 回測設定
  symbol: string
  market_type: string
  interval: string
  start_date: string
  end_date: string

  // 核心績效指標
  profit_pct: number
  win_rate: number
  max_drawdown: number
  sharpe_ratio: number
  profit_factor: number
  total_trades: number
  final_equity: number
  gross_profit: number
  gross_loss: number

  // 完整報告
  params: Record<string, number>
  equity_curve: number[]
  monthly_pnl: Record<string, number>
  trades: any[]
  rank: number
}

export interface StrategySavePayload {
  name: string
  description?: string
  pine_script?: string
  symbol?: string
  market_type?: string
  interval?: string
  start_date?: string
  end_date?: string
  profit_pct?: number
  win_rate?: number
  max_drawdown?: number
  sharpe_ratio?: number
  profit_factor?: number
  total_trades?: number
  final_equity?: number
  gross_profit?: number
  gross_loss?: number
  params?: Record<string, number>
  equity_curve?: number[]
  monthly_pnl?: Record<string, number>
  trades?: any[]
  rank?: number
}

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------
interface StrategyStore {
  strategies: SavedStrategy[]
  isLoading: boolean
  fetchStrategies: () => Promise<void>
  saveStrategy: (data: StrategySavePayload) => Promise<string>
  updateStrategy: (id: string, data: { name?: string; description?: string }) => Promise<void>
  deleteStrategy: (id: string) => Promise<void>
}

export const useStrategyStore = create<StrategyStore>((set, get) => ({
  strategies: [],
  isLoading: false,

  fetchStrategies: async () => {
    set({ isLoading: true })
    try {
      const res = await api.get('/api/strategies')
      set({ strategies: res.data.strategies ?? [] })
    } finally {
      set({ isLoading: false })
    }
  },

  saveStrategy: async (data) => {
    const res = await api.post('/api/strategies', data)
    await get().fetchStrategies()
    return res.data.id as string
  },

  updateStrategy: async (id, data) => {
    await api.put(`/api/strategies/${id}`, data)
    await get().fetchStrategies()
  },

  deleteStrategy: async (id) => {
    await api.delete(`/api/strategies/${id}`)
    set(s => ({ strategies: s.strategies.filter(x => x.id !== id) }))
  },
}))
