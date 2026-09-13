import { ConnectionProvider, WalletProvider } from '@solana/wallet-adapter-react'
import { WalletModalProvider } from '@solana/wallet-adapter-react-ui'
import { PhantomWalletAdapter } from '@solana/wallet-adapter-wallets'
import { useMemo, type ReactNode } from 'react'

import '@solana/wallet-adapter-react-ui/styles.css'

// `||`, not `??` — an unset Vite build arg (e.g. a Docker build that didn't
// forward this one) bakes in an explicit empty string, not `undefined`, and
// `??` only falls through on `null`/`undefined`. An empty string is never a
// usable RPC URL, so it should fall through to the default the same way an
// actually-missing value does.
const SOLANA_RPC_URL = import.meta.env.VITE_SOLANA_RPC_URL || 'https://api.mainnet-beta.solana.com'

export function SolanaWalletProvider({ children }: { children: ReactNode }) {
  const wallets = useMemo(() => [new PhantomWalletAdapter()], [])

  return (
    <ConnectionProvider endpoint={SOLANA_RPC_URL}>
      <WalletProvider wallets={wallets} autoConnect>
        <WalletModalProvider>{children}</WalletModalProvider>
      </WalletProvider>
    </ConnectionProvider>
  )
}
