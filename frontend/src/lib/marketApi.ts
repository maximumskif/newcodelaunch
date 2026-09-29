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

// One trading pair from DexScreener (token lookup and trending).
export interface DexPair {
  chain: string
  dex: string
  pair_address: string
  url: string | null
  base_token: { address: string; name: string; symbol: string }
  quote_symbol: string | null
  price_usd: number | null
  price_change_24h: number | null
  volume_24h: number | null
  liquidity_usd: number | null
  fdv: number | null
  market_cap: number | null
  created_at: number | null
  image: string | null
  boosts?: number | null
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
  listTokens: (limit = 20) => request<{ tokens: MarketToken[]; source: string }>(`/market/tokens?limit=${limit}`),
  lookupToken: (address: string) => request<{ pairs: DexPair[] }>(`/market/lookup?address=${encodeURIComponent(address)}`),
  trending: () => request<{ tokens: DexPair[] }>('/market/trending'),
  listProtocols: (limit = 20) => request<{ protocols: DefiProtocol[] }>(`/defi/protocols?limit=${limit}`),
}
