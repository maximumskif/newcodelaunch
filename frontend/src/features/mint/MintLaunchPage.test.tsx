import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { Link, MemoryRouter, Route, Routes } from 'react-router-dom'
import { useWallet } from '@solana/wallet-adapter-react'
import { describe, expect, it, vi } from 'vitest'

import { candyMachineApi } from '../../lib/candyMachineApi'
import { nftApi, type NFTCollection, type NFTGeneratedItem } from '../../lib/nftApi'
import { projectsApi, type Project } from '../../lib/projectsApi'
import { MintLaunchPage } from './MintLaunchPage'

vi.mock('@solana/wallet-adapter-react', () => ({
  useWallet: vi.fn(),
}))

vi.mock('@solana/web3.js', () => ({
  // A vi.fn() mock invoked with `new` forwards to its implementation via
  // Reflect.construct, which requires a real constructible function — an
  // arrow function throws "is not a constructor" there even though it
  // works fine called normally.
  Connection: vi.fn().mockImplementation(function MockConnection() {
    return { confirmTransaction: vi.fn().mockResolvedValue({ value: { err: null } }) }
  }),
  VersionedTransaction: { deserialize: vi.fn().mockReturnValue({}) },
}))

vi.mock('../../lib/candyMachineApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/candyMachineApi')>()
  return {
    ...actual,
    candyMachineApi: {
      ...actual.candyMachineApi,
      prepareCollection: vi.fn(),
      prepareCandyMachine: vi.fn(),
      create: vi.fn(),
    },
  }
})

vi.mock('../../lib/nftApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/nftApi')>()
  return {
    ...actual,
    nftApi: { ...actual.nftApi, getCollection: vi.fn(), listItems: vi.fn() },
  }
})

vi.mock('../../lib/projectsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/projectsApi')>()
  return {
    ...actual,
    // list: ProjectContextBar's own "switch project" dropdown fetches this
    // independently of the page's own project-resume logic (mocked via
    // `get` below) — mocked here too so it doesn't fall through to a real,
    // unmocked network call in every test that renders the bar.
    projectsApi: { ...actual.projectsApi, get: vi.fn(), list: vi.fn().mockResolvedValue({ projects: [] }) },
  }
})

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'tok', user: null, login: vi.fn(), updateUser: vi.fn(), logout: vi.fn() }),
}))

const collection: NFTCollection = {
  id: 'col-1',
  name: 'Test Collection',
  description: '',
  collection_size: 10,
  image_size: 512,
  status: 'published',
  created_at: '2026-01-01T00:00:00Z',
  layers: [],
}

const publishedItem: NFTGeneratedItem = {
  id: 'item-1',
  token_index: 1,
  attributes: [],
  image_path: 'generated/col-1/1.png',
  ipfs_image_hash: 'QmImage',
  ipfs_metadata_hash: 'QmMeta',
}

const project: Project = {
  id: 'proj-1',
  name: 'My Drop Project',
  project_type: 'nft_collection',
  chain: 'solana',
  network: null,
  status: 'active',
  draft_data: {},
  contract_deployment: null,
  nft_collection: null,
  solana_token_launch: null,
  candy_machine_deployment: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

function renderAt(query: string) {
  return render(
    <MemoryRouter initialEntries={[`/mint${query}`]}>
      <Routes>
        <Route path="/mint" element={<MintLaunchPage />} />
      </Routes>
    </MemoryRouter>,
  )
}

describe('MintLaunchPage project linking', () => {
  it('shows the project context bar and passes project_id through to candyMachineApi.create when launched via ?project=', async () => {
    // Regression test for the end-to-end wiring: GenerateStep's "Launch Mint
    // Site" link carries ?project=<id> — this page must actually use it, or
    // launching a candy machine could never link back to the project no
    // matter what GenerateStep does on its end.
    vi.mocked(useWallet).mockReturnValue({
      publicKey: { toBase58: () => 'CreatorPublicKey11111111111111111111111111' },
      sendTransaction: vi.fn().mockResolvedValue('sig-1'),
    } as unknown as ReturnType<typeof useWallet>)
    vi.mocked(nftApi.getCollection).mockResolvedValue({ collection })
    vi.mocked(nftApi.listItems).mockResolvedValue({ items: [publishedItem] })
    vi.mocked(projectsApi.get).mockResolvedValue({ project })
    vi.mocked(candyMachineApi.prepareCollection).mockResolvedValue({
      collection_mint: 'CollMint1111111111111111111111111111111111',
      transaction: 'eA==',
    })
    vi.mocked(candyMachineApi.prepareCandyMachine).mockResolvedValue({
      candy_machine: 'CandyMachine11111111111111111111111111111',
      transactions: ['eA=='],
    })
    vi.mocked(candyMachineApi.create).mockResolvedValue({
      candy_machine: {
        id: 'cm-1',
        nft_collection_id: 'col-1',
        network: 'solana_devnet',
        collection_mint: 'CollMint1111111111111111111111111111111111',
        candy_machine: 'CandyMachine11111111111111111111111111111',
        price_sol: 0.1,
        items_available: 1,
        go_live_date: '2026-09-01T00:00:00.000Z',
        allowlist: null,
        mint_limit: null,
        creator_wallet: 'CreatorPublicKey11111111111111111111111111',
        transaction_signatures: ['sig-1'],
        explorer_url: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    })

    const user = userEvent.setup()
    renderAt('?collection=col-1&project=proj-1')

    expect(await screen.findByText('My Drop Project')).toBeInTheDocument()

    const goLiveInput = screen.getByLabelText('Go-live date')
    await user.type(goLiveInput, '2026-09-01T00:00')

    await user.click(screen.getByRole('button', { name: 'Launch Candy Machine' }))

    await waitFor(() =>
      expect(candyMachineApi.create).toHaveBeenCalledWith(
        'tok',
        expect.objectContaining({ project_id: 'proj-1' }),
      ),
    )
  })

  it('does not build the Candy Machine transaction until the collection transaction is prepared, and passes the confirmed collection_mint through', async () => {
    // Regression test for the two-step launch flow (see
    // docs/CANDY_MACHINE_BLOCKHASH_FIX_SPEC.md): prepareCandyMachine's own
    // ephemeral signer + blockhash must only be generated after the
    // collection transaction is confirmed, not alongside it — asserting
    // call order here is the actual behavior the fix depends on, not just
    // that both calls eventually happen.
    vi.mocked(useWallet).mockReturnValue({
      publicKey: { toBase58: () => 'CreatorPublicKey11111111111111111111111111' },
      sendTransaction: vi.fn().mockResolvedValue('sig-1'),
    } as unknown as ReturnType<typeof useWallet>)
    vi.mocked(nftApi.getCollection).mockResolvedValue({ collection })
    vi.mocked(nftApi.listItems).mockResolvedValue({ items: [publishedItem] })

    const callOrder: string[] = []
    vi.mocked(candyMachineApi.prepareCollection).mockImplementation(async () => {
      callOrder.push('prepareCollection')
      return { collection_mint: 'CollMint1111111111111111111111111111111111', transaction: 'eA==' }
    })
    vi.mocked(candyMachineApi.prepareCandyMachine).mockImplementation(async (_token, payload) => {
      callOrder.push('prepareCandyMachine')
      expect(payload.collection_mint).toBe('CollMint1111111111111111111111111111111111')
      return { candy_machine: 'CandyMachine11111111111111111111111111111', transactions: ['eA=='] }
    })
    vi.mocked(candyMachineApi.create).mockResolvedValue({
      candy_machine: {
        id: 'cm-1',
        nft_collection_id: 'col-1',
        network: 'solana_devnet',
        collection_mint: 'CollMint1111111111111111111111111111111111',
        candy_machine: 'CandyMachine11111111111111111111111111111',
        price_sol: 0.1,
        items_available: 1,
        go_live_date: '2026-09-01T00:00:00.000Z',
        allowlist: null,
        mint_limit: null,
        creator_wallet: 'CreatorPublicKey11111111111111111111111111',
        transaction_signatures: ['sig-1', 'sig-1'],
        explorer_url: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    })

    const user = userEvent.setup()
    renderAt('?collection=col-1')

    expect(await screen.findByText('Test Collection')).toBeInTheDocument()
    const goLiveInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement
    await user.type(goLiveInput, '2026-09-01T00:00')
    await user.click(screen.getByRole('button', { name: 'Launch Candy Machine' }))

    await waitFor(() => expect(candyMachineApi.create).toHaveBeenCalled())

    expect(callOrder).toEqual(['prepareCollection', 'prepareCandyMachine'])
    expect(candyMachineApi.create).toHaveBeenCalledWith(
      'tok',
      expect.objectContaining({
        collection_mint: 'CollMint1111111111111111111111111111111111',
        candy_machine: 'CandyMachine11111111111111111111111111111',
        transaction_signatures: ['sig-1', 'sig-1'],
      }),
    )
  })

  it('does not pass a project_id when launched without a project in context', async () => {
    vi.mocked(useWallet).mockReturnValue({
      publicKey: { toBase58: () => 'CreatorPublicKey11111111111111111111111111' },
      sendTransaction: vi.fn().mockResolvedValue('sig-1'),
    } as unknown as ReturnType<typeof useWallet>)
    vi.mocked(nftApi.getCollection).mockResolvedValue({ collection })
    vi.mocked(nftApi.listItems).mockResolvedValue({ items: [publishedItem] })
    vi.mocked(candyMachineApi.prepareCollection).mockResolvedValue({
      collection_mint: 'CollMint1111111111111111111111111111111111',
      transaction: 'eA==',
    })
    vi.mocked(candyMachineApi.prepareCandyMachine).mockResolvedValue({
      candy_machine: 'CandyMachine11111111111111111111111111111',
      transactions: ['eA=='],
    })
    vi.mocked(candyMachineApi.create).mockResolvedValue({
      candy_machine: {
        id: 'cm-1',
        nft_collection_id: 'col-1',
        network: 'solana_devnet',
        collection_mint: 'CollMint1111111111111111111111111111111111',
        candy_machine: 'CandyMachine11111111111111111111111111111',
        price_sol: 0.1,
        items_available: 1,
        go_live_date: '2026-09-01T00:00:00.000Z',
        allowlist: null,
        mint_limit: null,
        creator_wallet: 'CreatorPublicKey11111111111111111111111111',
        transaction_signatures: ['sig-1'],
        explorer_url: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    })

    const user = userEvent.setup()
    renderAt('?collection=col-1')

    expect(await screen.findByText('Test Collection')).toBeInTheDocument()
    expect(screen.queryByText('My Drop Project')).not.toBeInTheDocument()

    const goLiveInput = document.querySelector('input[type="datetime-local"]') as HTMLInputElement
    await user.type(goLiveInput, '2026-09-01T00:00')
    await user.click(screen.getByRole('button', { name: 'Launch Candy Machine' }))

    await waitFor(() =>
      expect(candyMachineApi.create).toHaveBeenCalledWith(
        'tok',
        expect.objectContaining({ project_id: undefined }),
      ),
    )
  })
})

describe('MintLaunchPage collection-fetch race', () => {
  it('ignores a stale response after navigating to a different collection before it resolves', async () => {
    // Regression: the effect fetching the collection/items had no
    // cancellation guard against collectionId changing mid-flight — an
    // out-of-order response could overwrite state with the wrong
    // collection's data, and items_available (sent to candyMachineApi.create
    // when launching) is computed from that same state.
    vi.mocked(useWallet).mockReturnValue({
      publicKey: null,
      sendTransaction: vi.fn(),
    } as unknown as ReturnType<typeof useWallet>)

    const collectionTwo: NFTCollection = { ...collection, id: 'col-2', name: 'Collection Two' }

    let resolveColOne!: (value: { collection: NFTCollection }) => void
    const colOnePromise = new Promise<{ collection: NFTCollection }>((resolve) => {
      resolveColOne = resolve
    })

    vi.mocked(nftApi.getCollection).mockImplementation(async (_token, id) => {
      if (id === 'col-1') return colOnePromise
      return { collection: collectionTwo }
    })
    vi.mocked(nftApi.listItems).mockImplementation(async (_token, id) => ({
      items: id === 'col-1' ? [publishedItem] : [{ ...publishedItem, id: 'item-2' }],
    }))

    const user = userEvent.setup()
    render(
      <MemoryRouter initialEntries={['/mint?collection=col-1']}>
        <Routes>
          <Route
            path="/mint"
            element={
              <>
                <Link to="/mint?collection=col-2">Go to collection two</Link>
                <MintLaunchPage />
              </>
            }
          />
        </Routes>
      </MemoryRouter>,
    )

    // col-1's fetch is still in flight (deliberately held open above).
    // Navigate to col-2 before it resolves — same route, so MintLaunchPage
    // stays mounted and only its collectionId search param changes.
    await user.click(screen.getByText('Go to collection two'))
    expect(await screen.findByText('Collection Two')).toBeInTheDocument()

    // Now let the stale col-1 response arrive late.
    resolveColOne({ collection })

    // Give the resolved (and, pre-fix, un-guarded) promise a chance to run
    // its .then() before asserting nothing changed.
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.getByText('Collection Two')).toBeInTheDocument()
    expect(screen.queryByText('Test Collection')).not.toBeInTheDocument()
  })
})

describe('MintLaunchPage allowlist phase', () => {
  const FAN = 'FoEsHYn3QLcBMae9YmkYC57ogWamP7zUqKNeuBgh6VwG'
  const OTHER = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

  function mockLaunchApis() {
    vi.mocked(useWallet).mockReturnValue({
      publicKey: { toBase58: () => 'CreatorPublicKey11111111111111111111111111' },
      sendTransaction: vi.fn().mockResolvedValue('sig-1'),
    } as unknown as ReturnType<typeof useWallet>)
    vi.mocked(nftApi.getCollection).mockResolvedValue({ collection })
    vi.mocked(nftApi.listItems).mockResolvedValue({ items: [publishedItem] })
    vi.mocked(candyMachineApi.prepareCollection).mockResolvedValue({ collection_mint: 'CollMint1', transaction: 'eA==' })
    vi.mocked(candyMachineApi.prepareCandyMachine).mockResolvedValue({ candy_machine: 'Candy1', transactions: ['eA=='] })
    vi.mocked(candyMachineApi.create).mockResolvedValue({
      candy_machine: {
        id: 'cm-1',
        nft_collection_id: 'col-1',
        network: 'solana_devnet',
        collection_mint: 'CollMint1',
        candy_machine: 'Candy1',
        price_sol: 0.1,
        items_available: 1,
        go_live_date: '2026-09-02T00:00:00.000Z',
        allowlist: { price_sol: 0.05, start_date: '2026-09-01T00:00:00.000Z', size: 2 },
        mint_limit: null,
        creator_wallet: 'CreatorPublicKey11111111111111111111111111',
        transaction_signatures: ['sig-1'],
        explorer_url: null,
        created_at: '2026-01-01T00:00:00Z',
      },
    })
  }

  it('sends the parsed allowlist phase through every launch step', async () => {
    mockLaunchApis()
    const user = userEvent.setup()
    renderAt('?collection=col-1')

    await user.type(await screen.findByLabelText('Go-live date'), '2026-09-02T00:00')
    await user.click(screen.getByLabelText(/Add an allowlist phase/))
    await user.type(screen.getByLabelText(/Allowlisted wallets/), `${FAN}\n${OTHER}, ${FAN}`)
    expect(screen.getByText('2 wallets (1 duplicate removed)')).toBeInTheDocument()
    await user.type(screen.getByLabelText('Allowlist start'), '2026-09-01T00:00')
    await user.click(screen.getByRole('button', { name: 'Launch Candy Machine' }))

    const allowlist = {
      addresses: [FAN, OTHER],
      price_sol: 0.05,
      start_date: new Date('2026-09-01T00:00').toISOString(),
    }
    await waitFor(() => expect(candyMachineApi.create).toHaveBeenCalledWith('tok', expect.objectContaining({ allowlist })))
    expect(candyMachineApi.prepareCollection).toHaveBeenCalledWith('tok', expect.objectContaining({ allowlist }))
    expect(candyMachineApi.prepareCandyMachine).toHaveBeenCalledWith('tok', expect.objectContaining({ allowlist }))
  })

  it('blocks launching with an invalid address or an allowlist that starts after public minting', async () => {
    mockLaunchApis()
    const user = userEvent.setup()
    renderAt('?collection=col-1')

    await user.type(await screen.findByLabelText('Go-live date'), '2026-09-02T00:00')
    await user.click(screen.getByLabelText(/Add an allowlist phase/))
    await user.type(screen.getByLabelText(/Allowlisted wallets/), '0xNotSolana')
    expect(screen.getByText(/Not a Solana wallet address: 0xNotSolana/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Launch Candy Machine' })).toBeDisabled()

    await user.clear(screen.getByLabelText(/Allowlisted wallets/))
    await user.type(screen.getByLabelText(/Allowlisted wallets/), FAN)
    await user.type(screen.getByLabelText('Allowlist start'), '2026-09-03T00:00')
    expect(screen.getByText('The allowlist phase must start before the public go-live date')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Launch Candy Machine' })).toBeDisabled()
  })

  it('sends an optional per-wallet mint limit through every launch step, and blocks an invalid one', async () => {
    mockLaunchApis()
    const user = userEvent.setup()
    renderAt('?collection=col-1')

    await user.type(await screen.findByLabelText('Go-live date'), '2026-09-02T00:00')
    await user.type(screen.getByLabelText(/Max mints per wallet/), '0')
    expect(screen.getByText(/whole number from 1 to 65535/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Launch Candy Machine' })).toBeDisabled()

    await user.clear(screen.getByLabelText(/Max mints per wallet/))
    await user.type(screen.getByLabelText(/Max mints per wallet/), '3')
    await user.click(screen.getByRole('button', { name: 'Launch Candy Machine' }))

    await waitFor(() => expect(candyMachineApi.create).toHaveBeenCalledWith('tok', expect.objectContaining({ mint_limit: 3 })))
    expect(candyMachineApi.prepareCollection).toHaveBeenCalledWith('tok', expect.objectContaining({ mint_limit: 3 }))
    expect(candyMachineApi.prepareCandyMachine).toHaveBeenCalledWith('tok', expect.objectContaining({ mint_limit: 3 }))
  })
})
