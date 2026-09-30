import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { tokenPagesApi, type TokenCheckResult } from '../../lib/tokenPagesApi'
import { TokenCheckerPage } from './TokenCheckerPage'

vi.mock('../../lib/tokenPagesApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/tokenPagesApi')>()
  return { ...actual, tokenPagesApi: { ...actual.tokenPagesApi, check: vi.fn() } }
})

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.search}</p>
}

const result: TokenCheckResult = {
  chain: 'solana', network: 'solana', address: 'Mint111', name: 'Pool', symbol: 'POOL', decimals: 0, total_supply: '1000',
  owner: null, powers: [], contract_name: null,
  checks: [
    { id: 'mint', ok: false, label: 'More can be minted', detail: 'Auth1 can create new tokens.' },
    { id: 'freeze', ok: true, label: "Wallets can't be frozen", detail: '' },
  ],
  largest_holders: [{ address: 'Holder1111111111', share: 0.6 }],
  liquidity: { chain: 'solana', pools: 2, total_liquidity_usd: 50000, top: { dex: 'raydium', pair_address: 'p', url: null, price_usd: 0.01, liquidity_usd: 40000, volume_24h: 1 } },
  launched_here: '/token/solana/Mint111',
  explorer_url: 'https://explorer.solana.com/address/Mint111',
}

function renderPage(entry = '/research/check') {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/research/check" element={<><TokenCheckerPage /><Where /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('TokenCheckerPage', () => {
  it('offers the networks that fit the address, and records the check in the URL', async () => {
    vi.mocked(tokenPagesApi.check).mockResolvedValue(result)
    renderPage()
    await userEvent.type(screen.getByPlaceholderText('0x… or a Solana mint'), '0x5FbDB2315678afecb367f032d93F642f64180aa3')
    expect(screen.getByRole('option', { name: 'Base' })).toBeInTheDocument()
    await userEvent.selectOptions(screen.getByRole('combobox'), 'base')
    await userEvent.click(screen.getByRole('button', { name: '[ check ]' }))
    expect(screen.getByTestId('where')).toHaveTextContent('?network=base&address=0x5FbDB2315678afecb367f032d93F642f64180aa3')
    expect(tokenPagesApi.check).toHaveBeenCalledWith('base', '0x5FbDB2315678afecb367f032d93F642f64180aa3')
  })

  it('shows what the chain says, the largest accounts, and a link to the full page', async () => {
    vi.mocked(tokenPagesApi.check).mockResolvedValue(result)
    renderPage('/research/check?network=solana&address=Mint111')

    const panel = await screen.findByTestId('check-result')
    expect(within(panel).getByText('More can be minted')).toBeInTheDocument()
    expect(within(panel).getByText('Caution:')).toBeInTheDocument()
    expect(within(panel).getByText('60.0%')).toBeInTheDocument()
    expect(within(panel).getByText('$50.0K')).toBeInTheDocument()
    expect(within(panel).getByRole('link', { name: 'launched here — full page →' })).toHaveAttribute('href', '/token/solana/Mint111')
  })
})
