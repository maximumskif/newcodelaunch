import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

import { isMainnetAmong } from '../../lib/networks'

export interface EvmNetwork {
  id: string
  label: string
  isTestnet: boolean
  // Same symbols as backend/app/services/blockchain.py's native_token.
  nativeToken: string
}

// Testnets listed (and defaulted to) first — Phase 4's testnet-first
// requirement. Mainnet entries still work, they're just not the default and
// DeployPanel requires an explicit confirmation before deploying to one.
export const EVM_NETWORKS: EvmNetwork[] = [
  { id: 'sepolia', label: 'Sepolia', isTestnet: true, nativeToken: 'ETH' },
  { id: 'ethereum', label: 'Ethereum', isTestnet: false, nativeToken: 'ETH' },
  { id: 'polygon_amoy', label: 'Amoy', isTestnet: true, nativeToken: 'POL' },
  { id: 'polygon', label: 'Polygon', isTestnet: false, nativeToken: 'POL' },
  { id: 'bsc_testnet', label: 'BSC Testnet', isTestnet: true, nativeToken: 'tBNB' },
  { id: 'bsc', label: 'BNB Smart Chain', isTestnet: false, nativeToken: 'BNB' },
]

// Fails closed on an unrecognized network id (bad data, future rename) —
// treats it as mainnet so a confirmation gate built on this stays showing
// rather than silently disappearing. Extracted as a pure function so it's
// unit-testable without rendering DeployPanel. The Solana side (MintLaunchPage)
// has the exact same need — see lib/networks.ts's isMainnetAmong.
export function isMainnetNetwork(networkId: string): boolean {
  return isMainnetAmong(EVM_NETWORKS, networkId)
}

interface NetworkContextValue {
  network: string
  setNetwork: (network: string) => void
}

const NetworkContext = createContext<NetworkContextValue | null>(null)

// Shared EVM network selection. Previously each page using DeployPanel kept
// its own local `network` state, so picking a network on Token Launchpad
// didn't carry over to the Contracts Hub even though both hit the same
// compile/estimate/deploy flow. Solana has no equivalent — the NFT generator
// doesn't read this.
export function NetworkProvider({ children }: { children: ReactNode }) {
  const [network, setNetwork] = useState('sepolia')
  const value = useMemo(() => ({ network, setNetwork }), [network])
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
}

export function useNetwork() {
  const ctx = useContext(NetworkContext)
  if (!ctx) throw new Error('useNetwork must be used within a NetworkProvider')
  return ctx
}
