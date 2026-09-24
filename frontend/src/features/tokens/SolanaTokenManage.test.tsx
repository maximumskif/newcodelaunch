import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWallet } from '@solana/wallet-adapter-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { solanaTokensApi, type LiveTokenState, type SolanaTokenLaunch } from '../../lib/solanaTokensApi'
import { SolanaTokenManage } from './SolanaTokenManage'

vi.mock('@solana/wallet-adapter-react', () => ({ useWallet: vi.fn() }))

vi.mock('@solana/web3.js', () => ({
  // Constructible (not an arrow function) — see MintLaunchPage.test.tsx.
  Connection: vi.fn().mockImplementation(function MockConnection() {
    return { confirmTransaction: vi.fn().mockResolvedValue({ value: { err: null } }) }
  }),
  VersionedTransaction: { deserialize: vi.fn().mockReturnValue({}) },
}))

vi.mock('../../lib/solanaTokensApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/solanaTokensApi')>()
  return { ...actual, solanaTokensApi: { ...actual.solanaTokensApi, refresh: vi.fn(), prepareAction: vi.fn() } }
})

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'tok', user: null, login: vi.fn(), logout: vi.fn() }),
}))

const CREATOR = 'FoEsHYn3QLcBMae9YmkYC57ogWamP7zUqKNeuBgh6VwG'

const launch: SolanaTokenLaunch = {
  id: 'launch-1',
  network: 'solana_devnet',
  mint_address: 'Mint111111111111111111111111111111111111111',
  transaction_signature: 'sig',
  creator_wallet: CREATOR,
  name: 'Keep',
  symbol: 'KEEP',
  decimals: 2,
  supply_raw: '100000',
  metadata_uri: null,
  mint_authority_revoked: false,
  freeze_authority_revoked: false,
  explorer_url: null,
  created_at: '2026-09-24T00:00:00Z',
}

function liveState(overrides: Partial<LiveTokenState> = {}, token: Partial<SolanaTokenLaunch> = {}): LiveTokenState {
  return { token: { ...launch, ...token }, mint_authority: CREATOR, freeze_authority: CREATOR, ...overrides }
}

const sendTransaction = vi.fn()

function connect(wallet: string) {
  vi.mocked(useWallet).mockReturnValue({ publicKey: { toBase58: () => wallet }, sendTransaction } as unknown as ReturnType<typeof useWallet>)
}

describe('SolanaTokenManage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendTransaction.mockResolvedValue('sig-action')
    vi.mocked(solanaTokensApi.prepareAction).mockResolvedValue({ transaction: 'eA==', authority: CREATOR })
  })

  it('mints more for the authority, then re-reads the token from the chain', async () => {
    connect(CREATOR)
    vi.mocked(solanaTokensApi.refresh)
      .mockResolvedValueOnce(liveState())
      .mockResolvedValueOnce(liveState({}, { supply_raw: '150000' }))
    const onUpdated = vi.fn()
    const user = userEvent.setup()
    render(<SolanaTokenManage launch={launch} onUpdated={onUpdated} />)

    expect(await screen.findByText('1,000')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/Mint more/), '500')
    await user.click(screen.getByRole('button', { name: 'Mint' }))

    expect(await screen.findByText('Minted.')).toBeInTheDocument()
    expect(solanaTokensApi.prepareAction).toHaveBeenCalledWith('tok', 'launch-1', { action: 'mint', amount: '500' })
    expect(sendTransaction).toHaveBeenCalledTimes(1)
    expect(screen.getByText('1,500')).toBeInTheDocument()
    expect(onUpdated).toHaveBeenLastCalledWith(expect.objectContaining({ supply_raw: '150000' }))
  })

  it('revokes only after an explicit confirmation', async () => {
    connect(CREATOR)
    vi.mocked(solanaTokensApi.refresh)
      .mockResolvedValueOnce(liveState())
      .mockResolvedValueOnce(liveState({ mint_authority: null }, { mint_authority_revoked: true }))
    const user = userEvent.setup()
    render(<SolanaTokenManage launch={launch} onUpdated={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Fix supply…' }))
    expect(solanaTokensApi.prepareAction).not.toHaveBeenCalled()
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('can’t be undone')
    await user.click(within(dialog).getByRole('button', { name: 'Revoke mint authority' }))

    await waitFor(() => expect(solanaTokensApi.prepareAction).toHaveBeenCalledWith('tok', 'launch-1', { action: 'revokeMint' }))
    expect(await screen.findByText('Supply is now fixed.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Mint' })).not.toBeInTheDocument()
  })

  it('names the authority wallet and disables actions for anyone else', async () => {
    connect('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')
    vi.mocked(solanaTokensApi.refresh).mockResolvedValue(liveState())
    render(<SolanaTokenManage launch={launch} onUpdated={vi.fn()} />)

    expect(await screen.findByText(/Connect the mint authority wallet \(FoEs…6VwG\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Fix supply…' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Revoke freeze authority…' })).toBeDisabled()
  })

  it('says so when there is nothing left to manage', async () => {
    connect(CREATOR)
    vi.mocked(solanaTokensApi.refresh).mockResolvedValue(liveState({ mint_authority: null, freeze_authority: null }))
    render(<SolanaTokenManage launch={launch} onUpdated={vi.fn()} />)
    expect(await screen.findByText(/nothing left to manage/)).toBeInTheDocument()
  })
})
