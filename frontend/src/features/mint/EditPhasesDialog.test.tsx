import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWallet } from '@solana/wallet-adapter-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { candyMachineApi, type CreatorDrop } from '../../lib/candyMachineApi'
import { EditPhasesDialog } from './EditPhasesDialog'
import { toLocalInput } from './useAllowlistPhase'

vi.mock('@solana/wallet-adapter-react', () => ({ useWallet: vi.fn() }))

vi.mock('@solana/web3.js', () => ({
  // Constructible (not an arrow function) — see MintLaunchPage.test.tsx.
  Connection: vi.fn().mockImplementation(function MockConnection() {
    return { confirmTransaction: vi.fn().mockResolvedValue({ value: { err: null } }) }
  }),
  VersionedTransaction: { deserialize: vi.fn().mockReturnValue({}) },
}))

vi.mock('../../lib/candyMachineApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/candyMachineApi')>()
  return {
    ...actual,
    candyMachineApi: { ...actual.candyMachineApi, getAllowlist: vi.fn(), prepareUpdate: vi.fn(), applyUpdate: vi.fn() },
  }
})

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'tok', user: null, login: vi.fn(), updateUser: vi.fn(), logout: vi.fn() }),
}))

const CREATOR = 'FoEsHYn3QLcBMae9YmkYC57ogWamP7zUqKNeuBgh6VwG'
const FAN = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

const drop: CreatorDrop = {
  id: 'cm-1',
  nft_collection_id: 'col-1',
  network: 'solana_devnet',
  collection_mint: 'Coll1',
  candy_machine: 'Candy1',
  price_sol: 0.2,
  items_available: 5,
  go_live_date: '2026-10-02T12:00:00.000Z',
  allowlist: { price_sol: 0.05, start_date: '2026-10-01T12:00:00.000Z', size: 1 },
  mint_limit: null,
  creator_wallet: CREATOR,
  transaction_signatures: ['sig-0'],
  explorer_url: null,
  created_at: '2026-09-01T00:00:00Z',
  collection_name: 'Cool Apes',
  is_live: false,
  phase: 'allowlist',
  live_status_available: true,
  items_redeemed: 1,
  items_remaining: 4,
  revenue_min_sol: 0.05,
  revenue_max_sol: 0.2,
}

const sendTransaction = vi.fn()

function connect(wallet: string | null) {
  vi.mocked(useWallet).mockReturnValue({
    publicKey: wallet ? { toBase58: () => wallet } : null,
    sendTransaction,
  } as unknown as ReturnType<typeof useWallet>)
}

describe('EditPhasesDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(candyMachineApi.getAllowlist).mockResolvedValue({ addresses: [FAN] })
    vi.mocked(candyMachineApi.prepareUpdate).mockResolvedValue({ transaction: 'eA==' })
    vi.mocked(candyMachineApi.applyUpdate).mockResolvedValue({ candy_machine: drop })
    sendTransaction.mockResolvedValue('sig-update')
  })

  it('starts from the live configuration and saves an edit through prepare -> wallet -> apply', async () => {
    connect(CREATOR)
    const onSaved = vi.fn()
    const user = userEvent.setup()
    render(<EditPhasesDialog drop={drop} onClose={vi.fn()} onSaved={onSaved} />)

    expect(await screen.findByLabelText(/Allowlisted wallets/)).toHaveValue(FAN)
    expect(screen.getByLabelText('Public price (SOL)')).toHaveValue(0.2)
    expect(screen.getByLabelText('Public go-live')).toHaveValue(toLocalInput(drop.go_live_date))

    await user.clear(screen.getByLabelText('Public price (SOL)'))
    await user.type(screen.getByLabelText('Public price (SOL)'), '0.3')
    await user.type(screen.getByLabelText(/Allowlisted wallets/), `\n${CREATOR}`)
    await user.click(screen.getByRole('button', { name: 'Save phases' }))

    await waitFor(() => expect(onSaved).toHaveBeenCalled())
    const edit = {
      price_sol: 0.3,
      go_live_date: drop.go_live_date,
      allowlist: { addresses: [FAN, CREATOR], price_sol: 0.05, start_date: drop.allowlist!.start_date },
    }
    expect(candyMachineApi.prepareUpdate).toHaveBeenCalledWith('tok', 'cm-1', edit)
    expect(sendTransaction).toHaveBeenCalledTimes(1)
    expect(candyMachineApi.applyUpdate).toHaveBeenCalledWith('tok', 'cm-1', { ...edit, transaction_signature: 'sig-update' })
  })

  it('can remove the allowlist phase', async () => {
    connect(CREATOR)
    const user = userEvent.setup()
    render(<EditPhasesDialog drop={drop} onClose={vi.fn()} onSaved={vi.fn()} />)

    await user.click(await screen.findByLabelText(/Add an allowlist phase/))
    await user.click(screen.getByRole('button', { name: 'Save phases' }))

    await waitFor(() => expect(candyMachineApi.applyUpdate).toHaveBeenCalled())
    expect(vi.mocked(candyMachineApi.prepareUpdate).mock.calls[0][2].allowlist).toBeUndefined()
  })

  it('only lets the wallet that launched the drop save', async () => {
    connect(FAN)
    render(<EditPhasesDialog drop={drop} onClose={vi.fn()} onSaved={vi.fn()} />)

    expect(await screen.findByText(/Connect the wallet that launched this drop/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Save phases' })).toBeDisabled()
  })

  it('shows why an apply failed and saves nothing', async () => {
    connect(CREATOR)
    vi.mocked(candyMachineApi.applyUpdate).mockRejectedValue(new Error("On-chain public guard doesn't match the launch being recorded: price"))
    const onSaved = vi.fn()
    const user = userEvent.setup()
    render(<EditPhasesDialog drop={drop} onClose={vi.fn()} onSaved={onSaved} />)

    await user.click(await screen.findByRole('button', { name: 'Save phases' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("doesn't match")
    expect(onSaved).not.toHaveBeenCalled()
    expect(screen.getByRole('button', { name: 'Save phases' })).toBeEnabled()
  })

  it('starts from the current mint limit and can clear it', async () => {
    connect(CREATOR)
    const user = userEvent.setup()
    render(<EditPhasesDialog drop={{ ...drop, mint_limit: 3 }} onClose={vi.fn()} onSaved={vi.fn()} />)

    const field = await screen.findByLabelText(/Max mints per wallet/)
    expect(field).toHaveValue('3')
    await user.clear(field)
    await user.click(screen.getByRole('button', { name: 'Save phases' }))

    await waitFor(() => expect(candyMachineApi.prepareUpdate).toHaveBeenCalled())
    expect(vi.mocked(candyMachineApi.prepareUpdate).mock.calls[0][2].mint_limit).toBeUndefined()
  })
})
