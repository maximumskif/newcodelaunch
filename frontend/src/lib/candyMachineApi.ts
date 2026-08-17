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
export const SOLANA_NETWORKS: SolanaNetworkInfo[] = [
  { id: 'solana_devnet', label: 'Solana Devnet', rpcUrl: 'https://api.devnet.solana.com', isTestnet: true },
  { id: 'solana', label: 'Solana Mainnet', rpcUrl: 'https://api.mainnet-beta.solana.com', isTestnet: false },
]

export function isSolanaMainnet(networkId: string): boolean {
  return isMainnetAmong(SOLANA_NETWORKS, networkId)
}

export interface PrepareCandyMachineResult {
  collection_mint: string
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
  prepare: (
    token: string,
    payload: {
      collection_id: string
      network: SolanaNetworkId
      creator_wallet: string
      price_sol: number
      go_live_date: string
      seller_fee_bps?: number
      project_id?: string
    },
  ) => request<PrepareCandyMachineResult>('/mint/prepare', { method: 'POST', body: JSON.stringify(payload) }, token),

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
