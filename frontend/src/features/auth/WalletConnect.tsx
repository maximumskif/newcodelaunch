import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import bs58 from 'bs58'
import { useState } from 'react'
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi'

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
        <span className="rounded-full bg-emerald-500/10 px-3 py-1 text-emerald-400">
          {user.chain.toUpperCase()} · {user.wallet_address.slice(0, 6)}…{user.wallet_address.slice(-4)}
        </span>
        <button onClick={handleLogout} className="rounded-md border border-white/10 px-3 py-1 hover:bg-white/5">
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <div className="flex flex-col items-end gap-2 text-sm">
      <div className="flex gap-2">
        {!isEvmConnected ? (
          <button
            onClick={handleConnectEvm}
            className="rounded-md bg-purple-600 px-3 py-1.5 font-medium hover:bg-purple-500"
          >
            Connect EVM Wallet
          </button>
        ) : (
          <button
            onClick={handleSignEvm}
            disabled={isAuthenticating}
            className="rounded-md bg-purple-600 px-3 py-1.5 font-medium hover:bg-purple-500 disabled:opacity-50"
          >
            Sign in with {address?.slice(0, 6)}…{address?.slice(-4)}
          </button>
        )}
        {!isSolanaConnected ? (
          <button
            onClick={handleConnectSolana}
            className="rounded-md bg-violet-700 px-3 py-1.5 font-medium hover:bg-violet-600"
          >
            Connect Solana Wallet
          </button>
        ) : (
          <button
            onClick={handleSignSolana}
            disabled={isAuthenticating}
            className="rounded-md bg-violet-700 px-3 py-1.5 font-medium hover:bg-violet-600 disabled:opacity-50"
          >
            Sign in with {publicKey?.toBase58().slice(0, 6)}…
          </button>
        )}
      </div>
      {error && <p className="max-w-xs text-right text-red-400">{error}</p>}
    </div>
  )
}
