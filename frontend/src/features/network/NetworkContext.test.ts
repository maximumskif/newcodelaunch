import { describe, expect, it } from 'vitest'

import { isMainnetNetwork } from './NetworkContext'

describe('isMainnetNetwork', () => {
  it('returns false for a known testnet', () => {
    expect(isMainnetNetwork('sepolia')).toBe(false)
    expect(isMainnetNetwork('polygon_amoy')).toBe(false)
    expect(isMainnetNetwork('bsc_testnet')).toBe(false)
  })

  it('returns true for a known mainnet', () => {
    expect(isMainnetNetwork('ethereum')).toBe(true)
    expect(isMainnetNetwork('polygon')).toBe(true)
    expect(isMainnetNetwork('bsc')).toBe(true)
  })

  it('fails closed (treats as mainnet) for an unrecognized network id', () => {
    // Regression test: this previously returned `false` (no warning shown)
    // for anything not in EVM_NETWORKS, silently skipping the mainnet
    // confirmation gate on bad/stale/renamed network data.
    expect(isMainnetNetwork('not-a-real-network')).toBe(true)
    expect(isMainnetNetwork('')).toBe(true)
  })
})
