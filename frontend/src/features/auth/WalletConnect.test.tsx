import { useWallet } from '@solana/wallet-adapter-react'
import { useWalletModal } from '@solana/wallet-adapter-react-ui'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { useAccount, useConnect, useDisconnect, useSignMessage } from 'wagmi'

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
