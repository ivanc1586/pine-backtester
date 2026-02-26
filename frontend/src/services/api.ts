import axios from 'axios'

const api = axios.create({
  baseURL: import.meta.env.VITE_API_URL || '',
  timeout: 30000,
})

export interface BacktestRequest {
  symbol: string
  interval: string
  start_date: string
  end_date: string
  pine_script: string
  initial_capital?: number
}

export interface BacktestResult {
  trades: any[]
  metrics: Record<string, any>
  equity_curve: any[]
}

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export const backtestApi = {
  run: (data: BacktestRequest) =>
    api.post<BacktestResult>('/api/backtest/run', data).then(r => r.data),
}

export default api
