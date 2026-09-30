import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { tokenPagesApi, type HolderSnapshot } from '../../lib/tokenPagesApi'
import { HolderSnapshotPage } from './HolderSnapshotPage'

vi.mock('../../lib/tokenPagesApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/tokenPagesApi')>()
  return { ...actual, tokenPagesApi: { ...actual.tokenPagesApi, holders: vi.fn() } }
})

function Where() {
  return <p data-testid="where">{useLocation().search}</p>
}

const TOKEN = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const snapshot: HolderSnapshot = {
  chain: 'evm', network: 'sepolia', address: TOKEN, symbol: 'NOVA', decimals: 0, total_supply: '1000', holder_count: 150, truncated: false,
  holders: Array.from({ length: 150 }, (_, i) => ({ address: i === 0 ? '0x000000000000000000000000000000000000dEaD' : `0x${String(i).padStart(40, '0')}`, balance: String(150 - i), share: (150 - i) / 1000 })),
  as_of: { block: 1234, latest: false }, burn_addresses: ['0x000000000000000000000000000000000000dEaD'],
}

function renderPage(entry: string) {
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter initialEntries={[entry]}>
        <Routes>
          <Route path="/liquidity/snapshot" element={<><HolderSnapshotPage /><Where /></>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>,
  )
}

describe('HolderSnapshotPage', () => {
  it('puts the query in the URL, with a block only for EVM', async () => {
    renderPage('/liquidity/snapshot')
    await userEvent.type(screen.getByLabelText('token address or mint'), TOKEN)
    await userEvent.type(screen.getByLabelText('at block (optional)'), '12x34')
    await userEvent.click(screen.getByRole('button', { name: '[ snapshot ]' }))
    expect(screen.getByTestId('where')).toHaveTextContent(`?network=sepolia&address=${TOKEN}&block=1234`)
  })

  it('shows the largest 100 holders, marks burn addresses, and shows the rest on request', async () => {
    vi.mocked(tokenPagesApi.holders).mockResolvedValue(snapshot)
    renderPage(`/liquidity/snapshot?network=sepolia&address=${TOKEN}&block=1234`)

    const result = await screen.findByTestId('snapshot-result')
    expect(tokenPagesApi.holders).toHaveBeenCalledWith('sepolia', TOKEN, '1234')
    expect(within(result).getByText('block 1,234')).toBeInTheDocument()
    expect(within(result).getByText('1,000 NOVA')).toBeInTheDocument()
    expect(within(result).getByText('(burn address)')).toBeInTheDocument()
    const table = within(result).getByRole('table')
    expect(within(table).getAllByRole('row')).toHaveLength(101) // header + 100
    await userEvent.click(within(result).getByRole('button', { name: 'show all 150' }))
    expect(within(table).getAllByRole('row')).toHaveLength(151)
    expect(within(result).getByRole('link', { name: 'airdrop to them →' })).toHaveAttribute('href', '/liquidity/airdrop?network=sepolia')
  })
})
