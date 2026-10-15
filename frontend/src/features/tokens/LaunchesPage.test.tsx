import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { tokenPagesApi, type CurveLaunch } from '../../lib/tokenPagesApi'
import { LaunchesPage } from './LaunchesPage'

const launch = (overrides: Partial<CurveLaunch>): CurveLaunch => ({
  network: 'base', address: '0x1111111111111111111111111111111111111111', name: 'Moon Cat', symbol: 'MCAT',
  graduation_target: '4000000000000000000', created_at: new Date().toISOString(), graduated: false, eth_reserve: '1000000000000000000', ...overrides,
})

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient()}>
      <MemoryRouter>
        <LaunchesPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )

describe('LaunchesPage', () => {
  beforeEach(() => vi.restoreAllMocks())

  it('shows each launch with how far it is from graduating, linking to its page', async () => {
    vi.spyOn(tokenPagesApi, 'curveLaunches').mockResolvedValue({
      launches: [
        launch({}),
        launch({ address: '0x2222222222222222222222222222222222222222', name: 'Done Dog', symbol: 'DOG', graduated: true, eth_reserve: '4000000000000000000' }),
        launch({ address: '0x3333333333333333333333333333333333333333', name: 'Dark', symbol: 'DRK', graduated: null, eth_reserve: null }),
      ],
    })
    show()
    expect(await screen.findByText('25% · 1 of 4 ETH')).toBeInTheDocument()
    expect(screen.getByRole('progressbar', { name: 'MCAT raised toward graduation' })).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByText('Graduated')).toBeInTheDocument()
    expect(screen.getByText("Couldn't read this curve just now.")).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Moon Cat/ })).toHaveAttribute('href', '/token/base/0x1111111111111111111111111111111111111111')
  })

  it('filters by network', async () => {
    const spy = vi.spyOn(tokenPagesApi, 'curveLaunches').mockResolvedValue({ launches: [] })
    show()
    expect(await screen.findByText('No launches yet')).toBeInTheDocument()
    await userEvent.click(screen.getByRole('button', { name: 'Base' }))
    expect(spy).toHaveBeenLastCalledWith('base')
    expect(await screen.findByText('Nothing has launched on a curve on Base yet.')).toBeInTheDocument()
  })
})
