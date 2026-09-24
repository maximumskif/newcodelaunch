import { request } from './http'
import { isMainnetAmong } from './networks'
import { SOLANA_DEVNET_RPC_URL, SOLANA_MAINNET_RPC_URL } from './rpcUrls'

export type SolanaNetworkId = 'solana_devnet' | 'solana'

export interface SolanaNetworkInfo {
  id: SolanaNetworkId
  label: string
  rpcUrl: string
  isTestnet: boolean
}

// Testnet-first, same policy as the EVM side (NetworkContext.tsx) — devnet
// listed (and used as the default) first. Kept as a small standalone list
// rather than folded into NetworkContext.tsx since that context is EVM-only
// (see its own comment: "Solana has no equivalent").
//
// Both rpcUrls are overridable (VITE_SOLANA_DEVNET_RPC_URL /
// VITE_SOLANA_RPC_URL, see rpcUrls.ts) — same gap as wagmiConfig.ts's
// transports had (no way to point the wallet's own connection at a
// dedicated provider, only the backend's RPC config was configurable; the
// mainnet entry stayed hard-coded to the public endpoint even after devnet
// got its override). The devnet one doubles as the hook e2e tests use to
// point confirmation/status reads at a local solana-test-validator (see
// frontend/e2e/README.md).
export const SOLANA_NETWORKS: SolanaNetworkInfo[] = [
  { id: 'solana_devnet', label: 'Solana Devnet', rpcUrl: SOLANA_DEVNET_RPC_URL, isTestnet: true },
  { id: 'solana', label: 'Solana Mainnet', rpcUrl: SOLANA_MAINNET_RPC_URL, isTestnet: false },
]

export function isSolanaMainnet(networkId: string): boolean {
  return isMainnetAmong(SOLANA_NETWORKS, networkId)
}

// Two-step launch flow — see docs/CANDY_MACHINE_BLOCKHASH_FIX_SPEC.md.
// prepareCollection's transaction must be signed, sent, and confirmed
// before ever calling prepareCandyMachine, so the second step's ephemeral
// signer and blockhash are generated right before its own wallet prompt,
// not minutes earlier alongside the first.
export interface PrepareCollectionResult {
  collection_mint: string
  transaction: string
}

export interface PrepareCandyMachineResult {
  candy_machine: string
  transactions: string[]
  // How many items the creation transaction itself loads; the rest come
  // from prepareConfigLines, a batch at a time.
  items_loaded: number
}

// The next batch of item-loading transactions (empty once all are loaded).
// Resumes from the chain's own count, so it's safe to call again after an
// interruption.
export interface ConfigLinesBatch {
  transactions: string[]
  items_loaded: number
  items_after: number
  items_available: number
}

export interface CandyMachineDeployment {
  id: string
  nft_collection_id: string
  network: string
  collection_mint: string
  candy_machine: string
  price_sol: number
  items_available: number
  go_live_date: string
  // Optional allowlist phase before go_live_date (price_sol/go_live_date
  // are the public phase). Never includes the wallet list itself.
  allowlist: AllowlistSummary | null
  // Optional per-wallet mint limit across all phases.
  mint_limit: number | null
  creator_wallet: string
  transaction_signatures: string[]
  explorer_url: string | null
  created_at: string
}

export interface AllowlistSummary {
  price_sol: number
  start_date: string
  size: number
}

// What a launch sends for an allowlist phase.
export interface AllowlistPhaseInput {
  addresses: string[]
  price_sol: number
  start_date: string
}

export type DropPhase = 'upcoming' | 'allowlist' | 'public'

// A drop's complete new phase configuration — replaces the old one.
export interface PhaseEdit {
  price_sol: number
  go_live_date: string
  allowlist?: AllowlistPhaseInput
  mint_limit?: number
}

export interface PublicCandyMachineStatus {
  candy_machine: string
  collection_mint: string
  network: SolanaNetworkId
  collection_name: string | null
  collection_description: string | null
  preview_image: string | null
  price_sol: number
  go_live_date: string
  is_live: boolean
  phase: DropPhase
  allowlist: AllowlistSummary | null
  // Only when the status was fetched with a wallet: is it on the allowlist?
  allowlisted: boolean | null
  // What that wallet would pay right now; null if it can't mint now.
  mint_price_sol: number | null
  mint_limit: number | null
  // Only with a wallet on a limited drop: its on-chain mint count.
  wallet_minted: number | null
  limit_reached: boolean
  explorer_url: string | null
  items_available: number
  items_redeemed: number
  items_remaining: number
}

// A creator's drop with live on-chain sales (GET /mint/dashboard). The
// live fields are null when that drop's on-chain status couldn't be read.
export interface CreatorDrop extends CandyMachineDeployment {
  collection_name: string | null
  is_live: boolean
  phase: DropPhase
  live_status_available: boolean
  items_redeemed: number | null
  items_remaining: number | null
  // A range: a drop with an allowlist phase has two prices, and the chain
  // doesn't record which phase each mint came through. Equal for one price.
  revenue_min_sol: number | null
  revenue_max_sol: number | null
}

export interface CreatorDashboard {
  drops: CreatorDrop[]
  // Per network — devnet and mainnet SOL are never summed together.
  totals_by_network: Partial<Record<SolanaNetworkId, NetworkTotals>>
}

export interface NetworkTotals {
  drops: number
  items_redeemed: number
  revenue_min_sol: number
  revenue_max_sol: number
}

export interface PreparedMint {
  transaction: string
  nft_mint: string
}

export const candyMachineApi = {
  prepareCollection: (
    token: string,
    payload: {
      collection_id: string
      network: SolanaNetworkId
      creator_wallet: string
      price_sol: number
      go_live_date: string
      seller_fee_bps?: number
      allowlist?: AllowlistPhaseInput
      mint_limit?: number
    },
  ) =>
    request<PrepareCollectionResult>('/mint/prepare-collection', { method: 'POST', body: JSON.stringify(payload) }, token),

  prepareCandyMachine: (
    token: string,
    payload: {
      collection_id: string
      network: SolanaNetworkId
      creator_wallet: string
      collection_mint: string
      price_sol: number
      go_live_date: string
      allowlist?: AllowlistPhaseInput
      mint_limit?: number
    },
  ) =>
    request<PrepareCandyMachineResult>(
      '/mint/prepare-candy-machine',
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  prepareConfigLines: (
    token: string,
    payload: { collection_id: string; network: SolanaNetworkId; creator_wallet: string; candy_machine: string },
  ) => request<ConfigLinesBatch>('/mint/prepare-config-lines', { method: 'POST', body: JSON.stringify(payload) }, token),

  create: (
    token: string,
    payload: {
      collection_id: string
      network: SolanaNetworkId
      collection_mint: string
      candy_machine: string
      transaction_signatures: string[]
      price_sol: number
      items_available: number
      go_live_date: string
      creator_wallet: string
      project_id?: string
      allowlist?: AllowlistPhaseInput
      mint_limit?: number
    },
  ) =>
    request<{ candy_machine: CandyMachineDeployment }>(
      '/mint/candy-machines',
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  list: (token: string) => request<{ candy_machines: CandyMachineDeployment[] }>('/mint/candy-machines', {}, token),

  dashboard: (token: string) => request<CreatorDashboard>('/mint/dashboard', {}, token),

  // Editing a live drop's phases: the creator's wallet signs the guard
  // update from prepareUpdate, then applyUpdate records it once the backend
  // has checked the new configuration on-chain.
  getAllowlist: (token: string, deploymentId: string) =>
    request<{ addresses: string[] }>(`/mint/candy-machines/${deploymentId}/allowlist`, {}, token),

  prepareUpdate: (token: string, deploymentId: string, payload: PhaseEdit) =>
    request<{ transaction: string }>(
      `/mint/candy-machines/${deploymentId}/prepare-update`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  applyUpdate: (token: string, deploymentId: string, payload: PhaseEdit & { transaction_signature: string }) =>
    request<{ candy_machine: CandyMachineDeployment }>(
      `/mint/candy-machines/${deploymentId}/phases`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  // Public storefront — no token, no account. Anyone with a shared drop
  // link can view status and mint.
  // With a wallet, the status also says whether it's on the allowlist and
  // what it would pay right now.
  getPublicStatus: (candyMachineAddress: string, wallet?: string) =>
    request<PublicCandyMachineStatus>(
      `/mint/public/${candyMachineAddress}${wallet ? `?wallet=${encodeURIComponent(wallet)}` : ''}`,
    ),

  prepareMint: (candyMachineAddress: string, minterWallet: string) =>
    request<PreparedMint>(`/mint/public/${candyMachineAddress}/mint`, {
      method: 'POST',
      body: JSON.stringify({ minter_wallet: minterWallet }),
    }),
}
