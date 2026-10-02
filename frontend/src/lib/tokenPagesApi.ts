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

export const tokenPagesApi = {
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
