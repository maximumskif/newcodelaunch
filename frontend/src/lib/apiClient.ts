import { request } from './http'

export type Chain = 'evm' | 'solana'

export interface LinkedWallet {
  wallet_address: string
  chain: Chain
  linked_at: string
}

export interface AuthUser {
  id: string
  // The wallet this session signed in with — what the connected wallet is
  // checked against. `wallets` is every wallet linked to the account.
  wallet_address: string
  chain: Chain
  wallets: LinkedWallet[]
  created_at: string
}

// A signed nonce proving control of a wallet (sign-in, or linking).
export interface WalletProof {
  wallet_address: string
  chain: Chain
  signature: string
  nonce: string
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

  // Link another wallet to the signed-in account. If it has its own account,
  // that account merges into this one — `merged` counts what moved.
  linkWallet: (token: string, proof: WalletProof) =>
    request<{ user: AuthUser; merged: Record<string, number> }>(
      '/auth/wallets',
      { method: 'POST', body: JSON.stringify(proof) },
      token,
    ),

  unlinkWallet: (token: string, chain: Chain, walletAddress: string) =>
    request<{ user: AuthUser }>(`/auth/wallets/${chain}/${encodeURIComponent(walletAddress)}`, { method: 'DELETE' }, token),

  networks: () => request<{ networks: NetworkSummary[] }>('/blockchain/networks'),

  networkStatus: (network: string) => request<NetworkStatus>(`/blockchain/${network}/status`),
}
