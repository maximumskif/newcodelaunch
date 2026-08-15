import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NFTCollection, NFTGeneratedItem } from '../../lib/nftApi'
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
