// Every RPC endpoint the browser talks to, in one place. Public RPCs are a
// fine default for dev but rate-limit hard at real volume, so each one has a
// VITE_*_RPC_URL build-time override for a dedicated provider (Helius,
// QuickNode, Alchemy, etc) — named after the backend's own RPC env vars
// (SEPOLIA_RPC_URL etc. in backend/app/config.py) so the two sides read the
// same. Used to be scattered: only Sepolia and Solana Devnet had overrides,
// and Solana mainnet was hard-coded in candyMachineApi.ts while
// solanaWallets.tsx separately read VITE_SOLANA_RPC_URL for the same network.

// `||`, not `??` — an unset Vite build arg (e.g. a Docker build that didn't
// forward this one, see frontend/Dockerfile's ENV block) bakes in an
// explicit empty string, not `undefined`, and `??` only falls through on
// `null`/`undefined`. An empty (or whitespace-only) string is never a usable
// RPC URL, so it falls through to the default the same way an actually
// missing value does.
export function rpcOverride(value: string | undefined): string | undefined {
  return value?.trim() || undefined
}

const env = import.meta.env as Record<string, string | undefined>

// EVM: `undefined` means "no override". Keyed by the same network ids the
// backend and NetworkContext.tsx use.
export const EVM_RPC_URL_OVERRIDES = {
  sepolia: rpcOverride(env.VITE_SEPOLIA_RPC_URL),
  ethereum: rpcOverride(env.VITE_ETHEREUM_RPC_URL),
  polygon_amoy: rpcOverride(env.VITE_POLYGON_AMOY_RPC_URL),
  polygon: rpcOverride(env.VITE_POLYGON_RPC_URL),
  bsc_testnet: rpcOverride(env.VITE_BSC_TESTNET_RPC_URL),
  bsc: rpcOverride(env.VITE_BSC_RPC_URL),
  base_sepolia: rpcOverride(env.VITE_BASE_SEPOLIA_RPC_URL),
  base: rpcOverride(env.VITE_BASE_RPC_URL),
}

// Public endpoints tried after the override, in order — the same list as the
// backend's (backend/app/config.py), each checked with eth_chainId on
// 2026-09-29. Several per network because public RPCs disappear,
// rate-limit, or are blocked by ISP filters (a Spectrum "Security Shield"
// blocked viem's own defaults for Ethereum, Polygon and BSC); wagmi falls
// through to the next one when a request fails.
export const EVM_PUBLIC_RPC_URLS: Record<keyof typeof EVM_RPC_URL_OVERRIDES, string[]> = {
  sepolia: ['https://ethereum-sepolia-rpc.publicnode.com', 'https://1rpc.io/sepolia', 'https://sepolia.drpc.org'],
  ethereum: ['https://ethereum.publicnode.com', 'https://eth.drpc.org', 'https://1rpc.io/eth', 'https://cloudflare-eth.com'],
  polygon_amoy: ['https://polygon-amoy-bor-rpc.publicnode.com', 'https://polygon-amoy.drpc.org', 'https://rpc-amoy.polygon.technology'],
  polygon: ['https://1rpc.io/matic', 'https://polygon-bor-rpc.publicnode.com', 'https://polygon.drpc.org', 'https://polygon-rpc.com'],
  bsc_testnet: [
    'https://bsc-testnet.bnbchain.org',
    'https://data-seed-prebsc-1-s1.bnbchain.org:8545',
    'https://bsc-testnet.drpc.org',
    'https://bsc-testnet-rpc.publicnode.com',
  ],
  bsc: ['https://bsc-dataseed1.defibit.io', 'https://1rpc.io/bnb', 'https://bsc-rpc.publicnode.com', 'https://bsc-dataseed.binance.org'],
  base_sepolia: ['https://sepolia.base.org', 'https://base-sepolia-rpc.publicnode.com', 'https://base-sepolia.drpc.org'],
  base: ['https://mainnet.base.org', 'https://base-rpc.publicnode.com', 'https://1rpc.io/base', 'https://base.drpc.org'],
}

// The endpoints wagmi tries for a network, in order. A local node (anvil in
// the e2e suite) is a different chain from the public network it stands in
// for, so it gets no public fallbacks.
export function evmRpcUrls(network: keyof typeof EVM_RPC_URL_OVERRIDES): string[] {
  const override = EVM_RPC_URL_OVERRIDES[network]
  if (override && /localhost|127\.0\.0\.1/.test(override)) return [override]
  return [...new Set([...(override ? [override] : []), ...EVM_PUBLIC_RPC_URLS[network]])]
}

// Solana has no library-side default to fall through to (unlike viem), so
// these resolve to a concrete URL. VITE_SOLANA_RPC_URL (mainnet) is the name
// solanaWallets.tsx already used before this file existed — kept rather than
// renamed, so an existing .env keeps working.
export const SOLANA_MAINNET_RPC_URL = rpcOverride(env.VITE_SOLANA_RPC_URL) ?? 'https://api.mainnet-beta.solana.com'
export const SOLANA_DEVNET_RPC_URL = rpcOverride(env.VITE_SOLANA_DEVNET_RPC_URL) ?? 'https://api.devnet.solana.com'
