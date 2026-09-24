import { http, createConfig } from 'wagmi'
import { bsc, bscTestnet, mainnet, polygon, polygonAmoy, sepolia } from 'wagmi/chains'
import { injected, metaMask } from 'wagmi/connectors'

import { EVM_RPC_URL_OVERRIDES as rpc } from './rpcUrls'

// Unlike the backend (SEPOLIA_RPC_URL etc. in app/config.py), the wallet's
// own transport here had no override seam at all — http() with no argument
// always uses viem's hardcoded public default RPC for that chain. Every
// chain now takes an optional VITE_*_RPC_URL override (see rpcUrls.ts —
// undefined falls through to viem's default); Sepolia's doubles as the hook
// e2e tests use to point signing/broadcasting at a local anvil instance (see
// frontend/e2e/README.md) instead of a real network.
export const wagmiConfig = createConfig({
  chains: [sepolia, mainnet, polygonAmoy, polygon, bscTestnet, bsc],
  connectors: [metaMask(), injected()],
  // wagmi defaults to { multicall: true }, which silently folds contract
  // reads made in the same tick into one call to the Multicall3 contract —
  // so reads fail outright on any chain where it isn't deployed (a fresh
  // local devnet has none; found by the e2e suite's ERC-721 owner panel,
  // whose reads all failed against anvil). A handful of extra eth_calls is
  // a better trade than reads that depend on a helper contract existing.
  batch: { multicall: false },
  transports: {
    [sepolia.id]: http(rpc.sepolia),
    [mainnet.id]: http(rpc.ethereum),
    [polygonAmoy.id]: http(rpc.polygon_amoy),
    [polygon.id]: http(rpc.polygon),
    [bscTestnet.id]: http(rpc.bsc_testnet),
    [bsc.id]: http(rpc.bsc),
  },
})
