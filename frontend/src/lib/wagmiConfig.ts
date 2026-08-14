import { http, createConfig } from 'wagmi'
import { bsc, mainnet, polygon } from 'wagmi/chains'
import { injected, metaMask } from 'wagmi/connectors'

export const wagmiConfig = createConfig({
  chains: [mainnet, polygon, bsc],
  connectors: [metaMask(), injected()],
  transports: {
    [mainnet.id]: http(),
    [polygon.id]: http(),
    [bsc.id]: http(),
  },
})
