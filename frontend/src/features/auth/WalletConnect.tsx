import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import bs58 from 'bs58'
import { useState } from 'react'
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { apiClient, type Chain } from '../../lib/apiClient'
import { useAuth } from './AuthContext'

export function WalletConnect() {
  const { user, accessToken, login, logout } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [isAuthenticating, setIsAuthenticating] = useState(false)

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
    const connector = connectors[0]
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
    return (
      <div className="flex items-center gap-3 text-sm">
        <Badge tone="success">
          {user.chain.toUpperCase()} · {user.wallet_address.slice(0, 6)}…{user.wallet_address.slice(-4)}
        </Badge>
        <Button variant="secondary" size="sm" onClick={handleLogout}>
          Disconnect
        </Button>
      </div>
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
