import { request } from './http'

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
}
