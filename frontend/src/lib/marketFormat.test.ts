import { describe, expect, it } from 'vitest'

import { formatLarge, formatPrice } from './marketFormat'

describe('formatPrice', () => {
  it('writes tiny prices with a subscript zero count, like DEX screens', () => {
    expect(formatPrice(6.025e-24)).toBe('$0.0₂₃6025')
    expect(formatPrice(0.00001234)).toBe('$0.0₄1234')
  })
  it('keeps ordinary prices readable', () => {
    expect(formatPrice(0.0001)).toBe('$0.0001000')
    expect(formatPrice(0.01262)).toBe('$0.01262')
    expect(formatPrice(83670.99)).toBe('$83,670.99')
    expect(formatPrice(null)).toBe('—')
  })
})

describe('formatLarge', () => {
  it('uses T, B, M and K', () => {
    expect(formatLarge(1.68106e12)).toBe('$1.68T')
    expect(formatLarge(3.27e11)).toBe('$327.00B')
    expect(formatLarge(4.56e6)).toBe('$4.56M')
    expect(formatLarge(28100)).toBe('$28.1K')
  })
})
