import { request } from './http'

export type Chain = 'evm' | 'solana'

export interface AuthUser {
  id: string
  wallet_address: string
  chain: Chain
  created_at: string
}

export interface NetworkSummary {
  id: string
  name: string
  chain_id?: number
  native_token: string
  explorer_url: string
}

export interface NetworkStatus {
  connected: boolean
  network?: string
  error?: string
  [key: string]: unknown
}

export const apiClient = {
  requestNonce: (walletAddress: string, chain: Chain) =>
    request<{ message: string; nonce: string }>('/auth/nonce', {
      method: 'POST',
      body: JSON.stringify({ wallet_address: walletAddress, chain }),
    }),

  verify: (walletAddress: string, chain: Chain, signature: string, nonce: string) =>
    request<{ access_token: string; user: AuthUser }>('/auth/verify', {
      method: 'POST',
      body: JSON.stringify({ wallet_address: walletAddress, chain, signature, nonce }),
    }),

  me: (token: string) => request<{ user: AuthUser }>('/auth/me', {}, token),

  networks: () => request<{ networks: NetworkSummary[] }>('/blockchain/networks'),

  networkStatus: (network: string) => request<NetworkStatus>(`/blockchain/${network}/status`),
}
