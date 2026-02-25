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

export interface Candle {
  time: number   // Unix seconds (lightweight-charts format)
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface KlinesResponse {
  symbol: string
  interval: string
  source: string
  candles: Candle[]
  currentPrice: number | null
  lastSync: number   // Unix seconds
  count: number
}

export const backtestApi = {
  runBacktest: (data: BacktestRequest) => api.post('/api/backtest', data),
  getResults: (id: string) => api.get(`/api/backtest/${id}`),
  listResults: () => api.get('/api/backtest'),
}

export const marketApi = {
  /** Get klines - always Binance, served from SQLite cache */
  getKlines: (
    symbol: string,
    interval: string,
    limit: number = 500,
    source: string = 'binance'
  ): Promise<KlinesResponse> =>
    api
      .get('/api/market/klines', { params: { symbol, interval, limit, source } })
      .then((res) => res.data),

  /** Alias for backwards compatibility */
  getCandles: (
    symbol: string,
    interval: string,
    source: string = 'binance'
  ): Promise<KlinesResponse> =>
    api
      .get('/api/market/klines', { params: { symbol, interval, limit: 500, source } })
      .then((res) => res.data),

  getSymbols: () => api.get('/api/market/symbols').then((r) => r.data),
  getPrice: (symbol: string) =>
    api.get(`/api/market/price/${symbol}`).then((r) => r.data),
}

export default api
