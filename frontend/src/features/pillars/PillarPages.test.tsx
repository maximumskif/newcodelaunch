import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { AllToolsPage } from './AllToolsPage'
import { PillarHubPage } from './PillarHubPage'

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

describe('AllToolsPage', () => {
  it('lists every area, and narrows by search and by area', async () => {
    render(<MemoryRouter><AllToolsPage /></MemoryRouter>)
    for (const name of ['tokens', 'nfts', 'smart contracts', 'drops', 'liquidity & distribution', 'research']) {
      expect(screen.getByRole('heading', { name })).toBeInTheDocument()
    }
    await userEvent.type(screen.getByLabelText('Search tools'), 'raydium')
    expect(screen.getByRole('link', { name: /Pool on Raydium/ })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'nfts' })).not.toBeInTheDocument()

    await userEvent.clear(screen.getByLabelText('Search tools'))
    await userEvent.click(within(screen.getByRole('group', { name: 'Filter by area' })).getByRole('button', { name: 'drops' }))
    expect(screen.getByRole('heading', { name: 'drops' })).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'tokens' })).not.toBeInTheDocument()
  })

  it('shows a coming tool without linking it', () => {
    render(<MemoryRouter><AllToolsPage /></MemoryRouter>)
    expect(screen.getByLabelText('Vesting — coming soon')).toBeInTheDocument()
    expect(screen.queryByRole('link', { name: /Vesting/ })).not.toBeInTheDocument()
  })
})

describe('PillarHubPage', () => {
  it('shows the area, its steps and its tools, and offers the next area', () => {
    render(<MemoryRouter><PillarHubPage pillarId="nfts" /></MemoryRouter>)
    expect(screen.getByRole('heading', { level: 1, name: 'NFTs' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: '[ collection generator ]' })).toHaveAttribute('href', '/nfts/generator')
    expect(screen.getByText('Set rarity & rules')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Deploy as ERC-721/ })).toHaveAttribute('href', '/nfts/deploy-evm')
    expect(screen.getByRole('link', { name: /next: drops/ })).toHaveAttribute('href', '/drops')
  })

  it('forwards an old /tokens link with a query to the tool it meant', () => {
    render(
      <MemoryRouter initialEntries={['/tokens?project=p1&chain=solana']}>
        <Routes>
          <Route path="/tokens" element={<PillarHubPage pillarId="tokens" />} />
          <Route path="/tokens/create" element={<Where />} />
        </Routes>
      </MemoryRouter>,
    )
    expect(screen.getByTestId('where')).toHaveTextContent('/tokens/create?project=p1&chain=solana')
  })
})
