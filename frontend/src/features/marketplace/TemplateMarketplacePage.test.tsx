import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { contractsApi } from '../../lib/contractsApi'
import { TemplateMarketplacePage } from './TemplateMarketplacePage'

vi.mock('../../lib/contractsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/contractsApi')>()
  return {
    ...actual,
    contractsApi: { ...actual.contractsApi, listTemplates: vi.fn(), getTemplate: vi.fn() },
  }
})

describe('TemplateMarketplacePage', () => {
  it('shows an error instead of a silent blank grid when loading templates fails', async () => {
    // Regression: the fetch had no .catch() — a failed request left
    // `templates` as [], rendering an empty grid with zero indication
    // anything went wrong, indistinguishable from "no templates exist".
    vi.mocked(contractsApi.listTemplates).mockRejectedValue(new Error('Network error'))

    render(
      <MemoryRouter>
        <TemplateMarketplacePage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Could not load templates')).toBeInTheDocument()
    expect(screen.getByText('Network error')).toBeInTheDocument()
  })

  it('renders the real templates on success', async () => {
    vi.mocked(contractsApi.listTemplates).mockResolvedValue({
      templates: [
        {
          id: 'erc20_basic',
          name: 'Basic ERC-20 Token',
          type: 'erc20',
          description: 'A standard token',
          deployment_params: [],
          features: ['Mint', 'Burn'],
          gas_estimate: 900000,
        },
      ],
    })

    render(
      <MemoryRouter>
        <TemplateMarketplacePage />
      </MemoryRouter>,
    )

    expect(await screen.findByText('Basic ERC-20 Token')).toBeInTheDocument()
    expect(screen.queryByText('Could not load templates')).not.toBeInTheDocument()
  })

  it('shows a template\'s Solidity source on request', async () => {
    const template = {
      id: 'token_timelock', name: 'Token Time-Lock', type: 'lock' as const, description: 'Locks tokens',
      deployment_params: [], features: ['No Owner'], gas_estimate: 400000,
    }
    vi.mocked(contractsApi.listTemplates).mockResolvedValue({ templates: [template] })
    vi.mocked(contractsApi.getTemplate).mockResolvedValue({ template: { ...template, solidity_code: 'contract TokenTimeLock { /* {{TOKEN}} */ }' } })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter>
          <TemplateMarketplacePage />
        </MemoryRouter>
      </QueryClientProvider>,
    )

    await userEvent.click(await screen.findByRole('button', { name: 'View source' }))

    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByText('Token Time-Lock — source')).toBeInTheDocument()
    expect(await within(dialog).findByText(/contract TokenTimeLock/)).toBeInTheDocument()
    expect(contractsApi.getTemplate).toHaveBeenCalledWith('token_timelock')
  })
})
