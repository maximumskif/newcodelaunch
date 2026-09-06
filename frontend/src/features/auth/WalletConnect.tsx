import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import bs58 from 'bs58'
import { useState } from 'react'
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Dropdown } from '../../components/ui/Dropdown'
import { IconChevronDown } from '../../components/ui/icons'
import { apiClient, type Chain } from '../../lib/apiClient'
import { useAuth } from './AuthContext'

export function WalletConnect() {
  const { user, accessToken, login, logout } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [didCopy, setDidCopy] = useState(false)

  const { address, isConnected: isEvmConnected } = useAccount()
  const { connectors, connect } = useConnect()
  const { disconnectAsync: disconnectEvm } = useDisconnect()
  const { signMessageAsync } = useSignMessage()

  const {
    publicKey,
    signMessage,
    connected: isSolanaConnected,
    disconnect: disconnectSolana,
  } = useWallet()
  const { setVisible: setSolanaModalVisible } = useWalletModal()

  const authenticate = async (chain: Chain, walletAddress: string, sign: (message: string) => Promise<string>) => {
    setError(null)
    setIsAuthenticating(true)
    try {
      const { message, nonce } = await apiClient.requestNonce(walletAddress, chain)
      const signature = await sign(message)
      const { access_token, user: authUser } = await apiClient.verify(walletAddress, chain, signature, nonce)
      login(access_token, authUser)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Authentication failed')
    } finally {
      setIsAuthenticating(false)
    }
  }

  const handleConnectEvm = () => {
    // Prefer the plain injected connector when a wallet is already injected
    // (window.ethereum present): metaMask() wraps the full MetaMask SDK,
    // which does its own extension-detection/deep-link/QR-code flow rather
    // than just talking to an already-present injected provider — real
    // friction for anyone with a non-MetaMask injected wallet (Rabby,
    // Coinbase Wallet, etc.) or, as found while building real e2e coverage
    // (see frontend/e2e/README.md), for automating a real signer at all.
    // Falls back to the MetaMask-SDK connector, which can still deep-link
    // to the mobile app or prompt install, when nothing is injected.
    const hasInjectedProvider = typeof window !== 'undefined' && 'ethereum' in window
    const connector = (hasInjectedProvider ? connectors.find((c) => c.id === 'injected') : undefined) ?? connectors[0]
    if (!connector) {
      setError('No EVM wallet connector available — is MetaMask installed?')
      return
    }
    connect({ connector })
  }

  const handleSignEvm = async () => {
    if (!address) return
    await authenticate('evm', address, (message) => signMessageAsync({ message }))
  }

  const handleConnectSolana = () => setSolanaModalVisible(true)

  const handleSignSolana = async () => {
    if (!publicKey || !signMessage) {
      setError('Connected Solana wallet does not support message signing')
      return
    }
    const walletAddress = publicKey.toBase58()
    await authenticate('solana', walletAddress, async (message) => {
      const signatureBytes = await signMessage(new TextEncoder().encode(message))
      return bs58.encode(signatureBytes)
    })
  }

  const handleLogout = async () => {
    logout()
    if (isEvmConnected) await disconnectEvm()
    if (isSolanaConnected) disconnectSolana()
  }

  if (accessToken && user) {
    const handleCopy = () => {
      void navigator.clipboard.writeText(user.wallet_address)
      setDidCopy(true)
      setTimeout(() => setDidCopy(false), 1500)
    }

    return (
      <Dropdown
        align="right"
        trigger={
          <>
            <Badge tone="success">
              {user.chain.toUpperCase()} · {user.wallet_address.slice(0, 6)}…{user.wallet_address.slice(-4)}
            </Badge>
            <IconChevronDown className="h-3.5 w-3.5" />
          </>
        }
      >
        <div className="px-3 py-2">
          <p className="text-xs text-ink-faint">Signed in as</p>
          <p className="mt-0.5 break-all font-mono text-xs text-ink">{user.wallet_address}</p>
        </div>
        <button
          type="button"
          onClick={handleCopy}
          className="block w-full rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-surface-hover"
        >
          {didCopy ? 'Copied' : 'Copy address'}
        </button>
        <button
          type="button"
          onClick={handleLogout}
          className="block w-full rounded-md px-3 py-2 text-left text-sm text-danger hover:bg-surface-hover"
        >
          Disconnect
        </button>
      </Dropdown>
    )
  }

  return (
    <div className="flex flex-col items-end gap-2 text-sm">
      <div className="flex gap-2">
        {!isEvmConnected ? (
          <Button variant="primary" onClick={handleConnectEvm}>
            Connect EVM Wallet
          </Button>
        ) : (
          <Button variant="primary" onClick={handleSignEvm} isLoading={isAuthenticating}>
            Sign in with {address?.slice(0, 6)}…{address?.slice(-4)}
          </Button>
        )}
        {!isSolanaConnected ? (
          <Button variant="primary" onClick={handleConnectSolana}>
            Connect Solana Wallet
          </Button>
        ) : (
          <Button variant="primary" onClick={handleSignSolana} isLoading={isAuthenticating}>
            Sign in with {publicKey?.toBase58().slice(0, 6)}…
          </Button>
        )}
      </div>
      {error && <p className="max-w-xs text-right text-danger">{error}</p>}
    </div>
  )
}
