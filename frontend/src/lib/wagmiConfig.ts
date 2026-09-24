import { http, createConfig } from 'wagmi'
import { bsc, bscTestnet, mainnet, polygon, polygonAmoy, sepolia } from 'wagmi/chains'
import { injected, metaMask } from 'wagmi/connectors'

// Unlike the backend (SEPOLIA_RPC_URL etc. in app/config.py), the wallet's
// own transport here had no override seam at all — http() with no argument
// always uses viem's hardcoded public default RPC for that chain. Doubles
// as the hook e2e tests use to point signing/broadcasting at a local anvil
// instance (see frontend/e2e/README.md) instead of a real network.
// An unset Vite build arg (e.g. a Docker build that didn't forward this
// optional one) bakes in an explicit empty string, not undefined — normalize
// it to undefined so `http(sepoliaRpcUrl)` below reliably falls through to
// viem's own default rather than being handed a URL that isn't one.
const sepoliaRpcUrl = (import.meta.env.VITE_SEPOLIA_RPC_URL as string | undefined) || undefined

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
    [sepolia.id]: http(sepoliaRpcUrl),
    [mainnet.id]: http(),
    [polygonAmoy.id]: http(),
    [polygon.id]: http(),
    [bscTestnet.id]: http(),
    [bsc.id]: http(),
  },
})
