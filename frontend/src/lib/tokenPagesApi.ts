import { request } from './http'

// Public token pages (backend services/token_pages.py): a token launched
// with this app, as the chain has it. Amounts are base units as strings.
interface PoolBase {
  dex: string
  pair: string | null
  token_reserve?: string
  native_reserve?: string
  lp_supply?: string
}

export interface EvmTokenPage {
  chain: 'evm'
  network: string
  address: string
  template: string
  name: string
  symbol: string
  decimals: number
  total_supply: string
  owner: string | null
  ownership_renounced: boolean
  advanced: { trading_enabled: boolean; buy_tax_bps: number; sell_tax_bps: number; max_transaction: string; max_wallet: string } | null
  source_verified: boolean
  // null: couldn't be checked (the recorded parameters no longer render).
  code_matches_template: boolean | null
  explorer_url: string | null
  chain_time: number
  pool: (PoolBase & { burned_lp?: string; locks?: { address: string; amount: string; release_time: number }[] }) | null
  // Token Vesting contracts for this token that are still paying out;
  // amount is what each still holds.
  vesting?: { address: string; beneficiary: string; amount: string; start_time: number; cliff_time: number; end_time: number }[]
  // A Bonding-Curve Token whose code matches the template: where it stands.
  curve?: {
    graduated: boolean
    eth_reserve: string
    tokens_sold: string
    curve_supply: string
    pool_supply: string
    graduation_target: string
    pair: string
  } | null
}

export interface SolanaTokenPage {
  chain: 'solana'
  network: string
  address: string
  name: string
  symbol: string
  decimals: number
  total_supply: string
  mint_authority_revoked: boolean
  freeze_authority_revoked: boolean
  metadata_locked: boolean
  explorer_url: string | null
  pool: (PoolBase & { permanently_locked_lp?: string }) | null
}

export type TokenPage = EvmTokenPage | SolanaTokenPage

export const isSolanaNetworkId = (network: string) => network === 'solana_devnet' || network === 'solana'

// The token checker (backend services/token_checker.py): any token.
export interface TokenCheck {
  id: string
  // true: the reassuring answer; false: worth a closer look; null: unknown.
  ok: boolean | null
  label: string
  detail: string
}

export interface TokenCheckResult {
  chain: 'evm' | 'solana'
  network: string
  address: string
  name: string | null
  symbol: string | null
  decimals: number
  total_supply: string
  owner: string | null
  powers: string[]
  contract_name: string | null
  checks: TokenCheck[]
  largest_holders: { address: string; share: number }[] | null
  liquidity: {
    chain: string
    pools: number
    total_liquidity_usd: number
    top: { dex: string; pair_address: string; url: string | null; price_usd: number | null; liquidity_usd: number | null; volume_24h: number | null }
  } | null
  launched_here: string | null
  explorer_url: string
}

export interface HolderSnapshot {
  chain: 'evm' | 'solana'
  network: string
  address: string
  symbol: string | null
  decimals: number
  total_supply: string
  holder_count: number
  // Only the largest 10,000 holders are listed when there are more.
  truncated: boolean
  holders: { address: string; balance: string; share: number }[]
  as_of: { block: number | null; latest: boolean }
  burn_addresses: string[]
}

// A bonding-curve token's trades, from its own events (backend
// services/curve_market.py). Amounts are wei / base units as strings;
// eth_reserve and tokens_sold are the curve's state right after the trade.
// eth is what went into the curve (buy) or to the seller (sell); the 1%
// platform fee was on top of a buy and out of a sale ("0" for curves
// launched before there was one).
export interface CurveTrade {
  kind: 'buy' | 'sell'
  wallet: string
  eth: string
  fee: string
  tokens: string
  eth_reserve: string
  tokens_sold: string
  block: number
  tx: string
  time: number
}

export interface CurveTrades {
  network: string
  address: string
  // All trades ever; `trades` holds the latest 100, newest first.
  trade_count: number
  trades: CurveTrade[]
  graduated: { pair: string; eth: string; tokens: string; block: number; tx: string; time: number } | null
  explorer_tx: string | null
}

export interface CurveLaunch {
  network: string
  address: string
  name: string
  symbol: string
  graduation_target: string
  created_at: string | null
  // null when the chain couldn't be read just now.
  graduated: boolean | null
  eth_reserve: string | null
}

export const tokenPagesApi = {
  curveTrades: (network: string, address: string) =>
    request<CurveTrades>(`/token-pages/evm/${encodeURIComponent(network)}/${encodeURIComponent(address)}/trades`),
  curveLaunches: (network?: string) =>
    request<{ launches: CurveLaunch[] }>(`/token-pages/curves${network ? `?network=${encodeURIComponent(network)}` : ''}`),
  holders: (network: string, address: string, block?: string) =>
    request<HolderSnapshot>(
      `/token-pages/holders/${encodeURIComponent(network)}/${encodeURIComponent(address.trim())}${block ? `?block=${encodeURIComponent(block)}` : ''}`,
    ),
  check: (network: string, address: string) =>
    request<TokenCheckResult>(`/token-pages/check/${encodeURIComponent(network)}/${encodeURIComponent(address.trim())}`),
  get: (network: string, address: string) =>
    isSolanaNetworkId(network)
      ? request<SolanaTokenPage>(`/token-pages/solana/${encodeURIComponent(address)}`)
      : request<EvmTokenPage>(`/token-pages/evm/${encodeURIComponent(network)}/${encodeURIComponent(address)}`),
}

// Where a token's public page lives in this app.
export const tokenPagePath = (network: string, address: string) => `/token/${network}/${address}`
