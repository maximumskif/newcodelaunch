import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import bs58 from 'bs58'
import { useEffect, useState } from 'react'
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Dropdown } from '../../components/ui/Dropdown'
import { IconChevronDown } from '../../components/ui/icons'
import { InlineError } from '../../components/ui/InlineError'
import { apiClient, type Chain } from '../../lib/apiClient'
import { useAuth } from './AuthContext'

export function WalletConnect() {
  const { user, accessToken, login, updateUser, logout } = useAuth()
  const [error, setError] = useState<string | null>(null)
  const [isAuthenticating, setIsAuthenticating] = useState(false)
  const [didCopy, setDidCopy] = useState(false)
  const [linkNotice, setLinkNotice] = useState<string | null>(null)
  const [isLinking, setIsLinking] = useState(false)

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

  // The JWT session is established once, at sign-in, and never re-validated
  // against the currently connected wallet — nothing else in this app
  // watches for the connected address changing. Without this, switching
  // accounts in MetaMask/Phantom (without disconnecting) leaves every
  // deploy/launch flow signing with the new wallet while still recording
  // that action under the old wallet's JWT identity, with no warning. Force
  // a sign-out the moment the connected wallet for the session's own chain
  // no longer matches who's actually signed in, so the user has to
  // re-authenticate (and every authenticated call fails safely in the
  // meantime) rather than silently drifting.
  useEffect(() => {
    if (!user || !accessToken) return
    if (user.chain === 'evm' && address && address.toLowerCase() !== user.wallet_address.toLowerCase()) {
      // This IS the "synchronize with an external system" case the rule's
      // own guidance carves out: `address` comes from wagmi's
      // wallet-connection state, not a prop this component owns, so
      // there's no "derive during render" alternative — the whole point is
      // reacting when that external system's value changes out from under
      // an already-signed-in session.
      logout()
      // oxlint-disable-next-line react/set-state-in-effect
      setError('Your connected wallet changed — please sign in again.')
    }
  }, [address, user, accessToken, logout])

  useEffect(() => {
    if (!user || !accessToken) return
    if (user.chain === 'solana' && publicKey && publicKey.toBase58() !== user.wallet_address) {
      // Same reasoning as the EVM effect above, for the Solana
      // wallet-adapter's publicKey.
      logout()
      // oxlint-disable-next-line react/set-state-in-effect
      setError('Your connected wallet changed — please sign in again.')
    }
  }, [publicKey, user, accessToken, logout])

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

  // Link the connected wallet of the *other* chain family to this account.
  // The wallet signs a fresh nonce to prove it's yours; if it already has its
  // own account, the server merges that account into this one.
  const linkWallet = async (chain: Chain, walletAddress: string, sign: (message: string) => Promise<string>) => {
    if (!accessToken) return
    setError(null)
    setLinkNotice(null)
    setIsLinking(true)
    try {
      const { message, nonce } = await apiClient.requestNonce(walletAddress, chain)
      const signature = await sign(message)
      const { user: updated, merged } = await apiClient.linkWallet(accessToken, { wallet_address: walletAddress, chain, signature, nonce })
      updateUser(updated)
      const movedCount = Object.values(merged).reduce((total, count) => total + count, 0)
      setLinkNotice(
        movedCount > 0
          ? `Linked — ${movedCount} item${movedCount === 1 ? '' : 's'} from that wallet's account moved into this one.`
          : 'Wallet linked.',
      )
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Linking failed')
    } finally {
      setIsLinking(false)
    }
  }

  const unlinkWallet = async (chain: Chain, walletAddress: string) => {
    if (!accessToken) return
    setError(null)
    setLinkNotice(null)
    try {
      const { user: updated } = await apiClient.unlinkWallet(accessToken, chain, walletAddress)
      updateUser(updated)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unlinking failed')
    }
  }

  const handleLogout = async () => {
    logout()
    if (isEvmConnected) await disconnectEvm()
    if (isSolanaConnected) disconnectSolana()
  }

  if (accessToken && user) {
    // Sessions from before wallet linking stored a user without `wallets`.
    const linkedWallets = user.wallets ?? [{ wallet_address: user.wallet_address, chain: user.chain, linked_at: user.created_at }]
    const isLinked = (chain: Chain, walletAddress: string) =>
      linkedWallets.some((wallet) => wallet.chain === chain && wallet.wallet_address.toLowerCase() === walletAddress.toLowerCase())
    const solanaAddress = publicKey?.toBase58()
    // The other chain family's connected wallet, if it isn't linked yet.
    const linkCandidate =
      user.chain === 'evm' && solanaAddress && signMessage && !isLinked('solana', solanaAddress)
        ? {
            label: `Solana wallet ${solanaAddress.slice(0, 4)}…${solanaAddress.slice(-4)}`,
            link: () =>
              linkWallet('solana', solanaAddress, async (message) => bs58.encode(await signMessage(new TextEncoder().encode(message)))),
          }
        : user.chain === 'solana' && address && !isLinked('evm', address)
          ? {
              label: `EVM wallet ${address.slice(0, 6)}…${address.slice(-4)}`,
              link: () => linkWallet('evm', address, (message) => signMessageAsync({ message })),
            }
          : null
    const otherChainAction =
      user.chain === 'evm' && !isSolanaConnected
        ? { label: 'Connect a Solana wallet to link it', connect: handleConnectSolana }
        : user.chain === 'solana' && !isEvmConnected
          ? { label: 'Connect an EVM wallet to link it', connect: handleConnectEvm }
          : null

    const handleCopy = () => {
      void navigator.clipboard.writeText(user.wallet_address)
      setDidCopy(true)
      setTimeout(() => setDidCopy(false), 1500)
    }

    return (
      <Dropdown
        align="right"
        closeOnSelect={false}
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
        <div className="border-t border-border px-3 py-2">
          <p className="text-xs text-ink-faint">Linked wallets</p>
          <ul className="mt-1 space-y-1">
            {linkedWallets.map((wallet) => {
              const isSession = wallet.chain === user.chain && wallet.wallet_address === user.wallet_address
              return (
                <li key={`${wallet.chain}:${wallet.wallet_address}`} className="flex items-center justify-between gap-2 text-xs">
                  <span className="font-mono text-ink">
                    {wallet.chain.toUpperCase()} · {wallet.wallet_address.slice(0, 6)}…{wallet.wallet_address.slice(-4)}
                    {isSession && <span className="ml-1 font-sans text-ink-faint">(signed in)</span>}
                  </span>
                  {!isSession && (
                    <button
                      type="button"
                      onClick={() => void unlinkWallet(wallet.chain, wallet.wallet_address)}
                      aria-label={`Unlink ${wallet.chain} wallet ${wallet.wallet_address}`}
                      className="text-danger hover:underline"
                    >
                      Unlink
                    </button>
                  )}
                </li>
              )
            })}
          </ul>
          {linkCandidate ? (
            <div className="mt-2 space-y-1">
              <Button variant="secondary" size="sm" className="w-full" isLoading={isLinking} onClick={() => void linkCandidate.link()}>
                Link {linkCandidate.label}
              </Button>
              <p className="text-[11px] leading-snug text-ink-faint">
                You'll sign a message with it. If it already has its own account, that account's projects and launches
                move into this one.
              </p>
            </div>
          ) : (
            otherChainAction && (
              <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={otherChainAction.connect}>
                {otherChainAction.label}
              </Button>
            )
          )}
          {linkNotice && <p className="mt-1 text-xs text-success">{linkNotice}</p>}
          {error && <p className="mt-1 text-xs text-danger" role="alert">{error}</p>}
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
      <div className="flex flex-wrap justify-end gap-2">
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
      {error && <InlineError className="max-w-xs text-right text-danger">{error}</InlineError>}
    </div>
  )
}
