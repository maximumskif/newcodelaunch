import { fallback, http, createConfig } from 'wagmi'
import { base, baseSepolia, bsc, bscTestnet, mainnet, polygon, polygonAmoy, sepolia } from 'wagmi/chains'
import { injected, walletConnect } from 'wagmi/connectors'

import { evmRpcUrls } from './rpcUrls'

// Each chain reads through its optional VITE_*_RPC_URL override first, then
// the public endpoints in rpcUrls.ts, moving on when one fails. Sepolia's
// override doubles as the hook e2e tests use to point signing/broadcasting
// at a local anvil instance (see frontend/e2e/README.md).
const transport = (network: Parameters<typeof evmRpcUrls>[0]) => fallback(evmRpcUrls(network).map((url) => http(url)))
// WalletConnect needs a project ID from dashboard.reown.com (free), baked in
// at build time. Without one only browser wallets are offered. `||`, not
// `??`: an unset Vite build arg is an empty string (see lib/http.ts).
const walletConnectProjectId = import.meta.env.VITE_WALLETCONNECT_PROJECT_ID || ''
const origin = typeof window !== 'undefined' ? window.location.origin : 'https://localhost'

export const wagmiConfig = createConfig({
  chains: [sepolia, mainnet, polygonAmoy, polygon, bscTestnet, bsc, baseSepolia, base],
  connectors: [
    injected(),
    ...(walletConnectProjectId
      ? [
          walletConnect({
            projectId: walletConnectProjectId,
            // What the wallet app shows when asked to connect. The url must be
            // the site's own origin or WalletConnect's Verify flags it.
            metadata: { name: 'NewCodeLaunch', description: 'Launch tokens, NFT drops and contracts', url: origin, icons: [`${origin}/favicon.svg`] },
            showQrModal: true,
          }),
        ]
      : []),
  ],
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
    [baseSepolia.id]: transport('base_sepolia'),
    [base.id]: transport('base'),
  },
})
