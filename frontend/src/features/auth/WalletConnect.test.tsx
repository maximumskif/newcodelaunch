import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi'

import { apiClient } from '../../lib/apiClient'
import { AuthProvider } from './AuthContext'
import { WalletConnect } from './WalletConnect'

vi.mock('wagmi', () => ({
  useAccount: vi.fn(),
  useConnect: vi.fn(),
  useDisconnect: vi.fn(),
  useSignMessage: vi.fn(),
}))

vi.mock('@solana/wallet-adapter-react', () => ({ useWallet: vi.fn() }))
vi.mock('@solana/wallet-adapter-react-ui', () => ({ useWalletModal: vi.fn() }))

const STORAGE_KEY = 'nocode-launchpad.auth'

const AUTHENTICATED_EVM_ADDRESS = '0xAaAa000000000000000000000000000000aAaa'

function seedStoredSession(walletAddress: string) {
  localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify({
      accessToken: 'stored-token',
      user: { id: 'user-1', wallet_address: walletAddress, chain: 'evm', created_at: '2026-01-01T00:00:00Z' },
    }),
  )
}

function mockDefaults() {
  vi.mocked(useConnect).mockReturnValue({ connectors: [], connect: vi.fn() } as unknown as ReturnType<typeof useConnect>)
  vi.mocked(useDisconnect).mockReturnValue({ disconnectAsync: vi.fn() } as unknown as ReturnType<typeof useDisconnect>)
  vi.mocked(useSignMessage).mockReturnValue({ signMessageAsync: vi.fn() } as unknown as ReturnType<typeof useSignMessage>)
  vi.mocked(useWallet).mockReturnValue({
    publicKey: null,
    signMessage: undefined,
    connected: false,
    disconnect: vi.fn(),
  } as unknown as ReturnType<typeof useWallet>)
  vi.mocked(useWalletModal).mockReturnValue({ setVisible: vi.fn() } as unknown as ReturnType<typeof useWalletModal>)
}

describe('WalletConnect — wallet-switch re-auth', () => {
  beforeEach(() => {
    localStorage.clear()
    mockDefaults()
  })

  it('stays signed in while the connected wallet still matches the session', () => {
    seedStoredSession(AUTHENTICATED_EVM_ADDRESS)
    vi.mocked(useAccount).mockReturnValue({
      address: AUTHENTICATED_EVM_ADDRESS,
      isConnected: true,
    } as unknown as ReturnType<typeof useAccount>)

    render(
      <AuthProvider>
        <WalletConnect />
      </AuthProvider>,
    )

    expect(screen.getByText(/EVM/)).toBeInTheDocument()
    expect(screen.queryByText('Connect EVM Wallet')).not.toBeInTheDocument()
  })

  it('signs out automatically when the connected wallet switches to a different address', () => {
    // Regression: nothing in this app previously watched for the connected
    // wallet changing after sign-in — the JWT session stayed pinned to the
    // original wallet even after the user switched accounts in their
    // extension, so a later deploy/launch would sign with the new wallet
    // while still being recorded under the old wallet's identity.
    seedStoredSession(AUTHENTICATED_EVM_ADDRESS)
    vi.mocked(useAccount).mockReturnValue({
      address: '0xBbBb000000000000000000000000000000bBbb',
      isConnected: true,
    } as unknown as ReturnType<typeof useAccount>)

    render(
      <AuthProvider>
        <WalletConnect />
      </AuthProvider>,
    )

    // No longer showing the signed-in dropdown (address badge + Disconnect) —
    // back to a "sign in" prompt for the newly-connected wallet instead.
    expect(screen.getByText(/Sign in with/)).toBeInTheDocument()
    expect(screen.queryByText('Copy address')).not.toBeInTheDocument()
    expect(screen.getByText(/wallet changed/i)).toBeInTheDocument()
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull()
  })
})

describe('WalletConnect — linked wallets', () => {
  const SOLANA_ADDRESS = 'FoEsHYn3QLcBMae9YmkYC57ogWamP7zUqKNeuBgh6VwG'

  beforeEach(() => {
    localStorage.clear()
    vi.restoreAllMocks()
    mockDefaults()
    seedStoredSession(AUTHENTICATED_EVM_ADDRESS)
    vi.mocked(useAccount).mockReturnValue({
      address: AUTHENTICATED_EVM_ADDRESS,
      isConnected: true,
    } as unknown as ReturnType<typeof useAccount>)
  })

  function renderMenu() {
    render(
      <AuthProvider>
        <WalletConnect />
      </AuthProvider>,
    )
  }

  it('offers to connect the other chain’s wallet when none is connected', async () => {
    const user = userEvent.setup()
    renderMenu()
    await user.click(screen.getByText(/EVM · /))
    expect(screen.getByText('Linked wallets')).toBeInTheDocument()
    // A session stored before wallet linking still lists its own wallet.
    expect(screen.getByText(/\(signed in\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Connect a Solana wallet to link it' })).toBeInTheDocument()
  })

  it('links the connected Solana wallet with a signed nonce and updates the stored session', async () => {
    const signMessage = vi.fn().mockResolvedValue(new Uint8Array(64).fill(1))
    vi.mocked(useWallet).mockReturnValue({
      publicKey: { toBase58: () => SOLANA_ADDRESS },
      signMessage,
      connected: true,
      disconnect: vi.fn(),
    } as unknown as ReturnType<typeof useWallet>)
    vi.spyOn(apiClient, 'requestNonce').mockResolvedValue({ message: 'Sign in: n1', nonce: 'n1' })
    const linked = {
      id: 'user-1',
      wallet_address: AUTHENTICATED_EVM_ADDRESS,
      chain: 'evm' as const,
      created_at: '2026-01-01T00:00:00Z',
      wallets: [
        { wallet_address: AUTHENTICATED_EVM_ADDRESS, chain: 'evm' as const, linked_at: '2026-01-01T00:00:00Z' },
        { wallet_address: SOLANA_ADDRESS, chain: 'solana' as const, linked_at: '2026-09-24T00:00:00Z' },
      ],
    }
    const linkWallet = vi.spyOn(apiClient, 'linkWallet').mockResolvedValue({ user: linked, merged: { projects: 2, nft_collections: 1 } })
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByText(/EVM · /))
    await user.click(screen.getByRole('button', { name: /Link Solana wallet FoEs…6VwG/ }))

    await waitFor(() => expect(linkWallet).toHaveBeenCalled())
    expect(signMessage).toHaveBeenCalledWith(new TextEncoder().encode('Sign in: n1'))
    expect(linkWallet).toHaveBeenCalledWith('stored-token', expect.objectContaining({ wallet_address: SOLANA_ADDRESS, chain: 'solana', nonce: 'n1' }))
    expect(await screen.findByText(/3 items from that wallet's account moved into this one/)).toBeInTheDocument()
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY)!).user.wallets).toHaveLength(2)
    // Linked now — no second link offer, and it can be unlinked.
    expect(screen.queryByRole('button', { name: /Link Solana wallet/ })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: `Unlink solana wallet ${SOLANA_ADDRESS}` })).toBeInTheDocument()
  })

  it('unlinks a non-session wallet', async () => {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify({
        accessToken: 'stored-token',
        user: {
          id: 'user-1',
          wallet_address: AUTHENTICATED_EVM_ADDRESS,
          chain: 'evm',
          created_at: '2026-01-01T00:00:00Z',
          wallets: [
            { wallet_address: AUTHENTICATED_EVM_ADDRESS, chain: 'evm', linked_at: '2026-01-01T00:00:00Z' },
            { wallet_address: SOLANA_ADDRESS, chain: 'solana', linked_at: '2026-09-24T00:00:00Z' },
          ],
        },
      }),
    )
    const unlink = vi.spyOn(apiClient, 'unlinkWallet').mockResolvedValue({
      user: {
        id: 'user-1',
        wallet_address: AUTHENTICATED_EVM_ADDRESS,
        chain: 'evm',
        created_at: '2026-01-01T00:00:00Z',
        wallets: [{ wallet_address: AUTHENTICATED_EVM_ADDRESS, chain: 'evm', linked_at: '2026-01-01T00:00:00Z' }],
      },
    })
    const user = userEvent.setup()
    renderMenu()

    await user.click(screen.getByText(/EVM · /))
    // The session wallet has no unlink control.
    expect(screen.queryByRole('button', { name: new RegExp(`Unlink evm wallet`) })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: `Unlink solana wallet ${SOLANA_ADDRESS}` }))

    expect(unlink).toHaveBeenCalledWith('stored-token', 'solana', SOLANA_ADDRESS)
    await waitFor(() => expect(screen.queryByText(/SOLANA · FoEsHY/)).not.toBeInTheDocument())
  })
})
