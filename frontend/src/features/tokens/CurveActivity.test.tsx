import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { fireEvent, render, screen } from '@testing-library/react'
import { parseEther } from 'viem'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { curveTerms, pricePoints, quoteBuy } from '../../lib/curve'
import { timeAgo } from '../../lib/marketFormat'
import { tokenPagesApi, type CurveTrade } from '../../lib/tokenPagesApi'
import { CurveActivity } from './CurveActivity'

const terms = curveTerms(1_000_000_000n, parseEther('4'))
const now = Math.floor(Date.now() / 1000)

// n buys of 0.1 ETH each, the newest first (as the API sends them).
function buys(n: number): CurveTrade[] {
  const trades: CurveTrade[] = []
  let state = { ethReserve: 0n, tokensSold: 0n }
  for (let i = 0; i < n; i++) {
    const { tokens, cost } = quoteBuy(terms, state, parseEther('0.1'))
    state = { ethReserve: state.ethReserve + cost, tokensSold: state.tokensSold + tokens }
    trades.push({
      kind: 'buy', wallet: `0x${String(i).padStart(40, '0')}`, eth: cost.toString(), tokens: tokens.toString(),
      eth_reserve: state.ethReserve.toString(), tokens_sold: state.tokensSold.toString(), block: 100 + i, tx: `0x${i}`, time: now - (n - i) * 60,
    })
  }
  return trades.reverse()
}

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <CurveActivity network="sepolia" address="0xcurve" terms={terms} symbol="MCAT" native="ETH" />
    </QueryClientProvider>,
  )

describe('CurveActivity', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('charts the price after each trade and lists the trades, newest first', async () => {
    vi.spyOn(tokenPagesApi, 'curveTrades').mockResolvedValue({ network: 'sepolia', address: '0xcurve', trade_count: 20, trades: buys(20), graduated: null, explorer_tx: 'https://sepolia.etherscan.io/tx/' })
    show()
    expect(await screen.findByRole('img', { name: /^Price since launch, from / })).toBeInTheDocument()
    expect(screen.getByText('20 trades')).toBeInTheDocument()
    // 15 shown until asked for all.
    expect(screen.getAllByRole('row')).toHaveLength(16)
    fireEvent.click(screen.getByRole('button', { name: 'Show all 20' }))
    expect(screen.getAllByRole('row')).toHaveLength(21)
    expect(screen.getAllByRole('link', { name: /ago/ })[0]).toHaveAttribute('href', 'https://sepolia.etherscan.io/tx/0x19')
  })

  it('says when only the latest trades are shown, and shows a tooltip on hover', async () => {
    vi.spyOn(tokenPagesApi, 'curveTrades').mockResolvedValue({ network: 'sepolia', address: '0xcurve', trade_count: 250, trades: buys(3), graduated: null, explorer_tx: null })
    const { container } = show()
    expect(await screen.findByText('Latest 3 of 250 trades')).toBeInTheDocument()
    expect(screen.getByRole('img', { name: /^Price over the last 3 trades/ })).toBeInTheDocument()
    fireEvent.mouseEnter(container.querySelectorAll('svg rect')[2])
    expect(screen.getByText(/^buy .* MCAT · 1m ago$/)).toBeInTheDocument()
  })

  it('has nothing to chart before the first trade', async () => {
    vi.spyOn(tokenPagesApi, 'curveTrades').mockResolvedValue({ network: 'sepolia', address: '0xcurve', trade_count: 0, trades: [], graduated: null, explorer_tx: null })
    show()
    expect(await screen.findByText('No trades yet. The first buy starts the chart.')).toBeInTheDocument()
  })
})

describe('helpers', () => {
  it('prices rise with each buy, oldest first, from the launch price when asked', () => {
    const prices = pricePoints(terms, buys(5)).map((p) => p.price)
    expect(prices).toEqual([...prices].sort((a, b) => a - b))
    const fromLaunch = pricePoints(terms, buys(5), { fromLaunch: true })
    expect(fromLaunch).toHaveLength(6)
    expect(fromLaunch[0].trade).toBeNull()
    expect(fromLaunch[0].price).toBeLessThan(prices[0])
  })

  it('timeAgo', () => {
    expect(timeAgo(1000, 1030)).toBe('30s ago')
    expect(timeAgo(1000, 1000 + 7200)).toBe('2h ago')
    expect(timeAgo(1000, 1000 + 3 * 86_400)).toBe('3d ago')
  })
})
