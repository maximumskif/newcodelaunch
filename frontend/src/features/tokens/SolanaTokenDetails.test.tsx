import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useWallet } from '@solana/wallet-adapter-react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { solanaTokensApi, type SolanaTokenLaunch, type TokenMetadata } from '../../lib/solanaTokensApi'
import { SolanaTokenDetails } from './SolanaTokenDetails'

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
  return {
    ...actual,
    solanaTokensApi: { ...actual.solanaTokensApi, getMetadata: vi.fn(), prepareMetadataUpdate: vi.fn(), refresh: vi.fn() },
  }
})

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'tok', user: null, login: vi.fn(), updateUser: vi.fn(), logout: vi.fn() }),
}))

const AUTHORITY = 'FoEsHYn3QLcBMae9YmkYC57ogWamP7zUqKNeuBgh6VwG'

const launch = { id: 'launch-1', network: 'solana_devnet' } as SolanaTokenLaunch

const metadata: TokenMetadata = {
  name: 'Old Name',
  symbol: 'OLD',
  uri: 'https://gw/ipfs/QmMeta',
  update_authority: AUTHORITY,
  is_mutable: true,
  description: 'Old words',
  image: 'https://gw/ipfs/QmLogo',
}

const sendTransaction = vi.fn()

function connect(wallet: string) {
  vi.mocked(useWallet).mockReturnValue({ publicKey: { toBase58: () => wallet }, sendTransaction } as unknown as ReturnType<typeof useWallet>)
}

describe('SolanaTokenDetails', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    sendTransaction.mockResolvedValue('sig')
    vi.mocked(solanaTokensApi.getMetadata).mockResolvedValue(metadata)
    vi.mocked(solanaTokensApi.prepareMetadataUpdate).mockResolvedValue({ transaction: 'eA==', authority: AUTHORITY, metadata_uri: 'x' })
    vi.mocked(solanaTokensApi.refresh).mockResolvedValue({
      token: { ...launch, name: 'New Name' } as SolanaTokenLaunch,
      mint_authority: null,
      freeze_authority: null,
    })
  })

  it('starts from the current metadata and saves an edit through the update authority', async () => {
    connect(AUTHORITY)
    const onUpdated = vi.fn()
    const user = userEvent.setup()
    render(<SolanaTokenDetails launch={launch} onUpdated={onUpdated} />)

    expect(await screen.findByLabelText('Name')).toHaveValue('Old Name')
    expect(screen.getByLabelText('Description')).toHaveValue('Old words')
    expect(screen.getByRole('img', { name: 'Old Name logo' })).toHaveAttribute('src', 'https://gw/ipfs/QmLogo')
    expect(screen.getByRole('button', { name: 'Save details' })).toBeDisabled() // nothing changed yet

    await user.clear(screen.getByLabelText('Name'))
    await user.type(screen.getByLabelText('Name'), 'New Name')
    await user.click(screen.getByRole('button', { name: 'Save details' }))

    expect(await screen.findByText('Details updated.')).toBeInTheDocument()
    expect(solanaTokensApi.prepareMetadataUpdate).toHaveBeenCalledWith('tok', 'launch-1', {
      name: 'New Name',
      symbol: 'OLD',
      description: 'Old words',
      logo: null,
      lock: false,
    })
    expect(sendTransaction).toHaveBeenCalledTimes(1)
    expect(onUpdated).toHaveBeenCalledWith(expect.objectContaining({ name: 'New Name' }))
  })

  it('locks only after an explicit confirmation', async () => {
    connect(AUTHORITY)
    const user = userEvent.setup()
    render(<SolanaTokenDetails launch={launch} onUpdated={vi.fn()} />)

    await user.click(await screen.findByRole('button', { name: 'Lock metadata…' }))
    expect(solanaTokensApi.prepareMetadataUpdate).not.toHaveBeenCalled()
    await user.click(within(screen.getByRole('dialog')).getByRole('button', { name: 'Lock metadata' }))
    await waitFor(() =>
      expect(solanaTokensApi.prepareMetadataUpdate).toHaveBeenCalledWith('tok', 'launch-1', expect.objectContaining({ lock: true })),
    )
  })

  it('shows locked metadata as final, with no edit controls', async () => {
    connect(AUTHORITY)
    vi.mocked(solanaTokensApi.getMetadata).mockResolvedValue({ ...metadata, is_mutable: false })
    render(<SolanaTokenDetails launch={launch} onUpdated={vi.fn()} />)
    expect(await screen.findByText(/Metadata is locked/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save details' })).not.toBeInTheDocument()
  })

  it('is read-only for anyone but the update authority', async () => {
    connect('9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM')
    const user = userEvent.setup()
    render(<SolanaTokenDetails launch={launch} onUpdated={vi.fn()} />)
    expect(await screen.findByText(/Connect the update authority wallet \(FoEs…6VwG\)/)).toBeInTheDocument()
    await user.type(screen.getByLabelText('Name'), 'x')
    expect(screen.getByRole('button', { name: 'Save details' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Lock metadata…' })).toBeDisabled()
  })
})
