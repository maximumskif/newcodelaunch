import { describe, expect, it } from 'vitest'

import { fitsLimits } from './tokenLimits'

describe('fitsLimits', () => {
  const limits = { owner: '0x1', tradingEnabled: true, maxTransaction: 100n, maxWallet: 300n, exempt: false, recipientBalance: 0n }

  it('pays everything due when the token has no limits, or the contract is exempt', () => {
    expect(fitsLimits(500n, null)).toBe(500n)
    expect(fitsLimits(500n, { ...limits, exempt: true })).toBe(500n)
  })

  it('fits the per-transfer cap and the room left in the recipient’s wallet', () => {
    expect(fitsLimits(500n, limits)).toBe(100n)
    expect(fitsLimits(50n, limits)).toBe(50n)
    expect(fitsLimits(500n, { ...limits, recipientBalance: 250n })).toBe(50n)
    expect(fitsLimits(500n, { ...limits, recipientBalance: 300n })).toBe(0n)
  })

  it('pays nothing before trading is enabled', () => {
    expect(fitsLimits(500n, { ...limits, tradingEnabled: false })).toBe(0n)
  })
})
