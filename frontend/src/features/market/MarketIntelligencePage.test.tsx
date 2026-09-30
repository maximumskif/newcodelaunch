import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { marketApi, type DexPair } from '../../lib/marketApi'
import { MarketIntelligencePage } from './MarketIntelligencePage'

vi.mock('../../lib/marketApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/marketApi')>()
  return { ...actual, marketApi: { listTokens: vi.fn(), lookupToken: vi.fn(), trending: vi.fn() } }
})

const pair = (overrides: Partial<DexPair>): DexPair => ({
  chain: 'ethereum', dex: 'uniswap', pair_address: '0xpair', url: 'https://dexscreener.com/x',
  base_token: { address: '0xweth', name: 'Wrapped Ether', symbol: 'WETH' }, quote_symbol: 'USDC',
  price_usd: 2685.45, price_change_24h: 0.2, volume_24h: 4.4e7, liquidity_usd: 1.1e8, fdv: null,
  market_cap: 5.5e9, created_at: null, image: null, ...overrides,
})

function renderPage() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(<QueryClientProvider client={client}><MemoryRouter><MarketIntelligencePage /></MemoryRouter></QueryClientProvider>)
}

describe('MarketIntelligencePage', () => {
  beforeEach(() => {
    vi.mocked(marketApi.listTokens).mockResolvedValue({
      source: 'CoinPaprika',
      tokens: [{ id: 'btc-bitcoin', symbol: 'BTC', name: 'Bitcoin', image: null, current_price: 83000, market_cap: 1.6e12, market_cap_rank: 1, total_volume: 2e10, price_change_percentage_24h: -0.1 }],
    })
    vi.mocked(marketApi.trending).mockResolvedValue({ tokens: [pair({ chain: 'solana', base_token: { address: 'm', name: 'Crocs', symbol: 'CROCS' }, pair_address: 'p2' })] })
  })

  it('credits the source that answered and shows trending tokens', async () => {
    renderPage()
    expect(await screen.findByText('Source: CoinPaprika · refreshed every minute')).toBeInTheDocument()
    expect(screen.getByText('Bitcoin')).toBeInTheDocument()
    expect(await screen.findByText('CROCS')).toBeInTheDocument()
  })

  it("looks up a token and shows its main chain's pools, naming other chains", async () => {
    vi.mocked(marketApi.lookupToken).mockResolvedValue({
      pairs: [pair({}), pair({ pair_address: '0xusdt', quote_symbol: 'USDT', liquidity_usd: 9e7 }), pair({ chain: 'pulsechain', pair_address: '0xpls', price_usd: 0.00001 })],
    })
    renderPage()
    await userEvent.type(screen.getByLabelText('Token address'), '0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')
    await userEvent.click(screen.getByRole('button', { name: 'Look up' }))

    const result = await screen.findByTestId('lookup-result')
    expect(marketApi.lookupToken).toHaveBeenCalledWith('0xC02aaA39b223FE8D0A0e5C4F27eAD9083C756Cc2')
    expect(within(result).getByText('WETH/USDC')).toBeInTheDocument()
    expect(within(result).getByText('WETH/USDT')).toBeInTheDocument()
    expect(within(result).queryByText('$0.00001000')).not.toBeInTheDocument()
    expect(within(result).getByText(/also has pools on pulsechain/)).toBeInTheDocument()
  })

  it('says so when a token has no pools', async () => {
    vi.mocked(marketApi.lookupToken).mockResolvedValue({ pairs: [] })
    renderPage()
    await userEvent.type(screen.getByLabelText('Token address'), '46erTFzGYWZ2YiEdoVYWkTjb6yYhCT75rCJHXVsii4kr')
    await userEvent.click(screen.getByRole('button', { name: 'Look up' }))
    expect(await screen.findByText(/No trading pairs found/)).toBeInTheDocument()
  })
})
