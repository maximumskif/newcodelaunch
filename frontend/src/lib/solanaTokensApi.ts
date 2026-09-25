import { request, requestMultipart } from './http'
import type { SolanaNetworkId } from './candyMachineApi'

export interface SolanaTokenLaunch {
  id: string
  network: SolanaNetworkId
  mint_address: string
  transaction_signature: string
  creator_wallet: string
  name: string
  symbol: string
  decimals: number
  // Raw base units as a string — a u64 overflows a JS number.
  supply_raw: string
  metadata_uri: string | null
  mint_authority_revoked: boolean
  freeze_authority_revoked: boolean
  // Token Metadata made immutable — name/symbol/logo can never change again.
  metadata_locked: boolean
  explorer_url: string | null
  created_at: string
}

export type TokenAction = 'mint' | 'revokeMint' | 'revokeFreeze'

// A launched token's Raydium CPMM pool against SOL, as the chain has it
// (backend services/solana_pools.py). Amounts are base units / lamports as
// strings (u64).
export interface TokenPoolState {
  programId: string
  config: { tradeFeeRate: number; createPoolFee: string; disableCreatePool: boolean }
  poolId: string
  pool: { lpMint: string; tokenReserve: string; solReserve: string; lpSupply: string; openTime: number } | null
  ownerLp: string | null
  history: PoolAction[]
}

export interface PoolAction {
  id: string
  kind: 'create' | 'deposit' | 'withdraw'
  signature: string
  wallet: string
  token_amount: string
  sol_amount: string
  created_at: string
}

export type PoolActionInput =
  | { action: 'create'; owner: string; token_amount: string; sol_amount: string }
  | { action: 'deposit'; owner: string; token_amount: string }
  | { action: 'withdraw'; owner: string; lp_amount: string }

// A token's current metadata: on-chain name/symbol/URI + update authority,
// and the description/logo from its off-chain JSON when readable.
export interface TokenMetadata {
  name: string
  symbol: string
  uri: string
  update_authority: string
  is_mutable: boolean
  description: string
  image: string | null
}

export interface LiveTokenState {
  token: SolanaTokenLaunch
  // Current on-chain authorities (null = revoked). May not be the
  // launch-time creator if an authority was transferred outside this app.
  mint_authority: string | null
  freeze_authority: string | null
}

export interface PreparedTokenLaunch {
  mint: string
  transaction: string
  metadata_uri: string
}

export interface PrepareTokenInput {
  network: SolanaNetworkId
  creator_wallet: string
  name: string
  symbol: string
  decimals: number
  // Whole tokens, as typed — the backend multiplies by 10^decimals.
  supply: string
  description: string
  logo: File | null
  revoke_mint_authority: boolean
  revoke_freeze_authority: boolean
}

const U64_MAX = (1n << 64n) - 1n

// Largest whole-token supply an SPL mint can hold at `decimals` — the mint
// stores supply x 10^decimals in a u64. Mirrors the backend's own check
// (solana_tokens._raw_amount) so the form can say so before a round trip.
export function maxSupplyFor(decimals: number): bigint {
  return U64_MAX / 10n ** BigInt(decimals)
}

// Raw base units -> a grouped, human-readable token amount, exactly (no
// float rounding): formatTokenAmount('1234500', 2) === '12,345'.
export function formatTokenAmount(raw: string, decimals: number): string {
  const value = BigInt(raw)
  const scale = 10n ** BigInt(decimals)
  const whole = (value / scale).toLocaleString('en-US')
  const fraction = (value % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return fraction ? `${whole}.${fraction}` : whole
}

// Token Metadata's on-chain limits, in UTF-8 bytes — same numbers the
// backend and sidecar enforce.
const MAX_NAME_BYTES = 32
const MAX_SYMBOL_BYTES = 10

function utf8Length(value: string): number {
  return new TextEncoder().encode(value).length
}

// Returns the first problem with the form as typed, or null — shown inline
// and used to disable Launch, so an obviously-bad token never costs a
// wallet prompt or a network round trip.
export function validateTokenForm(name: string, symbol: string, decimals: string, supply: string): string | null {
  if (!name.trim()) return 'Give your token a name'
  if (utf8Length(name.trim()) > MAX_NAME_BYTES) return `Name must be at most ${MAX_NAME_BYTES} bytes`
  if (!symbol.trim()) return 'Give your token a symbol'
  if (utf8Length(symbol.trim()) > MAX_SYMBOL_BYTES) return `Symbol must be at most ${MAX_SYMBOL_BYTES} bytes`
  if (!/^\d$/.test(decimals)) return 'Decimals must be a whole number from 0 to 9'
  if (!/^\d+$/.test(supply) || BigInt(supply) === 0n) return 'Supply must be a positive whole number of tokens'
  const max = maxSupplyFor(Number(decimals))
  if (BigInt(supply) > max) return `At ${decimals} decimals, supply can be at most ${max.toLocaleString('en-US')} tokens`
  return null
}

export const solanaTokensApi = {
  prepare: (token: string, input: PrepareTokenInput) => {
    const formData = new FormData()
    formData.append('network', input.network)
    formData.append('creator_wallet', input.creator_wallet)
    formData.append('name', input.name)
    formData.append('symbol', input.symbol)
    formData.append('decimals', String(input.decimals))
    formData.append('supply', input.supply)
    formData.append('description', input.description)
    formData.append('revoke_mint_authority', String(input.revoke_mint_authority))
    formData.append('revoke_freeze_authority', String(input.revoke_freeze_authority))
    if (input.logo) formData.append('logo', input.logo)
    return requestMultipart<PreparedTokenLaunch>('/solana-tokens/prepare', formData, token)
  },

  record: (
    token: string,
    payload: {
      network: SolanaNetworkId
      mint_address: string
      transaction_signature: string
      creator_wallet: string
      name: string
      symbol: string
      metadata_uri: string
      // Best-effort link to the token project this launch came from.
      project_id?: string
    },
  ) =>
    request<{ token: SolanaTokenLaunch }>('/solana-tokens', { method: 'POST', body: JSON.stringify(payload) }, token),

  list: (token: string) => request<{ tokens: SolanaTokenLaunch[] }>('/solana-tokens', {}, token),

  // Owner tools. prepareAction's transaction must be signed by `authority`
  // (the mint's current on-chain authority); refresh re-reads the mint.
  prepareAction: (token: string, launchId: string, payload: { action: TokenAction; amount?: string }) =>
    request<{ transaction: string; authority: string }>(
      `/solana-tokens/${launchId}/prepare-action`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  getMetadata: (token: string, launchId: string) =>
    request<TokenMetadata>(`/solana-tokens/${launchId}/metadata`, {}, token),

  // Signed by `authority` (the token's update authority); then refresh.
  prepareMetadataUpdate: (
    token: string,
    launchId: string,
    input: { name: string; symbol: string; description: string; logo: File | null; lock: boolean },
  ) => {
    const formData = new FormData()
    formData.append('name', input.name)
    formData.append('symbol', input.symbol)
    formData.append('description', input.description)
    formData.append('lock', String(input.lock))
    if (input.logo) formData.append('logo', input.logo)
    return requestMultipart<{ transaction: string; authority: string; metadata_uri: string }>(
      `/solana-tokens/${launchId}/prepare-metadata-update`,
      formData,
      token,
    )
  },

  // Raydium liquidity: read the pool, build a create/deposit/withdraw for
  // the owner's wallet to sign, then record the confirmed signature.
  getPool: (token: string, launchId: string, owner?: string) =>
    request<TokenPoolState>(`/solana-tokens/${launchId}/pool${owner ? `?owner=${owner}` : ''}`, {}, token),

  preparePoolAction: (token: string, launchId: string, input: PoolActionInput) =>
    request<{ transaction: string }>(`/solana-tokens/${launchId}/pool/prepare`, { method: 'POST', body: JSON.stringify(input) }, token),

  recordPoolAction: (token: string, launchId: string, signature: string) =>
    request<{ action: PoolAction }>(`/solana-tokens/${launchId}/pool/record`, { method: 'POST', body: JSON.stringify({ signature }) }, token),

  refresh: (token: string, launchId: string) =>
    request<LiveTokenState>(`/solana-tokens/${launchId}/refresh`, { method: 'POST' }, token),
}
