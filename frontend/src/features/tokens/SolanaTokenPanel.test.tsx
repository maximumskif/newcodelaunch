import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWallet } from '@solana/wallet-adapter-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { solanaTokensApi, type SolanaTokenLaunch } from '../../lib/solanaTokensApi'
import { SolanaTokenPanel } from './SolanaTokenPanel'

vi.mock('@solana/wallet-adapter-react', () => ({
  useWallet: vi.fn(),
}))

vi.mock('@solana/web3.js', () => ({
  // Constructible (not an arrow function) — see MintLaunchPage.test.tsx.
  Connection: vi.fn().mockImplementation(function MockConnection() {
    return { confirmTransaction: vi.fn().mockResolvedValue({ value: { err: null } }) }
  }),
  VersionedTransaction: { deserialize: vi.fn().mockReturnValue({}) },
}))

vi.mock('../../lib/solanaTokensApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/solanaTokensApi')>()
  return {
    ...actual,
    solanaTokensApi: { prepare: vi.fn(), record: vi.fn(), list: vi.fn() },
  }
})

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'tok', user: null, login: vi.fn(), logout: vi.fn() }),
}))

const CREATOR = 'Creator1111111111111111111111111111111111111'

const launched: SolanaTokenLaunch = {
  id: 'launch-1',
  network: 'solana_devnet',
  mint_address: 'Mint111111111111111111111111111111111111111',
  transaction_signature: 'sig-1',
  creator_wallet: CREATOR,
  name: 'My Token',
  symbol: 'MTK',
  decimals: 6,
  supply_raw: '1000000000',
  metadata_uri: null,
  mint_authority_revoked: true,
  freeze_authority_revoked: true,
  explorer_url: 'https://explorer.solana.com/address/Mint111?cluster=devnet',
  created_at: '2026-09-24T00:00:00Z',
}

function mockWallet(connected: boolean) {
  const sendTransaction = vi.fn().mockResolvedValue('sig-1')
  vi.mocked(useWallet).mockReturnValue({
    publicKey: connected ? { toBase58: () => CREATOR } : null,
    sendTransaction,
  } as unknown as ReturnType<typeof useWallet>)
  return sendTransaction
}

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Token name'), 'My Token')
  await user.type(screen.getByLabelText('Symbol'), 'mtk')
  await user.clear(screen.getByLabelText('Initial supply (whole tokens)'))
  await user.type(screen.getByLabelText('Initial supply (whole tokens)'), '1,000')
  await user.clear(screen.getByLabelText('Decimals'))
  await user.type(screen.getByLabelText('Decimals'), '6')
}

describe('SolanaTokenPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(solanaTokensApi.list).mockResolvedValue({ tokens: [] })
    vi.mocked(solanaTokensApi.prepare).mockResolvedValue({ mint: launched.mint_address, transaction: 'dHg=', metadata_uri: '' })
    vi.mocked(solanaTokensApi.record).mockResolvedValue({ token: launched })
  })

  it('prepares, has the wallet sign, then records — and shows the launched token', async () => {
    const user = userEvent.setup()
    const sendTransaction = mockWallet(true)
    render(<SolanaTokenPanel />)

    await fillForm(user)
    await user.click(screen.getByLabelText(/Fixed supply/))
    await user.click(screen.getByRole('button', { name: 'Launch token' }))

    await waitFor(() => expect(screen.getByText(/My Token \(MTK\) launched/)).toBeInTheDocument())
    expect(solanaTokensApi.prepare).toHaveBeenCalledWith('tok', {
      network: 'solana_devnet',
      creator_wallet: CREATOR,
      name: 'My Token',
      // Upper-cased as typed, commas stripped from the supply.
      symbol: 'MTK',
      decimals: 6,
      supply: '1000',
      description: '',
      logo: null,
      revoke_mint_authority: false,
      revoke_freeze_authority: true,
    })
    expect(sendTransaction).toHaveBeenCalledTimes(1)
    expect(solanaTokensApi.record).toHaveBeenCalledWith('tok', {
      network: 'solana_devnet',
      mint_address: launched.mint_address,
      transaction_signature: 'sig-1',
      creator_wallet: CREATOR,
      name: 'My Token',
      symbol: 'MTK',
      metadata_uri: '',
    })
    expect(screen.getByText(/1,000 tokens/)).toBeInTheDocument()
  })

  it('never records a launch whose transaction the wallet rejected', async () => {
    const user = userEvent.setup()
    const sendTransaction = mockWallet(true)
    sendTransaction.mockRejectedValueOnce(new Error('User rejected the request.'))
    render(<SolanaTokenPanel />)

    await fillForm(user)
    await user.click(screen.getByRole('button', { name: 'Launch token' }))

    expect(await screen.findByRole('alert')).toHaveTextContent('User rejected the request.')
    expect(solanaTokensApi.record).not.toHaveBeenCalled()
  })

  it('keeps Launch disabled without a wallet, or with an invalid form', async () => {
    const user = userEvent.setup()
    mockWallet(false)
    const { unmount } = render(<SolanaTokenPanel />)
    await fillForm(user)
    expect(screen.getByRole('button', { name: 'Launch token' })).toBeDisabled()
    unmount()

    mockWallet(true)
    render(<SolanaTokenPanel />)
    await user.type(screen.getByLabelText('Token name'), 'My Token')
    await user.type(screen.getByLabelText('Symbol'), 'MTK')
    await user.clear(screen.getByLabelText('Initial supply (whole tokens)'))
    await user.type(screen.getByLabelText('Initial supply (whole tokens)'), '20000000000')
    expect(screen.getByText(/supply can be at most 18,446,744,073 tokens/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Launch token' })).toBeDisabled()
  })

  it('requires the mainnet confirmation before launching on Solana Mainnet', async () => {
    const user = userEvent.setup()
    mockWallet(true)
    render(<SolanaTokenPanel />)
    await fillForm(user)

    await user.click(screen.getByRole('button', { name: 'Solana Mainnet' }))
    expect(screen.getByRole('button', { name: 'Launch token' })).toBeDisabled()
    await user.click(screen.getByRole('checkbox', { name: /Solana Mainnet/ }))
    expect(screen.getByRole('button', { name: 'Launch token' })).toBeEnabled()
  })

  it('lists past launches with their supply and authority status', async () => {
    mockWallet(true)
    vi.mocked(solanaTokensApi.list).mockResolvedValue({
      tokens: [{ ...launched, mint_authority_revoked: false, freeze_authority_revoked: false }],
    })
    render(<SolanaTokenPanel />)

    expect(await screen.findByText('Mintable')).toBeInTheDocument()
    expect(screen.getByText('Freezable')).toBeInTheDocument()
    expect(screen.getByText('1,000')).toBeInTheDocument()
  })
})
