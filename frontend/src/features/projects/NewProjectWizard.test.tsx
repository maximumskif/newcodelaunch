import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { projectsApi } from '../../lib/projectsApi'
import { useAuth } from '../auth/AuthContext'
import { NewProjectWizard } from './NewProjectWizard'

const navigateMock = vi.fn()

vi.mock('react-router-dom', async (importOriginal) => {
  const actual = await importOriginal<typeof import('react-router-dom')>()
  return { ...actual, useNavigate: () => navigateMock }
})

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../../lib/projectsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/projectsApi')>()
  return {
    ...actual,
    projectsApi: { ...actual.projectsApi, create: vi.fn() },
  }
})

function mockSignedIn() {
  vi.mocked(useAuth).mockReturnValue({
    accessToken: 'tok',
    user: { id: 'user-1', wallet_address: '0xabc', chain: 'evm', created_at: '2026-01-01T00:00:00Z' },
    login: vi.fn(),
    logout: vi.fn(),
  })
}

function renderWizard() {
  return render(
    <MemoryRouter>
      <NewProjectWizard />
    </MemoryRouter>,
  )
}

describe('NewProjectWizard', () => {
  it('prompts to sign in when there is no access token', () => {
    vi.mocked(useAuth).mockReturnValue({ accessToken: null, user: null, login: vi.fn(), logout: vi.fn() })

    renderWizard()

    expect(screen.getByText('Connect and sign in with a wallet first.')).toBeInTheDocument()
  })

  it('only offers wizard-creatable types — candy_machine is excluded', () => {
    // Regression test: PROJECT_TYPES gained a candy_machine entry (for the
    // dashboard's sake) and this picker used to iterate PROJECT_TYPES
    // directly, which would have let a visitor "create" a candy_machine
    // project with chain:'evm' and an EVM network — nonsensical, since a
    // candy machine's only real entry point is an already-published NFT
    // collection. The picker must read WIZARD_PROJECT_TYPES instead.
    mockSignedIn()

    renderWizard()

    expect(screen.getByText('Token')).toBeInTheDocument()
    expect(screen.getByText('NFT Collection')).toBeInTheDocument()
    expect(screen.getByText('Custom Contract')).toBeInTheDocument()
    expect(screen.queryByText('Candy Machine')).not.toBeInTheDocument()
  })

  it('hides the network picker for a type that has no network concept', async () => {
    mockSignedIn()
    const user = userEvent.setup()

    renderWizard()
    await user.click(screen.getByText('NFT Collection'))

    expect(screen.queryByText('Network')).not.toBeInTheDocument()
  })

  it('shows the network picker for a type that needs one', async () => {
    mockSignedIn()
    const user = userEvent.setup()

    renderWizard()
    await user.click(screen.getByText('Token'))

    expect(screen.getByText('Network')).toBeInTheDocument()
  })

  it('creates a draft project and navigates into its feature page', async () => {
    mockSignedIn()
    vi.mocked(projectsApi.create).mockResolvedValue({
      project: {
        id: 'proj-1',
        name: 'My Token',
        project_type: 'token',
        chain: 'evm',
        network: 'sepolia',
        status: 'draft',
        draft_data: {},
        contract_deployment: null,
        nft_collection: null,
        candy_machine_deployment: null,
        created_at: '2026-01-01T00:00:00Z',
        updated_at: '2026-01-01T00:00:00Z',
      },
    })

    const user = userEvent.setup()
    renderWizard()

    await user.click(screen.getByText('Token'))
    await user.type(screen.getByPlaceholderText('My token'), 'My Token')
    await user.click(screen.getByText('Create draft and continue'))

    await waitFor(() =>
      expect(projectsApi.create).toHaveBeenCalledWith('tok', {
        name: 'My Token',
        project_type: 'token',
        chain: 'evm',
        network: 'sepolia',
      }),
    )
    expect(navigateMock).toHaveBeenCalledWith('/tokens?project=proj-1')
  })
})
