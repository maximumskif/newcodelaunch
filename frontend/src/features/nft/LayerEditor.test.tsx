import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NFTCollection } from '../../lib/nftApi'
import { nftApi } from '../../lib/nftApi'
import { LayerEditor } from './LayerEditor'

vi.mock('../../lib/nftApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/nftApi')>()
  return {
    ...actual,
    nftApi: {
      ...actual.nftApi,
      deleteLayer: vi.fn(),
      reorderLayers: vi.fn(),
    },
  }
})

const collection: NFTCollection = {
  id: 'col-1',
  name: 'Test Collection',
  description: '',
  collection_size: 10,
  image_size: 512,
  status: 'draft',
  created_at: '2026-01-01T00:00:00Z',
  layers: [
    { id: 'layer-1', name: 'Background', order_index: 0, traits: [] },
    { id: 'layer-2', name: 'Foreground', order_index: 1, traits: [] },
  ],
}

beforeEach(() => {
  vi.mocked(nftApi.deleteLayer).mockReset()
  vi.mocked(nftApi.reorderLayers).mockReset()
})

describe('deleting a layer', () => {
  it('requires confirmation before calling the API', async () => {
    const user = userEvent.setup()
    const onChange = vi.fn()
    render(<LayerEditor token="tok" collection={collection} onChange={onChange} />)

    const deleteButtons = screen.getAllByLabelText('Delete layer')
    await user.click(deleteButtons[0])

    // Clicking the trigger alone must not delete anything yet.
    expect(nftApi.deleteLayer).not.toHaveBeenCalled()
    expect(await screen.findByText('Delete layer "Background"?')).toBeInTheDocument()

    const dialog = screen.getByRole('dialog')
    await user.click(within(dialog).getByRole('button', { name: 'Delete layer' }))

    await waitFor(() => expect(nftApi.deleteLayer).toHaveBeenCalledWith('tok', 'layer-1'))
    expect(onChange).toHaveBeenCalled()
  })

  it('cancelling the confirmation leaves the layer untouched', async () => {
    const user = userEvent.setup()
    render(<LayerEditor token="tok" collection={collection} onChange={vi.fn()} />)

    await user.click(screen.getAllByLabelText('Delete layer')[0])
    await user.click(screen.getByRole('button', { name: 'Cancel' }))

    expect(nftApi.deleteLayer).not.toHaveBeenCalled()
    expect(screen.queryByText('Delete layer "Background"?')).not.toBeInTheDocument()
  })
})

describe('reordering layers', () => {
  it('moving the first layer down sends the swapped id order', async () => {
    const user = userEvent.setup()
    vi.mocked(nftApi.reorderLayers).mockResolvedValue({ layers: [] })
    const onChange = vi.fn()
    render(<LayerEditor token="tok" collection={collection} onChange={onChange} />)

    await user.click(screen.getAllByLabelText('Move layer down')[0])

    await waitFor(() =>
      expect(nftApi.reorderLayers).toHaveBeenCalledWith('tok', 'col-1', ['layer-2', 'layer-1']),
    )
    expect(onChange).toHaveBeenCalled()
  })

  it('disables move-up on the first layer and move-down on the last', () => {
    render(<LayerEditor token="tok" collection={collection} onChange={vi.fn()} />)

    const moveUpButtons = screen.getAllByLabelText('Move layer up')
    const moveDownButtons = screen.getAllByLabelText('Move layer down')
    expect(moveUpButtons[0]).toBeDisabled() // layer-1, first
    expect(moveUpButtons[1]).toBeEnabled() // layer-2
    expect(moveDownButtons[0]).toBeEnabled() // layer-1
    expect(moveDownButtons[1]).toBeDisabled() // layer-2, last
  })
})
