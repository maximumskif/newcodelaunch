import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { marketApi, type DefiProtocol } from '../../lib/marketApi'
import { DefiScannerPage } from './DefiScannerPage'

vi.mock('../../lib/marketApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/marketApi')>()
  return { ...actual, marketApi: { ...actual.marketApi, listProtocols: vi.fn() } }
})

const protocol = (name: string, category: string, chains: string[], tvl: number, change7d: number): DefiProtocol => ({
  id: name, name, symbol: null, category, chains, tvl, change_1d: 0, change_7d: change7d, url: null, logo: null,
})

describe('DefiScannerPage filters', () => {
  it('hides exchanges by default, and filters by search and category', async () => {
    vi.mocked(marketApi.listProtocols).mockResolvedValue({
      protocols: [
        protocol('Binance CEX', 'CEX', ['Ethereum'], 1.7e11, -1),
        protocol('Lido', 'Liquid Staking', ['Ethereum', 'Solana'], 2.6e10, 2),
        protocol('Aave V3', 'Lending', ['Ethereum', 'Base'], 1.8e10, -2),
        protocol('Jito', 'Liquid Staking', ['Solana'], 3e9, 1),
      ],
    })
    render(<QueryClientProvider client={new QueryClient()}><MemoryRouter><DefiScannerPage /></MemoryRouter></QueryClientProvider>)

    expect(await screen.findByText('Lido')).toBeInTheDocument()
    expect(screen.queryByText('Binance CEX')).not.toBeInTheDocument()
    expect(screen.getByText('2 of 3')).toBeInTheDocument() // up over 7 days

    await userEvent.click(screen.getByLabelText('Hide centralized exchanges'))
    expect(screen.getByText('Binance CEX')).toBeInTheDocument()

    await userEvent.type(screen.getByLabelText('Search protocols or chains'), 'solana')
    expect(screen.getByText('Jito')).toBeInTheDocument()
    expect(screen.queryByText('Aave V3')).not.toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('Search protocols or chains'))
    await userEvent.click(screen.getByRole('button', { name: 'Lending' }))
    expect(screen.getByText('Aave V3')).toBeInTheDocument()
    expect(screen.queryByText('Lido')).not.toBeInTheDocument()
  })
})
