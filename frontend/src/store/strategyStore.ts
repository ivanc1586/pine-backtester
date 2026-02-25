import { create } from 'zustand'
import api from '../services/api'

export interface Strategy {
  id: string
  name: string
  description: string
  pine_script: string
  created_at: string
  updated_at: string
}

interface StrategyStore {
  strategies: Strategy[]
  selectedStrategy: Strategy | null
  isLoading: boolean
  fetchStrategies: () => Promise<void>
  createStrategy: (data: Partial<Strategy>) => Promise<void>
  updateStrategy: (id: string, data: Partial<Strategy>) => Promise<void>
  deleteStrategy: (id: string) => Promise<void>
  selectStrategy: (s: Strategy) => void
}

export const useStrategyStore = create<StrategyStore>((set, get) => ({
  strategies: [],
  selectedStrategy: null,
  isLoading: false,
  fetchStrategies: async () => {
    set({ isLoading: true })
    const res = await api.get('/api/strategies')
    set({ strategies: res.data, isLoading: false })
  },
  createStrategy: async (data) => {
    await api.post('/api/strategies', data)
    await get().fetchStrategies()
  },
  updateStrategy: async (id, data) => {
    await api.put(`/api/strategies/${id}`, data)
    await get().fetchStrategies()
  },
  deleteStrategy: async (id) => {
    await api.delete(`/api/strategies/${id}`)
    set(s => ({ strategies: s.strategies.filter(x => x.id !== id), selectedStrategy: s.selectedStrategy?.id === id ? null : s.selectedStrategy }))
  },
  selectStrategy: (s) => set({ selectedStrategy: s }),
}))
