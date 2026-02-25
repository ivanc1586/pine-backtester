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

export interface MarketDataRequest {
  symbol: string
  interval: string
  source?: string
  limit?: number
}

export const backtestApi = {
  runBacktest: (data: BacktestRequest) => api.post('/api/backtest', data),
  getResults: (id: string) => api.get(`/api/backtest/${id}`),
  listResults: () => api.get('/api/backtest'),
}

export const marketApi = {
  getHistoricalData: (params: MarketDataRequest) =>
    api.get('/api/market/klines', { params }),
  getKlines: (symbol: string, interval: string, limit: number = 500, source: string = 'coingecko') =>
    api.get('/api/market/klines', { params: { symbol, interval, limit, source } })
      .then(res => res.data),
  getSymbols: () => api.get('/api/market/symbols'),
  getPrice: (symbol: string) => api.get(`/api/market/price/${symbol}`),
}

export default api
