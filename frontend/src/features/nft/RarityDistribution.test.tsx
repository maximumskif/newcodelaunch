import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'

import type { NFTGeneratedItem } from '../../lib/nftApi'
import { RarityDistribution } from './RarityDistribution'

function item(id: string, background: string): NFTGeneratedItem {
  return {
    id,
    token_index: Number(id),
    attributes: [{ trait_type: 'Background', value: background }],
    image_path: `generated/${id}.png`,
    ipfs_image_hash: null,
    ipfs_metadata_hash: null,
  }
}

describe('RarityDistribution', () => {
  it('computes the real percentage spread across generated items, rarest first', () => {
    // 3 Blue, 1 Red out of 4 — real counts, not the configured rarity_weight.
    render(<RarityDistribution items={[item('1', 'Blue'), item('2', 'Blue'), item('3', 'Blue'), item('4', 'Red')]} />)

    expect(screen.getByText('Background')).toBeInTheDocument()
    expect(screen.getByText('25.0% (1)')).toBeInTheDocument()
    expect(screen.getByText('75.0% (3)')).toBeInTheDocument()

    // Rarest (lowest percentage) listed first.
    const values = screen.getAllByTitle(/Blue|Red/).map((el) => el.textContent)
    expect(values).toEqual(['Red', 'Blue'])
  })

  it('renders nothing when there are no generated items', () => {
    const { container } = render(<RarityDistribution items={[]} />)
    expect(container).toBeEmptyDOMElement()
  })

  it('handles multiple trait types independently', () => {
    const items: NFTGeneratedItem[] = [
      {
        id: '1',
        token_index: 1,
        attributes: [
          { trait_type: 'Background', value: 'Blue' },
          { trait_type: 'Hat', value: 'Cap' },
        ],
        image_path: 'generated/1.png',
        ipfs_image_hash: null,
        ipfs_metadata_hash: null,
      },
    ]
    render(<RarityDistribution items={items} />)

    expect(screen.getByText('Background')).toBeInTheDocument()
    expect(screen.getByText('Hat')).toBeInTheDocument()
  })
})
