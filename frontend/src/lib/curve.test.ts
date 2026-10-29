import { describe, expect, it } from 'vitest'

import { curveTerms, graduationPrice, priceAt, progress, quoteBuy, quoteSell, withSlippage } from './curve'

const ETH = 10n ** 18n

describe('curve math', () => {
  // The "Curve Odd" variant of backend/tests/forge (777,777,777 tokens,
  // a 3.333…337 ETH target). Before the fee, these were the deployed
  // contract's own answers; the fee-less parts still are (with the fee
  // left out, this math gives exactly those). The fee figures are the
  // contract's integer math worked through by hand, and e2e/curve.spec.ts
  // checks the page's quotes against the deployed contract's.
  const odd = curveTerms(777_777_777n, 3_333_333_333_333_333_337n)

  it('matches the contract to the wei', () => {
    expect(odd.virtualTokens).toBe(829_629_628_800_000_000_000_000_000n)
    const first = quoteBuy(odd, { ethReserve: 0n, tokensSold: 0n }, ETH)
    // 1 ETH paid: 1/1.01 of it into the curve, the rest the fee.
    expect(first).toEqual({ tokens: 390_924_955_979_057_591_455_593_870n, cost: 990_099_009_900_990_099n, fee: 9_900_990_099_009_901n })
    const state = { ethReserve: first.cost, tokensSold: first.tokens }
    expect(quoteSell(odd, state, first.tokens / 2n)).toEqual({ eth: 641_156_923_911_569_238n, fee: 6_476_332_564_763_326n })
    // A buy past the end is capped at what's left, and costs only that, plus 1%.
    expect(quoteBuy(odd, state, 100n * ETH)).toEqual({
      tokens: 231_297_265_620_942_408_544_406_130n,
      cost: 2_343_234_323_432_343_237n,
      fee: 23_432_343_234_323_433n,
    })
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
    const first = quoteBuy(terms, { ethReserve: 0n, tokensSold: 0n }, ETH)
    const state = { ethReserve: first.cost, tokensSold: first.tokens }
    const buy = quoteBuy(terms, state, ETH / 3n)
    const after = { ethReserve: state.ethReserve + buy.cost, tokensSold: state.tokensSold + buy.tokens }
    const sale = quoteSell(terms, after, buy.tokens)
    expect(sale.eth + sale.fee).toBeLessThanOrEqual(buy.cost)
  })

  it('takes 1% of every trade, on top of a buy and out of a sale', () => {
    const terms = curveTerms(1_000_000_000n, 4n * ETH)
    const buy = quoteBuy(terms, { ethReserve: 0n, tokensSold: 0n }, 101n * 10n ** 16n)
    expect(buy.cost).toBe(ETH)
    expect(buy.fee).toBe(10n ** 16n)
    const sale = quoteSell(terms, { ethReserve: buy.cost, tokensSold: buy.tokens }, buy.tokens)
    // ceil(1% of what leaves the reserve): the rounding goes to the fee.
    expect(sale.fee).toBe((sale.eth + sale.fee + 99n) / 100n)
    // A buy-out pays 1% of its capped cost, not of what was sent.
    const all = quoteBuy(terms, { ethReserve: 0n, tokensSold: 0n }, 10n * ETH)
    expect(all.fee).toBe((all.cost + 99n) / 100n)
  })

  it('refuses nothing-trades and overselling', () => {
    const terms = curveTerms(1_000_000_000n, 4n * ETH)
    expect(quoteBuy(terms, { ethReserve: 0n, tokensSold: 0n }, 0n)).toEqual({ tokens: 0n, cost: 0n, fee: 0n })
    expect(quoteSell(terms, { ethReserve: ETH, tokensSold: 10n }, 11n)).toEqual({ eth: 0n, fee: 0n })
  })

  it('progress and slippage', () => {
    expect(progress({ target: 4n * ETH }, { ethReserve: ETH })).toBe(0.25)
    expect(progress({ target: 4n * ETH }, { ethReserve: 5n * ETH })).toBe(1)
    expect(withSlippage(1000n)).toBe(990n)
  })
})
