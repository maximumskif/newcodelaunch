import { http, createConfig } from 'wagmi'
import { bsc, bscTestnet, mainnet, polygon, polygonAmoy, sepolia } from 'wagmi/chains'
import { injected, metaMask } from 'wagmi/connectors'

export const wagmiConfig = createConfig({
  chains: [sepolia, mainnet, polygonAmoy, polygon, bscTestnet, bsc],
  connectors: [metaMask(), injected()],
  transports: {
    [sepolia.id]: http(),
    [mainnet.id]: http(),
    [polygonAmoy.id]: http(),
    [polygon.id]: http(),
    [bscTestnet.id]: http(),
    [bsc.id]: http(),
  },
})
