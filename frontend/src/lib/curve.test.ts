import { describe, expect, it } from 'vitest'

import { curveTerms, graduationPrice, priceAt, progress, quoteBuy, quoteSell, withSlippage } from './curve'

const ETH = 10n ** 18n

describe('curve math', () => {
  // The "Curve Odd" variant of backend/tests/forge (777,777,777 tokens,
  // a 3.333…337 ETH target): these numbers are what the deployed contract's
  // own quoteBuy/quoteSell returned for the same trades.
  const odd = curveTerms(777_777_777n, 3_333_333_333_333_333_337n)

  it('matches the contract to the wei', () => {
    expect(odd.virtualTokens).toBe(829_629_628_800_000_000_000_000_000n)
    const first = quoteBuy(odd, { ethReserve: 0n, tokensSold: 0n }, ETH)
    expect(first).toEqual({ tokens: 392_982_455_747_368_420_887_165_281n, cost: ETH })
    const state = { ethReserve: ETH, tokensSold: first.tokens }
    expect(quoteSell(odd, state, first.tokens / 2n)).toBe(655_172_413_793_103_448n)
    // A buy past the end is capped at what's left, and costs only that.
    expect(quoteBuy(odd, state, 100n * ETH)).toEqual({ tokens: 229_239_765_852_631_579_112_834_719n, cost: 2_333_333_333_333_333_336n })
  })

  it('sells 80% on the curve and keeps 20% for the pool', () => {
    const terms = curveTerms(1_000_000_000n, 4n * ETH)
    expect(terms.curveSupply).toBe(800_000_000n * ETH)
    expect(terms.poolSupply).toBe(200_000_000n * ETH)
  })

  it('rises about 16x and opens the pool at the last curve price', () => {
    const terms = curveTerms(1_000_000_000n, 4n * ETH)
    const start = priceAt(terms, { ethReserve: 0n, tokensSold: 0n })
    const all = quoteBuy(terms, { ethReserve: 0n, tokensSold: 0n }, 10n * ETH)
    expect(all.tokens).toBe(terms.curveSupply)
    // Raises the target (to within a wei or two of rounding).
    expect(Number(all.cost) / 1e18).toBeCloseTo(4, 9)
    const end = priceAt(terms, { ethReserve: all.cost, tokensSold: all.tokens })
    expect(end / start).toBeCloseTo(16, 6)
    expect(graduationPrice(terms) / end).toBeCloseTo(1, 6)
  })

  it('never pays back more than a buy cost', () => {
    const terms = curveTerms(1_000_000_000n, 4n * ETH)
    const state = { ethReserve: ETH, tokensSold: quoteBuy(terms, { ethReserve: 0n, tokensSold: 0n }, ETH).tokens }
    const buy = quoteBuy(terms, state, ETH / 3n)
    const after = { ethReserve: state.ethReserve + buy.cost, tokensSold: state.tokensSold + buy.tokens }
    expect(quoteSell(terms, after, buy.tokens)).toBeLessThanOrEqual(buy.cost)
  })

  it('refuses nothing-trades and overselling', () => {
    const terms = curveTerms(1_000_000_000n, 4n * ETH)
    expect(quoteBuy(terms, { ethReserve: 0n, tokensSold: 0n }, 0n)).toEqual({ tokens: 0n, cost: 0n })
    expect(quoteSell(terms, { ethReserve: ETH, tokensSold: 10n }, 11n)).toBe(0n)
  })

  it('progress and slippage', () => {
    expect(progress({ target: 4n * ETH }, { ethReserve: ETH })).toBe(0.25)
    expect(progress({ target: 4n * ETH }, { ethReserve: 5n * ETH })).toBe(1)
    expect(withSlippage(1000n)).toBe(990n)
  })
})
