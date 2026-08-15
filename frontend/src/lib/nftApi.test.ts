import { describe, expect, it } from 'vitest'

import { maxPossibleCombinations, type NFTLayer } from './nftApi'

function layer(traitCount: number): NFTLayer {
  return {
    id: `layer-${traitCount}`,
    name: 'Layer',
    order_index: 0,
    traits: Array.from({ length: traitCount }, (_, i) => ({
      id: `trait-${i}`,
      name: `Trait ${i}`,
      rarity_weight: 50,
      image_path: `trait-${i}.png`,
    })),
  }
}

describe('maxPossibleCombinations', () => {
  it('returns 0 for no layers', () => {
    expect(maxPossibleCombinations([])).toBe(0)
  })

  it('returns 0 if any layer has no traits', () => {
    expect(maxPossibleCombinations([layer(3), layer(0)])).toBe(0)
  })

  it('returns the product of each layer\'s trait count', () => {
    expect(maxPossibleCombinations([layer(2), layer(3), layer(4)])).toBe(24)
  })
})
