import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
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
    candyMachineApi: { ...actual.candyMachineApi, prepare: vi.fn(), create: vi.fn() },
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
    projectsApi: { ...actual.projectsApi, get: vi.fn() },
  }
})

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'tok', user: null, login: vi.fn(), logout: vi.fn() }),
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
    vi.mocked(candyMachineApi.prepare).mockResolvedValue({
      collection_mint: 'CollMint1111111111111111111111111111111111',
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

  it('does not pass a project_id when launched without a project in context', async () => {
    vi.mocked(useWallet).mockReturnValue({
      publicKey: { toBase58: () => 'CreatorPublicKey11111111111111111111111111' },
      sendTransaction: vi.fn().mockResolvedValue('sig-1'),
    } as unknown as ReturnType<typeof useWallet>)
    vi.mocked(nftApi.getCollection).mockResolvedValue({ collection })
    vi.mocked(nftApi.listItems).mockResolvedValue({ items: [publishedItem] })
    vi.mocked(candyMachineApi.prepare).mockResolvedValue({
      collection_mint: 'CollMint1111111111111111111111111111111111',
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
