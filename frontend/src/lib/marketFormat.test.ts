import { describe, expect, it } from 'vitest'

import { formatAmount, formatLarge, formatPrice } from './marketFormat'

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

describe('formatAmount', () => {
  it('keeps amounts short enough to read', () => {
    expect(formatAmount(660_869_565.2173913)).toBe('660.87M')
    expect(formatAmount(1_000_000_000)).toBe('1B')
    expect(formatAmount(9_999.991849899)).toBe('9,999.9918')
    expect(formatAmount(0.002)).toBe('0.002')
    expect(formatAmount(0.012345678)).toBe('0.01235')
    expect(formatAmount(8.266e-12)).toBe('0.0₁₁8266')
    expect(formatAmount(0)).toBe('0')
  })
})
