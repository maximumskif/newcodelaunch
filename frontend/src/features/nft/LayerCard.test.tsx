import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { NFTLayer } from '../../lib/nftApi'
import { nftApi } from '../../lib/nftApi'
import { LayerCard } from './LayerCard'

vi.mock('../../lib/nftApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/nftApi')>()
  return {
    ...actual,
    nftApi: {
      ...actual.nftApi,
      addTrait: vi.fn(),
      updateTrait: vi.fn(),
      deleteTrait: vi.fn(),
    },
  }
})

const layer: NFTLayer = {
  id: 'layer-1',
  name: 'Background',
  order_index: 0,
  traits: [{ id: 'trait-1', name: 'Blue', rarity_weight: 40, image_path: 'traits/col-1/layer-1/blue.png' }],
}

function renderLayerCard(overrides: Partial<Parameters<typeof LayerCard>[0]> = {}) {
  const props = {
    token: 'tok',
    layer,
    onTraitAdded: vi.fn(),
    onRename: vi.fn(),
    onDelete: vi.fn(),
    ...overrides,
  }
  render(<LayerCard {...props} />)
  return props
}

beforeEach(() => {
  vi.mocked(nftApi.addTrait).mockReset()
  vi.mocked(nftApi.updateTrait).mockReset()
  vi.mocked(nftApi.deleteTrait).mockReset()
})

describe('trait edit', () => {
  it('clicking a trait thumbnail opens the edit panel prefilled, and Save calls updateTrait', async () => {
    const user = userEvent.setup()
    vi.mocked(nftApi.updateTrait).mockResolvedValue({
      trait: { ...layer.traits[0], name: 'Sky Blue', rarity_weight: 80 },
    })
    const props = renderLayerCard()

    await user.click(screen.getByAltText('Blue'))

    const nameInput = screen.getByLabelText('Edit trait name') as HTMLInputElement
    expect(nameInput.value).toBe('Blue')

    await user.clear(nameInput)
    await user.type(nameInput, 'Sky Blue')
    await user.click(screen.getByRole('button', { name: 'Save' }))

    await waitFor(() =>
      expect(nftApi.updateTrait).toHaveBeenCalledWith('tok', 'trait-1', { name: 'Sky Blue', rarity_weight: 40 }),
    )
    expect(props.onTraitAdded).toHaveBeenCalled()
  })

  it('the edit panel\'s Delete button calls deleteTrait', async () => {
    const user = userEvent.setup()
    vi.mocked(nftApi.deleteTrait).mockResolvedValue(undefined)
    const props = renderLayerCard()

    await user.click(screen.getByAltText('Blue'))
    await user.click(screen.getByLabelText('Delete trait'))

    await waitFor(() => expect(nftApi.deleteTrait).toHaveBeenCalledWith('tok', 'trait-1'))
    expect(props.onTraitAdded).toHaveBeenCalled()
  })
})

describe('bulk trait upload', () => {
  it('dropping multiple files uploads each sequentially with a filename-derived name and the default weight', async () => {
    const user = userEvent.setup()
    vi.mocked(nftApi.addTrait).mockResolvedValue({
      trait: { id: 'x', name: 'x', rarity_weight: 50, image_path: 'x' },
    })
    const props = renderLayerCard({ layer: { ...layer, traits: [] } })

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const files = [
      new File(['a'], 'space-cadet.png', { type: 'image/png' }),
      new File(['b'], 'moon_walker.png', { type: 'image/png' }),
    ]

    await user.upload(fileInput, files)

    await waitFor(() => expect(nftApi.addTrait).toHaveBeenCalledTimes(2))
    expect(nftApi.addTrait).toHaveBeenNthCalledWith(1, 'tok', 'layer-1', 'space cadet', 50, files[0])
    expect(nftApi.addTrait).toHaveBeenNthCalledWith(2, 'tok', 'layer-1', 'moon walker', 50, files[1])
    expect(props.onTraitAdded).toHaveBeenCalled()
  })

  it('a single dropped file goes to the manual name/rarity form instead of auto-uploading', async () => {
    const user = userEvent.setup()
    const props = renderLayerCard({ layer: { ...layer, traits: [] } })

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const file = new File(['a'], 'space-cadet.png', { type: 'image/png' })
    await user.upload(fileInput, file)

    // Still on the manual form — addTrait hasn't fired, and a name field is
    // present waiting for input, unlike the bulk path.
    expect(nftApi.addTrait).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Trait name')).toBeInTheDocument()
    expect(props.onTraitAdded).not.toHaveBeenCalled()
  })
})

describe('layer header controls', () => {
  it('renaming the layer name commits on blur and calls onRename', async () => {
    const user = userEvent.setup()
    const props = renderLayerCard()

    await user.click(screen.getByTitle('Click to rename'))
    const input = screen.getByLabelText('Layer name')
    await user.clear(input)
    await user.type(input, 'Backdrop')
    await user.tab()

    expect(props.onRename).toHaveBeenCalledWith('Backdrop')
  })

  it('the delete-layer button calls onDelete', async () => {
    const user = userEvent.setup()
    const props = renderLayerCard()

    await user.click(screen.getByLabelText('Delete layer'))

    expect(props.onDelete).toHaveBeenCalled()
  })

  it('move up/down buttons only render when the corresponding callback is provided', () => {
    renderLayerCard({ onMoveUp: undefined, onMoveDown: undefined })
    expect(screen.queryByLabelText('Move layer up')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Move layer down')).not.toBeInTheDocument()

    renderLayerCard({ onMoveUp: vi.fn(), onMoveDown: vi.fn() })
    expect(screen.getByLabelText('Move layer up')).toBeInTheDocument()
    expect(screen.getByLabelText('Move layer down')).toBeInTheDocument()
  })
})
