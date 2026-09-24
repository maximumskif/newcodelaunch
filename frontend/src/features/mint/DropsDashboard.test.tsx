import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { candyMachineApi, type CreatorDrop } from '../../lib/candyMachineApi'
import { DropsDashboard } from './DropsDashboard'

vi.mock('../../lib/candyMachineApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/candyMachineApi')>()
  return { ...actual, candyMachineApi: { ...actual.candyMachineApi, dashboard: vi.fn() } }
})

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'tok', user: null, login: vi.fn(), logout: vi.fn() }),
}))

const drop: CreatorDrop = {
  id: 'cm-1',
  nft_collection_id: 'col-1',
  network: 'solana_devnet',
  collection_mint: 'Coll111',
  candy_machine: 'Candy111',
  price_sol: 0.25,
  items_available: 4,
  go_live_date: '2026-01-01T00:00:00Z',
  allowlist: null,
  mint_limit: null,
  creator_wallet: 'Creator111',
  transaction_signatures: ['sig'],
  explorer_url: 'https://explorer.solana.com/address/Candy111?cluster=devnet',
  created_at: '2026-01-01T00:00:00Z',
  collection_name: 'Cool Apes',
  is_live: true,
  phase: 'public',
  live_status_available: true,
  items_redeemed: 3,
  items_remaining: 1,
  revenue_min_sol: 0.75,
  revenue_max_sol: 0.75,
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <DropsDashboard />
    </MemoryRouter>,
  )
}

describe('DropsDashboard', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows each drop with live sales, and totals per network', async () => {
    vi.mocked(candyMachineApi.dashboard).mockResolvedValue({
      drops: [
        drop,
        { ...drop, id: 'cm-2', candy_machine: 'Candy222', collection_name: 'Sold Out Set', items_redeemed: 4, items_remaining: 0, revenue_min_sol: 1, revenue_max_sol: 1 },
        {
          ...drop,
          id: 'cm-3',
          candy_machine: 'Candy333',
          collection_name: 'Unreachable',
          network: 'solana',
          live_status_available: false,
          items_redeemed: null,
          items_remaining: null,
          revenue_min_sol: null,
          revenue_max_sol: null,
          is_live: false,
          phase: 'upcoming',
        },
      ],
      totals_by_network: { solana_devnet: { drops: 2, items_redeemed: 7, revenue_min_sol: 1.75, revenue_max_sol: 1.75 } },
    })
    renderDashboard()

    const coolApes = (await screen.findByText('Cool Apes')).closest('tr')!
    expect(within(coolApes).getByText('3 / 4')).toBeInTheDocument()
    expect(within(coolApes).getByText('0.75 SOL')).toBeInTheDocument()
    expect(within(coolApes).getByText('Live')).toBeInTheDocument()
    expect(within(coolApes).getByRole('progressbar')).toHaveAttribute('aria-valuenow', '3')
    expect(within(coolApes).getByRole('link', { name: 'Storefront' })).toHaveAttribute('href', '/mint/buy/Candy111')

    expect(within(screen.getByText('Sold Out Set').closest('tr')!).getByText('Sold out')).toBeInTheDocument()

    const unreachable = screen.getByText('Unreachable').closest('tr')!
    expect(within(unreachable).getByText('Unavailable')).toBeInTheDocument()
    expect(within(unreachable).getByText(/^Starts /)).toBeInTheDocument()

    expect(screen.getByText('1.75 SOL')).toBeInTheDocument()
    expect(screen.getByText('7 minted across 2 drops')).toBeInTheDocument()
  })

  it('shows a revenue range and the allowlist phase for a two-price drop', async () => {
    vi.mocked(candyMachineApi.dashboard).mockResolvedValue({
      drops: [
        {
          ...drop,
          phase: 'allowlist',
          allowlist: { price_sol: 0.1, start_date: '2026-01-01T00:00:00Z', size: 50 },
          revenue_min_sol: 0.3,
          revenue_max_sol: 0.75,
        },
      ],
      totals_by_network: { solana_devnet: { drops: 1, items_redeemed: 3, revenue_min_sol: 0.3, revenue_max_sol: 0.75 } },
    })
    renderDashboard()

    const row = (await screen.findByText('Cool Apes')).closest('tr')!
    expect(within(row).getByText('0.3–0.75 SOL')).toBeInTheDocument()
    expect(within(row).getByText('Allowlist phase')).toBeInTheDocument()
    expect(within(row).getByText('0.1 SOL allowlist · 50 wallets')).toBeInTheDocument()
  })

  it('points a creator with no drops at the NFT Generator', async () => {
    vi.mocked(candyMachineApi.dashboard).mockResolvedValue({ drops: [], totals_by_network: {} })
    renderDashboard()
    expect(await screen.findByText('No drops yet')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to NFT Generator' })).toHaveAttribute('href', '/nft')
  })

  it('reports a load failure and can refresh', async () => {
    const user = userEvent.setup()
    vi.mocked(candyMachineApi.dashboard).mockRejectedValueOnce(new Error('Request failed with status 502'))
    vi.mocked(candyMachineApi.dashboard).mockResolvedValueOnce({ drops: [drop], totals_by_network: {} })
    renderDashboard()

    expect(await screen.findByRole('alert')).toHaveTextContent('502')
    await user.click(screen.getByRole('button', { name: 'Refresh' }))
    expect(await screen.findByText('Cool Apes')).toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })
})
