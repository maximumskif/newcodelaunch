import { request } from './http'

export interface MarketToken {
  id: string
  symbol: string
  name: string
  image: string | null
  current_price: number | null
  market_cap: number | null
  market_cap_rank: number | null
  total_volume: number | null
  price_change_percentage_24h: number | null
}

export interface DefiProtocol {
  id: string | null
  name: string
  symbol: string | null
  category: string | null
  chains: string[]
  tvl: number | null
  change_1d: number | null
  change_7d: number | null
  url: string | null
  logo: string | null
}

export const marketApi = {
  listTokens: (limit = 20) => request<{ tokens: MarketToken[] }>(`/market/tokens?limit=${limit}`),
  listProtocols: (limit = 20) => request<{ protocols: DefiProtocol[] }>(`/defi/protocols?limit=${limit}`),
}
