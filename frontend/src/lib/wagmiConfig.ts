import { fallback, http, createConfig } from 'wagmi'
import { bsc, bscTestnet, mainnet, polygon, polygonAmoy, sepolia } from 'wagmi/chains'
import { injected, metaMask } from 'wagmi/connectors'

import { evmRpcUrls } from './rpcUrls'

// Each chain reads through its optional VITE_*_RPC_URL override first, then
// the public endpoints in rpcUrls.ts, moving on when one fails. Sepolia's
// override doubles as the hook e2e tests use to point signing/broadcasting
// at a local anvil instance (see frontend/e2e/README.md).
const transport = (network: Parameters<typeof evmRpcUrls>[0]) => fallback(evmRpcUrls(network).map((url) => http(url)))
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
    [sepolia.id]: transport('sepolia'),
    [mainnet.id]: transport('ethereum'),
    [polygonAmoy.id]: transport('polygon_amoy'),
    [polygon.id]: transport('polygon'),
    [bscTestnet.id]: transport('bsc_testnet'),
    [bsc.id]: transport('bsc'),
  },
})
