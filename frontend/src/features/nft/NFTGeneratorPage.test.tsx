import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { nftApi, type NFTCollection } from '../../lib/nftApi'
import { NFTGeneratorPage } from './NFTGeneratorPage'

vi.mock('../../lib/nftApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/nftApi')>()
  return {
    ...actual,
    nftApi: {
      ...actual.nftApi,
      listCollections: vi.fn(),
      getCollection: vi.fn(),
      listItems: vi.fn().mockResolvedValue({ items: [] }),
    },
  }
})

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'tok', user: null, login: vi.fn(), logout: vi.fn() }),
}))

function makeCollection(id: string, name: string): NFTCollection {
  return {
    id,
    name,
    description: '',
    collection_size: 10,
    image_size: 512,
    status: 'draft',
    created_at: '2026-01-01T00:00:00Z',
    layers: [],
  }
}

describe('NFTGeneratorPage — collection-switch race', () => {
  it('ignores a stale getCollection response after switching to a different collection', async () => {
    // Regression: refreshCollection() had no guard against an out-of-order
    // response — clicking a different collection in the sidebar before the
    // previous one's fetch resolved could overwrite `collection` with the
    // wrong collection's data while the sidebar highlight already showed
    // the newer one. Same bug class already fixed in MintLaunchPage.tsx.
    const collectionOne = makeCollection('col-1', 'Collection One')
    const collectionTwo = makeCollection('col-2', 'Collection Two')

    vi.mocked(nftApi.listCollections).mockResolvedValue({ collections: [collectionOne, collectionTwo] })

    let resolveColOne!: (value: { collection: NFTCollection }) => void
    const colOnePromise = new Promise<{ collection: NFTCollection }>((resolve) => {
      resolveColOne = resolve
    })

    vi.mocked(nftApi.getCollection).mockImplementation(async (_token, id) => {
      if (id === 'col-1') return colOnePromise
      return { collection: collectionTwo }
    })

    const user = userEvent.setup()
    render(
      <MemoryRouter>
        <NFTGeneratorPage />
      </MemoryRouter>,
    )

    // Auto-selects the first collection (col-1) once the list loads — its
    // getCollection fetch is deliberately held open above.
    await screen.findByText('Collection One')

    // Switch to col-2 before col-1's fetch resolves.
    await user.click(screen.getByText('Collection Two'))
    expect(await screen.findByRole('heading', { level: 2, name: 'Collection Two' })).toBeInTheDocument()

    // Now let the stale col-1 response arrive late.
    resolveColOne({ collection: collectionOne })
    await new Promise((r) => setTimeout(r, 0))

    expect(screen.getByRole('heading', { level: 2, name: 'Collection Two' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { level: 2, name: 'Collection One' })).not.toBeInTheDocument()
  })
})
