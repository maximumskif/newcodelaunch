import { describe, expect, it } from 'vitest'

import { defaultSymbol, priceToWei } from './nftEvm'

describe('defaultSymbol', () => {
  it('upper-cases, drops non-alphanumerics, and caps at 10 characters', () => {
    expect(defaultSymbol('Cool Apes')).toBe('COOLAPES')
    expect(defaultSymbol('The Extremely Long Collection')).toBe('THEEXTREME')
    expect(defaultSymbol('!!!')).toBe('NFT')
  })
})

describe('priceToWei', () => {
  it('converts a plain decimal native-token amount to a wei string', () => {
    expect(priceToWei('0.01')).toBe('10000000000000000')
    expect(priceToWei('0')).toBe('0')
    expect(priceToWei(' 1.5 ')).toBe('1500000000000000000')
  })

  it.each(['', '-1', '1e3', 'abc', '0.1234567890123456789', '1.'])('rejects %j', (value) => {
    expect(priceToWei(value)).toBeNull()
  })
})
