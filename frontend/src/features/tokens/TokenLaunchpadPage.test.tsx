import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { TokenLaunchpadPage } from './TokenLaunchpadPage'

vi.mock('../contracts/DeployPanel', () => ({ DeployPanel: () => <div>EVM deploy panel</div> }))
vi.mock('./SolanaTokenPanel', () => ({ SolanaTokenPanel: () => <div>Solana token panel</div> }))

function LocationProbe() {
  const location = useLocation()
  return <div data-testid="search">{location.search}</div>
}

function renderAt(url: string) {
  return render(
    <MemoryRouter initialEntries={[url]}>
      <TokenLaunchpadPage />
      <LocationProbe />
    </MemoryRouter>,
  )
}

describe('TokenLaunchpadPage chain switch', () => {
  it('defaults to EVM, so existing ?project=/?template= links keep working', () => {
    renderAt('/tokens?project=p1')
    expect(screen.getByText('EVM deploy panel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Ethereum, Polygon & BSC' })).toHaveAttribute('aria-pressed', 'true')
  })

  it('switches to Solana and back, keeping the choice in the URL', async () => {
    const user = userEvent.setup()
    renderAt('/tokens?project=p1')

    await user.click(screen.getByRole('button', { name: 'Solana' }))
    expect(screen.getByText('Solana token panel')).toBeInTheDocument()
    expect(screen.getByTestId('search')).toHaveTextContent('?project=p1&chain=solana')

    await user.click(screen.getByRole('button', { name: 'Ethereum, Polygon & BSC' }))
    expect(screen.getByText('EVM deploy panel')).toBeInTheDocument()
    expect(screen.getByTestId('search')).toHaveTextContent(/^\?project=p1$/)
  })

  it('opens straight on Solana from a ?chain=solana link', () => {
    renderAt('/tokens?chain=solana')
    expect(screen.getByText('Solana token panel')).toBeInTheDocument()
  })
})
