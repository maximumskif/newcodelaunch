import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWallet } from '@solana/wallet-adapter-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { solanaTokensApi, type SolanaTokenLaunch, type TokenPoolState } from '../../lib/solanaTokensApi'
import { SolanaLiquidityPanel } from './SolanaLiquidityPanel'

vi.mock('@solana/wallet-adapter-react', () => ({ useWallet: vi.fn() }))

vi.mock('@solana/web3.js', () => ({
  Connection: vi.fn().mockImplementation(function MockConnection() {
    return { confirmTransaction: vi.fn().mockResolvedValue({ value: { err: null } }) }
  }),
  VersionedTransaction: { deserialize: vi.fn().mockReturnValue({}) },
}))

vi.mock('../../lib/solanaTokensApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/solanaTokensApi')>()
  return { ...actual, solanaTokensApi: { ...actual.solanaTokensApi, getPool: vi.fn(), preparePoolAction: vi.fn(), recordPoolAction: vi.fn() } }
})

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'tok', user: null, login: vi.fn(), updateUser: vi.fn(), logout: vi.fn() }),
}))

const CREATOR = 'FoEsHYn3QLcBMae9YmkYC57ogWamP7zUqKNeuBgh6VwG'

const launch: SolanaTokenLaunch = {
  id: 'launch-1',
  network: 'solana_devnet',
  mint_address: 'Mint111111111111111111111111111111111111111',
  transaction_signature: 'sig',
  creator_wallet: CREATOR,
  name: 'Pooled',
  symbol: 'POOL',
  decimals: 6,
  supply_raw: '1000000000000',
  metadata_uri: null,
  mint_authority_revoked: true,
  freeze_authority_revoked: true,
  metadata_locked: false,
  explorer_url: null,
  created_at: '2026-09-25T00:00:00Z',
}

const noPool: TokenPoolState = {
  programId: 'DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb',
  config: { tradeFeeRate: 2500, createPoolFee: '150000000', disableCreatePool: false },
  poolId: 'Pool111111111111111111111111111111111111111',
  pool: null,
  ownerLp: null,
  lockedLp: null,
  history: [],
}

// 100,000 POOL + 1 SOL; the creator holds 1,000 of 10,000 LP.
const livePool: TokenPoolState = {
  ...noPool,
  pool: { lpMint: 'Lp11111111111111111111111111111111111111111', tokenReserve: '100000000000', solReserve: '1000000000', lpSupply: '10000000000', lpDecimals: 9, openTime: 0 },
  ownerLp: '1000000000',
  history: [{ id: 'a1', kind: 'create', signature: 's', wallet: CREATOR, token_amount: '100000000000', sol_amount: '1000000000', lp_amount: null, created_at: '2026-09-25T00:00:00Z' }],
}

const sendTransaction = vi.fn()

function connect(wallet: string | null) {
  vi.mocked(useWallet).mockReturnValue({
    publicKey: wallet ? { toBase58: () => wallet } : null,
    sendTransaction,
  } as unknown as ReturnType<typeof useWallet>)
}

describe('SolanaLiquidityPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    connect(CREATOR)
    sendTransaction.mockResolvedValue('sig-1')
    vi.mocked(solanaTokensApi.preparePoolAction).mockResolvedValue({ transaction: 'dHg=' })
    vi.mocked(solanaTokensApi.recordPoolAction).mockResolvedValue({ action: {} as never })
  })

  it('creates a pool with exactly the amounts given, in base units, then records it', async () => {
    vi.mocked(solanaTokensApi.getPool).mockResolvedValueOnce(noPool).mockResolvedValue(livePool)
    const user = userEvent.setup()
    render(<SolanaLiquidityPanel launch={launch} />)
    expect(await screen.findByText('No pool yet')).toBeInTheDocument()
    expect(solanaTokensApi.getPool).toHaveBeenCalledWith('tok', 'launch-1', CREATOR)
    expect(screen.getByText(/Raydium charges 0.15 SOL to create a pool/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('POOL to add'), '100000')
    await user.type(screen.getByLabelText('SOL to add'), '1')
    expect(screen.getByText('Starting price: 1 POOL = 0.00001 SOL')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Create pool' }))

    await waitFor(() => expect(solanaTokensApi.recordPoolAction).toHaveBeenCalledWith('tok', 'launch-1', 'sig-1'))
    expect(solanaTokensApi.preparePoolAction).toHaveBeenCalledWith('tok', 'launch-1', {
      action: 'create',
      owner: CREATOR,
      token_amount: '100000000000',
      sol_amount: '1000000000',
    })
    expect(await screen.findByText('Pool created.')).toBeInTheDocument()
    expect(await screen.findByText('Pool live')).toBeInTheDocument()
    expect(screen.getByTestId('solana-liquidity-history')).toHaveTextContent('Created the pool with 100,000 POOL + 1 SOL')
  })

  it('adds at the pool’s price and withdraws a share of the position', async () => {
    vi.mocked(solanaTokensApi.getPool).mockResolvedValue(livePool)
    const user = userEvent.setup()
    render(<SolanaLiquidityPanel launch={launch} />)
    expect(await screen.findByText('Your share 10.00%')).toBeInTheDocument()
    await user.type(screen.getByLabelText('POOL to add'), '5000')
    expect(screen.getByText(/0.05 \(up to 1% more if the price moves\)/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add liquidity' }))
    await waitFor(() =>
      expect(solanaTokensApi.preparePoolAction).toHaveBeenCalledWith('tok', 'launch-1', { action: 'deposit', owner: CREATOR, token_amount: '5000000000' }),
    )
    await screen.findByText('Liquidity added.')

    await user.type(screen.getByLabelText('Share of your position (%)'), '50')
    // Half of 1,000 LP = 5% of the pool.
    expect(screen.getByText('You get about 5,000 POOL + 0.05 SOL')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Withdraw' }))
    await waitFor(() =>
      expect(solanaTokensApi.preparePoolAction).toHaveBeenLastCalledWith('tok', 'launch-1', { action: 'withdraw', owner: CREATOR, lp_amount: '500000000' }),
    )
  })

  it('says when the chain step worked but recording didn’t', async () => {
    vi.mocked(solanaTokensApi.getPool).mockResolvedValue(livePool)
    vi.mocked(solanaTokensApi.recordPoolAction).mockRejectedValue(new Error('RPC lagging'))
    const user = userEvent.setup()
    render(<SolanaLiquidityPanel launch={launch} />)
    await user.type(await screen.findByLabelText('POOL to add'), '10')
    await user.click(screen.getByRole('button', { name: 'Add liquidity' }))
    expect(await screen.findByText(/Done on-chain, but not recorded here: RPC lagging/)).toBeInTheDocument()
  })

  it('warns about a freeze authority, and needs a wallet to act', async () => {
    vi.mocked(solanaTokensApi.getPool).mockResolvedValue(noPool)
    connect(null)
    render(<SolanaLiquidityPanel launch={{ ...launch, freeze_authority_revoked: false }} />)
    expect(await screen.findByText(/still has a freeze authority/)).toBeInTheDocument()
    expect(screen.getByText(/Connect a Solana wallet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Create pool' })).not.toBeInTheDocument()
  })

  it('offers no withdrawal without a position', async () => {
    vi.mocked(solanaTokensApi.getPool).mockResolvedValue({ ...livePool, ownerLp: '0' })
    render(<SolanaLiquidityPanel launch={launch} />)
    expect(await screen.findByText('Pool live')).toBeInTheDocument()
    expect(screen.queryByTestId('solana-liquidity-withdraw')).not.toBeInTheDocument()
  })

  it('locks a share of the position only after a can’t-be-undone confirmation, and shows what’s locked', async () => {
    vi.mocked(solanaTokensApi.getPool)
      .mockResolvedValueOnce(livePool)
      .mockResolvedValue({
        ...livePool,
        ownerLp: '0',
        lockedLp: '1000000000',
        history: [{ ...livePool.history[0], id: 'a2', kind: 'lock', token_amount: '0', sol_amount: '0', lp_amount: '1000000000' }, ...livePool.history],
      })
    const user = userEvent.setup()
    render(<SolanaLiquidityPanel launch={launch} />)
    await user.type(await screen.findByLabelText(/Share of your position to lock/), '100')
    await user.click(screen.getByRole('button', { name: 'Lock forever…' }))
    const dialog = screen.getByRole('dialog')
    expect(dialog).toHaveTextContent('100% of your position (10.00% of the pool)')
    expect(dialog).toHaveTextContent("This can't be undone.")
    expect(solanaTokensApi.preparePoolAction).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Lock forever' }))

    await waitFor(() =>
      expect(solanaTokensApi.preparePoolAction).toHaveBeenCalledWith('tok', 'launch-1', { action: 'lock', owner: CREATOR, lp_amount: '1000000000' }),
    )
    expect(await screen.findByText('Liquidity locked for good.')).toBeInTheDocument()
    expect(screen.getByText('10.00% locked forever')).toBeInTheDocument()
    expect(screen.getByTestId('solana-liquidity-history')).toHaveTextContent('Locked 1 LP tokens for good')
  })

  it('shows the locked share to anyone, even without a position', async () => {
    vi.mocked(solanaTokensApi.getPool).mockResolvedValue({ ...livePool, ownerLp: '0', lockedLp: '5000000000' })
    render(<SolanaLiquidityPanel launch={launch} />)
    expect(await screen.findByText('50.00% locked forever')).toBeInTheDocument()
    expect(screen.queryByTestId('solana-liquidity-lock')).not.toBeInTheDocument()
  })
})
