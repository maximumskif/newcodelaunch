import { request } from './http'
import { isMainnetAmong } from './networks'

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
// The devnet entry's rpcUrl is overridable — same gap as wagmiConfig.ts's
// sepolia transport had (no way to point the wallet's own connection at a
// dedicated provider, only the backend's RPC config was configurable).
// Doubles as the hook e2e tests use to point confirmation/status reads at a
// local solana-test-validator (see frontend/e2e/README.md).
const solanaDevnetRpcUrl = (import.meta.env.VITE_SOLANA_DEVNET_RPC_URL as string | undefined) || 'https://api.devnet.solana.com'

export const SOLANA_NETWORKS: SolanaNetworkInfo[] = [
  { id: 'solana_devnet', label: 'Solana Devnet', rpcUrl: solanaDevnetRpcUrl, isTestnet: true },
  { id: 'solana', label: 'Solana Mainnet', rpcUrl: 'https://api.mainnet-beta.solana.com', isTestnet: false },
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
  creator_wallet: string
  transaction_signatures: string[]
  explorer_url: string | null
  created_at: string
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
  explorer_url: string | null
  items_available: number
  items_redeemed: number
  items_remaining: number
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
    },
  ) =>
    request<PrepareCandyMachineResult>(
      '/mint/prepare-candy-machine',
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

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
    },
  ) =>
    request<{ candy_machine: CandyMachineDeployment }>(
      '/mint/candy-machines',
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  list: (token: string) => request<{ candy_machines: CandyMachineDeployment[] }>('/mint/candy-machines', {}, token),

  // Public storefront — no token, no account. Anyone with a shared drop
  // link can view status and mint.
  getPublicStatus: (candyMachineAddress: string) =>
    request<PublicCandyMachineStatus>(`/mint/public/${candyMachineAddress}`),

  prepareMint: (candyMachineAddress: string, minterWallet: string) =>
    request<PreparedMint>(`/mint/public/${candyMachineAddress}/mint`, {
      method: 'POST',
      body: JSON.stringify({ minter_wallet: minterWallet }),
    }),
}
