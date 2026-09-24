import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { nftApi, type NFTCollection } from '../../lib/nftApi'
import { TraitRules } from './TraitRules'

vi.mock('../../lib/nftApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/nftApi')>()
  return { ...actual, nftApi: { ...actual.nftApi, addRule: vi.fn(), deleteRule: vi.fn() } }
})

const trait = (id: string, name: string, layerId: string) => ({
  id, name, layer_id: layerId, rarity_weight: 1, image_path: `${id}.png`, image_url: `/${id}.png`,
})

const collection = {
  id: 'col-1',
  name: 'Apes',
  description: '',
  collection_size: 9,
  image_size: 64,
  status: 'draft',
  created_at: '2026-01-01T00:00:00Z',
  layers: [
    { id: 'bg', name: 'Background', order_index: 0, traits: [trait('red', 'Red', 'bg'), trait('blue', 'Blue', 'bg')] },
    { id: 'hat', name: 'Hat', order_index: 1, traits: [trait('crown', 'Crown', 'hat'), trait('cap', 'Cap', 'hat')] },
  ],
  rules: [{ id: 'r1', kind: 'require', trait_id: 'crown', other_trait_id: 'red' }],
} as unknown as NFTCollection

describe('TraitRules', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows existing rules as sentences and removes one', async () => {
    const onChange = vi.fn()
    vi.mocked(nftApi.deleteRule).mockResolvedValue(undefined)
    const user = userEvent.setup()
    render(<TraitRules token="tok" collection={collection} onChange={onChange} />)

    expect(screen.getByText(/Crown \(Hat\)/).closest('li')).toHaveTextContent('Crown (Hat) requires Red (Background)')
    await user.click(screen.getByRole('button', { name: /Remove rule/ }))
    expect(nftApi.deleteRule).toHaveBeenCalledWith('tok', 'r1')
    expect(onChange).toHaveBeenCalled()
  })

  it('only offers traits from other layers as the second trait, and adds the rule', async () => {
    const onChange = vi.fn()
    vi.mocked(nftApi.addRule).mockResolvedValue({ rule: { id: 'r2', kind: 'exclude', trait_id: 'blue', other_trait_id: 'cap' } })
    const user = userEvent.setup()
    render(<TraitRules token="tok" collection={collection} onChange={onChange} />)

    await user.selectOptions(screen.getByLabelText('Trait'), 'blue')
    const other = screen.getByLabelText('Other trait')
    expect(within(other).queryByRole('option', { name: 'Red' })).not.toBeInTheDocument()
    expect(within(other).getByRole('option', { name: 'Cap' })).toBeInTheDocument()
    await user.selectOptions(other, 'cap')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))

    expect(nftApi.addRule).toHaveBeenCalledWith('tok', 'col-1', { kind: 'exclude', trait_id: 'blue', other_trait_id: 'cap' })
    expect(onChange).toHaveBeenCalled()
  })

  it("shows the server's reason when a rule is refused", async () => {
    vi.mocked(nftApi.addRule).mockRejectedValue(new Error('That contradicts an existing rule between these two traits'))
    const user = userEvent.setup()
    render(<TraitRules token="tok" collection={collection} onChange={vi.fn()} />)
    await user.selectOptions(screen.getByLabelText('Trait'), 'crown')
    await user.selectOptions(screen.getByLabelText('Rule'), 'exclude')
    await user.selectOptions(screen.getByLabelText('Other trait'), 'red')
    await user.click(screen.getByRole('button', { name: 'Add rule' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('contradicts')
  })

  it('stays hidden until there are two layers with traits to connect', () => {
    const oneLayer = { ...collection, layers: [collection.layers![0]], rules: [] } as NFTCollection
    const { container } = render(<TraitRules token="tok" collection={oneLayer} onChange={vi.fn()} />)
    expect(container).toBeEmptyDOMElement()
  })
})
