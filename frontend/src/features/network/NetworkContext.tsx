import { createContext, useContext, useMemo, useState, type ReactNode } from 'react'

export interface EvmNetwork {
  id: string
  label: string
}

export const EVM_NETWORKS: EvmNetwork[] = [
  { id: 'ethereum', label: 'Ethereum' },
  { id: 'polygon', label: 'Polygon' },
  { id: 'bsc', label: 'BNB Smart Chain' },
]

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
  const [network, setNetwork] = useState('ethereum')
  const value = useMemo(() => ({ network, setNetwork }), [network])
  return <NetworkContext.Provider value={value}>{children}</NetworkContext.Provider>
}

export function useNetwork() {
  const ctx = useContext(NetworkContext)
  if (!ctx) throw new Error('useNetwork must be used within a NetworkProvider')
  return ctx
}
