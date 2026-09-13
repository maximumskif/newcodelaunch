import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { contractsApi } from '../../lib/contractsApi'
import { TemplateMarketplacePage } from './TemplateMarketplacePage'

vi.mock('../../lib/contractsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/contractsApi')>()
  return {
    ...actual,
    contractsApi: { ...actual.contractsApi, listTemplates: vi.fn() },
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
})
