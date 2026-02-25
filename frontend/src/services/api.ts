import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || 'http://localhost:8000',
})

export interface BacktestRequest {
  strategy_id: string
  symbol: string
  timeframe: string
  start_date: string
  end_date: string
  initial_capital: number
}

export const backtestApi = {
  runBacktest: (data: BacktestRequest) => api.post('/api/backtest', data),
  getResults: (id: string) => api.get(`/api/backtest/${id}`),
  listResults: () => api.get('/api/backtest'),
}

export default api
