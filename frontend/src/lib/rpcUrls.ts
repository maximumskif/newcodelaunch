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

// EVM: `undefined` means "no override" — wagmiConfig.ts hands these to
// viem's http(), which then uses its own public default for that chain.
// Keyed by the same network ids the backend and NetworkContext.tsx use.
export const EVM_RPC_URL_OVERRIDES = {
  sepolia: rpcOverride(env.VITE_SEPOLIA_RPC_URL),
  ethereum: rpcOverride(env.VITE_ETHEREUM_RPC_URL),
  polygon_amoy: rpcOverride(env.VITE_POLYGON_AMOY_RPC_URL),
  polygon: rpcOverride(env.VITE_POLYGON_RPC_URL),
  bsc_testnet: rpcOverride(env.VITE_BSC_TESTNET_RPC_URL),
  bsc: rpcOverride(env.VITE_BSC_RPC_URL),
}

// Solana has no library-side default to fall through to (unlike viem), so
// these resolve to a concrete URL. VITE_SOLANA_RPC_URL (mainnet) is the name
// solanaWallets.tsx already used before this file existed — kept rather than
// renamed, so an existing .env keeps working.
export const SOLANA_MAINNET_RPC_URL = rpcOverride(env.VITE_SOLANA_RPC_URL) ?? 'https://api.mainnet-beta.solana.com'
export const SOLANA_DEVNET_RPC_URL = rpcOverride(env.VITE_SOLANA_DEVNET_RPC_URL) ?? 'https://api.devnet.solana.com'
