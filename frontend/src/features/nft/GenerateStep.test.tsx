import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NFTCollection, NFTGeneratedItem, NFTGenerationJob } from '../../lib/nftApi'
import { nftApi } from '../../lib/nftApi'
import { GenerateStep } from './GenerateStep'

vi.mock('../../lib/nftApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/nftApi')>()
  return {
    ...actual,
    nftApi: {
      ...actual.nftApi,
      listItems: vi.fn(),
      getItemMetadata: vi.fn(),
      publishItem: vi.fn(),
      generate: vi.fn(),
      getGenerationJob: vi.fn(),
    },
  }
})

const collection: NFTCollection = {
  id: 'col-1',
  name: 'Test Collection',
  description: 'A test collection',
  collection_size: 10,
  image_size: 512,
  status: 'generated',
  created_at: '2026-01-01T00:00:00Z',
  layers: [],
}

const draftItem: NFTGeneratedItem = {
  id: 'item-1',
  token_index: 1,
  attributes: [{ trait_type: 'Background', value: 'Blue' }],
  image_path: 'generated/col-1/1.png',
  ipfs_image_hash: null,
  ipfs_metadata_hash: null,
}

describe('GenerateStep collection-switch race', () => {
  it('ignores a stale listItems response after the collection prop changes', async () => {
    // Regression: refreshItems() had no guard against an out-of-order
    // response — if `collection.id` changes (e.g. NFTGeneratorPage.tsx
    // switching the selected collection) before a previous listItems() call
    // resolves, the stale response could overwrite `items` with the wrong
    // collection's items. Same bug class already fixed in MintLaunchPage.tsx
    // and NFTGeneratorPage.tsx's refreshCollection.
    const collectionTwo: NFTCollection = { ...collection, id: 'col-2' }
    const itemFromCollectionOne: NFTGeneratedItem = { ...draftItem, token_index: 111 }
    const itemFromCollectionTwo: NFTGeneratedItem = { ...draftItem, id: 'item-2', token_index: 222 }

    let resolveColOne!: (value: { items: NFTGeneratedItem[] }) => void
    const colOnePromise = new Promise<{ items: NFTGeneratedItem[] }>((resolve) => {
      resolveColOne = resolve
    })

    vi.mocked(nftApi.listItems).mockImplementation(async (_token, id) => {
      if (id === 'col-1') return colOnePromise
      return { items: [itemFromCollectionTwo] }
    })

    const { rerender } = render(
      <MemoryRouter>
        <GenerateStep token="tok" collection={collection} />
      </MemoryRouter>,
    )

    // col-1's fetch is deliberately held open. Switch to col-2 before it resolves.
    rerender(
      <MemoryRouter>
        <GenerateStep token="tok" collection={collectionTwo} />
      </MemoryRouter>,
    )
    expect(await screen.findByText('#222')).toBeInTheDocument()

    // Now let the stale col-1 response arrive late.
    resolveColOne({ items: [itemFromCollectionOne] })
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.getByText('#222')).toBeInTheDocument()
    expect(screen.queryByText('#111')).not.toBeInTheDocument()
  })
})

describe('GenerateStep metadata preview', () => {
  beforeEach(() => {
    vi.mocked(nftApi.listItems).mockResolvedValue({ items: [draftItem] })
  })

  it('refetches metadata after publishing instead of showing the stale unpublished preview', async () => {
    const user = userEvent.setup()

    vi.mocked(nftApi.getItemMetadata).mockResolvedValueOnce({
      published: false,
      metadata: { name: 'Test Collection #1', description: 'A test collection', image: null, attributes: draftItem.attributes },
    })

    render(
      <MemoryRouter>
        <GenerateStep token="tok" collection={collection} />
      </MemoryRouter>,
    )

    await screen.findByText('#1')

    await user.click(screen.getByText('Preview metadata'))
    await waitFor(() => expect(nftApi.getItemMetadata).toHaveBeenCalledTimes(1))
    expect(await screen.findByText(/Preview only/)).toBeInTheDocument()

    const publishedItem = { ...draftItem, ipfs_image_hash: 'QmImageHash', ipfs_metadata_hash: 'QmMetaHash' }
    vi.mocked(nftApi.publishItem).mockResolvedValueOnce({ item: publishedItem })
    vi.mocked(nftApi.getItemMetadata).mockResolvedValueOnce({
      published: true,
      metadata: {
        name: 'Test Collection #1',
        description: 'A test collection',
        image: 'ipfs://QmImageHash',
        attributes: draftItem.attributes,
        created_at: '2026-08-14T00:00:00Z',
      },
      metadata_ipfs_hash: 'QmMetaHash',
    })

    await user.click(screen.getByText('Publish'))

    // The bug: publishing dropped the item from `items` state correctly but
    // left the old preview cached, so a still-open preview kept showing
    // image:null forever. This asserts a second real fetch happens instead.
    await waitFor(() => expect(nftApi.getItemMetadata).toHaveBeenCalledTimes(2))
    expect(await screen.findByText('Real content pinned to IPFS.')).toBeInTheDocument()
  })
})

describe('GenerateStep rarity distribution toggle', () => {
  beforeEach(() => {
    vi.mocked(nftApi.listItems).mockResolvedValue({ items: [draftItem] })
  })

  it('is hidden until the toggle is clicked', async () => {
    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <GenerateStep token="tok" collection={collection} />
      </MemoryRouter>,
    )

    await screen.findByText('#1')
    expect(screen.queryByText(/actual trait spread/)).not.toBeInTheDocument()

    await user.click(screen.getByText('Show rarity distribution'))
    expect(await screen.findByText(/actual trait spread/)).toBeInTheDocument()
    expect(screen.getByText('Background')).toBeInTheDocument()

    await user.click(screen.getByText('Hide rarity distribution'))
    expect(screen.queryByText(/actual trait spread/)).not.toBeInTheDocument()
  })
})

describe('GenerateStep generate button', () => {
  const collectionWithLayer: NFTCollection = {
    ...collection,
    layers: [
      { id: 'layer-1', name: 'Background', order_index: 0, traits: [{ id: 't1', name: 'Blue', rarity_weight: 50, image_path: 'x.png' }] },
    ],
  }

  it('polls the background job, showing live progress, until it finishes and refreshes items', async () => {
    // Regression coverage for the switch from a single blocking POST
    // (which used to return the finished items directly) to a background
    // job the client must poll — see nft_generation_jobs.py. Real timers
    // (not fake ones): Testing Library's findBy*/waitFor do their own
    // internal setTimeout-based polling that isn't fake-timer-aware, so
    // mixing the two here just hangs — real timers plus a generous
    // per-assertion timeout is simpler and still fast (well under a second
    // per poll tick).
    const user = userEvent.setup()
    vi.mocked(nftApi.listItems).mockResolvedValue({ items: [] })

    const baseJob: NFTGenerationJob = {
      id: 'job-1',
      collection_id: collectionWithLayer.id,
      requested_count: 2,
      items_generated: 0,
      status: 'queued',
      error: null,
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    const runningJob: NFTGenerationJob = { ...baseJob, status: 'running', items_generated: 1 }
    const doneJob: NFTGenerationJob = { ...baseJob, status: 'done', items_generated: 2 }

    vi.mocked(nftApi.generate).mockResolvedValue({ job: baseJob })
    vi.mocked(nftApi.getGenerationJob).mockResolvedValueOnce({ job: runningJob }).mockResolvedValueOnce({ job: doneJob })

    render(
      <MemoryRouter>
        <GenerateStep token="tok" collection={collectionWithLayer} />
      </MemoryRouter>,
    )
    await screen.findByText('Generate') // wait for the mount-time listItems() to settle first
    const listItemsCallsBeforeGenerate = vi.mocked(nftApi.listItems).mock.calls.length

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText(/Generating 0 \/ 2/)).toBeInTheDocument()
    expect(await screen.findByText(/Generating 1 \/ 2/, {}, { timeout: 3000 })).toBeInTheDocument()
    await waitFor(() => expect(screen.queryByText(/Generating/)).not.toBeInTheDocument(), { timeout: 3000 })
    // Exactly one more real refetch once the job finished, to pick up the
    // now-real items — not zero (which would leave the grid stuck showing
    // nothing generated) and not more than one.
    expect(vi.mocked(nftApi.listItems).mock.calls.length - listItemsCallsBeforeGenerate).toBe(1)
  }, 10_000)

  it('shows the job error instead of a generic message when generation fails', async () => {
    const user = userEvent.setup()
    vi.mocked(nftApi.listItems).mockResolvedValue({ items: [] })

    const failedJob: NFTGenerationJob = {
      id: 'job-2',
      collection_id: collectionWithLayer.id,
      requested_count: 1,
      items_generated: 0,
      status: 'failed',
      error: 'Simulated compositing failure',
      created_at: '2026-01-01T00:00:00Z',
      updated_at: '2026-01-01T00:00:00Z',
    }
    vi.mocked(nftApi.generate).mockResolvedValue({ job: failedJob })

    render(
      <MemoryRouter>
        <GenerateStep token="tok" collection={collectionWithLayer} />
      </MemoryRouter>,
    )

    await user.click(screen.getByRole('button', { name: 'Generate' }))
    expect(await screen.findByText('Simulated compositing failure')).toBeInTheDocument()
  })
})

describe('GenerateStep "Launch Mint Site" link', () => {
  const publishedItem: NFTGeneratedItem = {
    ...draftItem,
    ipfs_image_hash: 'QmImageHash',
    ipfs_metadata_hash: 'QmMetaHash',
  }

  beforeEach(() => {
    vi.mocked(nftApi.listItems).mockResolvedValue({ items: [publishedItem] })
  })

  it('carries the project id through to MintLaunchPage when arrived at via a project', async () => {
    // Regression test: launching a Candy Machine from a project-linked NFT
    // collection is the only real way a Project ever gets a candy_machine
    // link (see projectTypes.ts) — if this link drops ?project=, that
    // linking can never happen no matter what MintLaunchPage.tsx itself does.
    render(
      <MemoryRouter>
        <GenerateStep token="tok" collection={collection} projectId="proj-1" />
      </MemoryRouter>,
    )

    const link = await screen.findByText('Launch Mint Site')
    expect(link.closest('a')).toHaveAttribute('href', `/mint?collection=${collection.id}&project=proj-1`)
  })

  it('omits the project param when there is no project in context', async () => {
    render(
      <MemoryRouter>
        <GenerateStep token="tok" collection={collection} />
      </MemoryRouter>,
    )

    const link = await screen.findByText('Launch Mint Site')
    expect(link.closest('a')).toHaveAttribute('href', `/mint?collection=${collection.id}`)
  })
})
