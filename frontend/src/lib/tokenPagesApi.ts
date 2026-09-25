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

export const tokenPagesApi = {
  get: (network: string, address: string) =>
    isSolanaNetworkId(network)
      ? request<SolanaTokenPage>(`/token-pages/solana/${encodeURIComponent(address)}`)
      : request<EvmTokenPage>(`/token-pages/evm/${encodeURIComponent(network)}/${encodeURIComponent(address)}`),
}

// Where a token's public page lives in this app.
export const tokenPagePath = (network: string, address: string) => `/token/${network}/${address}`
