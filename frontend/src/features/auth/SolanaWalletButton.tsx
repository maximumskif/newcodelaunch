import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'

import { Button } from '../../components/ui/Button'

// Connect/disconnect a Solana wallet, nothing more — for public pages
// (the mint storefront), where a buyer only needs a wallet to sign with,
// not an account on this app.
export function SolanaWalletButton() {
  const { publicKey, disconnect } = useWallet()
  const { setVisible } = useWalletModal()

  if (!publicKey) {
    return (
      <Button variant="primary" size="sm" onClick={() => setVisible(true)}>
        Connect Solana Wallet
      </Button>
    )
  }
  const address = publicKey.toBase58()
  return (
    <span className="flex items-center gap-2">
      <span className="inline-flex items-center gap-2 rounded-full border border-success/30 bg-success/10 px-3 py-1 text-xs text-success">
        <span className="h-1.5 w-1.5 rounded-full bg-success" />
        <span className="font-mono">{address.slice(0, 4)}…{address.slice(-4)}</span>
      </span>
      <Button variant="secondary" size="sm" onClick={() => void disconnect()}>
        Disconnect
      </Button>
    </span>
  )
}
