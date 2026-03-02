// ================================================================
// constants/symbols.ts
// ----------------------------------------------------------------
// 單一真相來源 (Single Source of Truth) for:
//   - 幣對清單
//   - API endpoints (spot vs fapi)
//   - Market type 判斷
//   - localStorage key 名稱
//
// 所有 page (MarketsPage / ChartPage / HomePage) 都 import 此檔
// 禁止在各 page 內硬編碼幣對清單或 API URL
// ================================================================

// ----------------------------------------------------------------
// Market type
// ----------------------------------------------------------------
export type MarketType = 'spot' | 'futures'

// ----------------------------------------------------------------
// localStorage keys — 所有頁面共用同一組 key，禁止自行定義
// ----------------------------------------------------------------
export const LS_CHART_SYMBOL = 'chart_symbol'
export const LS_CHART_MARKET = 'chart_market'

// ----------------------------------------------------------------
// 幣對清單
// ----------------------------------------------------------------

/** 主流加密幣 (spot, via api.binance.com) */
export const CRYPTO_SYMBOLS = [
  'BTCUSDT',
  'ETHUSDT',
  'SOLUSDT',
  'BNBUSDT',
  'XRPUSDT',
  'ADAUSDT',
  'DOGEUSDT',
  'AVAXUSDT',
  'DOTUSDT',
  'LINKUSDT',
  'MATICUSDT',
  'LTCUSDT',
  'UNIUSDT',
  'ATOMUSDT',
] as const

/** 貴金屬 (perpetual futures, via fapi.binance.com) */
export const METAL_SYMBOLS = [
  'XAUUSDT',
  'XAGUSDT',
] as const

/** 全部幣對 = crypto + metals（MarketsPage 用） */
export const ALL_SYMBOLS = [...CRYPTO_SYMBOLS, ...METAL_SYMBOLS] as const

/** ChartPage 搜尋下拉清單 */
export const POPULAR_SYMBOLS = [...ALL_SYMBOLS, 'NEARUSDT'] as const

export type CryptoSymbol = typeof CRYPTO_SYMBOLS[number]
export type MetalSymbol  = typeof METAL_SYMBOLS[number]
export type AnySymbol    = typeof ALL_SYMBOLS[number]

// ----------------------------------------------------------------
// Market type 判斷
// ----------------------------------------------------------------

/** 判斷某 symbol 是否為貴金屬（需走 fapi） */
export const isMetal = (symbol: string): boolean =>
  (METAL_SYMBOLS as readonly string[]).includes(symbol)

/** 根據 symbol 取得 market type */
export const getMarketType = (symbol: string): MarketType =>
  isMetal(symbol) ? 'futures' : 'spot'

// ----------------------------------------------------------------
// API Endpoints
// ----------------------------------------------------------------

const SPOT_REST   = 'https://api.binance.com/api/v3'
const FAPI_REST   = 'https://fapi.binance.com/fapi/v1'
const SPOT_WS     = 'wss://stream.binance.com:9443/ws'
const FAPI_WS     = 'wss://fstream.binance.com/ws'

/** 取得 REST base URL */
export const getRestBase = (symbol: string): string =>
  isMetal(symbol) ? FAPI_REST : SPOT_REST

/** 取得 WebSocket base URL */
export const getWsBase = (symbol: string): string =>
  isMetal(symbol) ? FAPI_WS : SPOT_WS

/** 取得 K線 REST URL */
export const getKlineUrl = (
  symbol: string,
  interval: string,
  limit = 200
): string =>
  `${getRestBase(symbol)}/klines?symbol=${symbol}&interval=${interval}&limit=${limit}`

/** 取得 24hr ticker REST URL */
export const getTickerUrl = (symbol: string): string =>
  `${getRestBase(symbol)}/ticker/24hr?symbol=${symbol}`

/** 取得 K線 WebSocket stream URL */
export const getKlineWsUrl = (symbol: string, interval: string): string =>
  `${getWsBase(symbol)}/${symbol.toLowerCase()}@kline_${interval}`

/** 取得 ticker WebSocket stream URL */
export const getTickerWsUrl = (symbol: string): string =>
  `${getWsBase(symbol)}/${symbol.toLowerCase()}@ticker`

// ----------------------------------------------------------------
// 跳轉至 ChartPage 時寫入 localStorage
// ----------------------------------------------------------------

/**
 * 從任何頁面跳轉到 /chart 前，呼叫此函式寫入必要的 localStorage keys。
 *
 * 使用範例：
 *   import { setChartTarget } from '../constants/symbols'
 *   setChartTarget('XAUUSDT')
 *   navigate('/chart')
 */
export const setChartTarget = (symbol: string): void => {
  localStorage.setItem(LS_CHART_SYMBOL, symbol)
  localStorage.setItem(LS_CHART_MARKET, getMarketType(symbol))
}

// ----------------------------------------------------------------
// 顯示用 metadata
// ----------------------------------------------------------------

export const SYMBOL_LABELS: Record<string, string> = {
  BTCUSDT:   'Bitcoin',
  ETHUSDT:   'Ethereum',
  SOLUSDT:   'Solana',
  BNBUSDT:   'BNB',
  XRPUSDT:   'Ripple',
  ADAUSDT:   'Cardano',
  DOGEUSDT:  'Dogecoin',
  AVAXUSDT:  'Avalanche',
  DOTUSDT:   'Polkadot',
  LINKUSDT:  'Chainlink',
  MATICUSDT: 'Polygon',
  LTCUSDT:   'Litecoin',
  UNIUSDT:   'Uniswap',
  ATOMUSDT:  'Cosmos',
  XAUUSDT:   'Gold',
  XAGUSDT:   'Silver',
  NEARUSDT:  'NEAR',
}

export const SYMBOL_ICONS: Record<string, string> = {
  BTCUSDT:   '₿',
  ETHUSDT:   'Ξ',
  SOLUSDT:   '◎',
  BNBUSDT:   '⬡',
  XRPUSDT:   '✕',
  ADAUSDT:   '₳',
  DOGEUSDT:  'Ð',
  AVAXUSDT:  '▲',
  DOTUSDT:   '⬟',
  LINKUSDT:  '⬡',
  MATICUSDT: '⬈',
  LTCUSDT:   'Ł',
  UNIUSDT:   '🦄',
  ATOMUSDT:  '⚛',
  XAUUSDT:   '⬉',
  XAGUSDT:   '◎',
  NEARUSDT:  'N',
}

export const SYMBOL_COLORS: Record<string, string> = {
  BTCUSDT:   '#f7931a',
  ETHUSDT:   '#7c3aed',
  SOLUSDT:   '#9945ff',
  BNBUSDT:   '#f0b90b',
  XRPUSDT:   '#006ab4',
  ADAUSDT:   '#0033ad',
  DOGEUSDT:  '#c8a400',
  AVAXUSDT:  '#e84142',
  DOTUSDT:   '#e6007a',
  LINKUSDT:  '#2a5ada',
  MATICUSDT: '#8247e5',
  LTCUSDT:   '#bfbbbb',
  UNIUSDT:   '#ff007a',
  ATOMUSDT:  '#6f7390',
  XAUUSDT:   '#ffd700',
  XAGUSDT:   '#aaaaaa',
  NEARUSDT:  '#00c08b',
}
