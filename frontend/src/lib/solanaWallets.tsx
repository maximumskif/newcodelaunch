import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets'
import { useMemo, type ReactNode } from 'react'

import '@solana/wallet-adapter-react-ui/styles.css'

// Same definition as candyMachineApi.ts's mainnet entry (see rpcUrls.ts,
// which now also does the empty-build-arg normalization this file used to
// do inline) — the two used to read the same network's URL separately.
import { SOLANA_MAINNET_RPC_URL } from './rpcUrls'

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], [])

  return (
    <ConnectionProvider endpoint={SOLANA_MAINNET_RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
