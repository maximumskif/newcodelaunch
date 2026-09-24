import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { Project } from '../../lib/projectsApi'
import { projectsApi } from '../../lib/projectsApi'
import { useAuth } from '../auth/AuthContext'
import { ProjectContextBar } from './ProjectContextBar'

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
    projectsApi: { ...actual.projectsApi, list: vi.fn() },
  }
})

function mockSignedIn() {
  vi.mocked(useAuth).mockReturnValue({
    accessToken: 'tok',
    user: { id: 'user-1', wallet_address: '0xabc', chain: 'evm', wallets: [], created_at: '2026-01-01T00:00:00Z' },
    login: vi.fn(),
    updateUser: vi.fn(),
    logout: vi.fn(),
  })
}

const currentProject: Project = {
  id: 'proj-1',
  name: 'Current NFT Drop',
  project_type: 'nft_collection',
  chain: 'evm',
  network: null,
  status: 'draft',
  draft_data: {},
  contract_deployment: null,
  nft_collection: null,
  solana_token_launch: null,
  candy_machine_deployment: null,
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-01T00:00:00Z',
}

const otherProject: Project = {
  ...currentProject,
  id: 'proj-2',
  name: 'My Token Launch',
  project_type: 'token',
}

function renderBar(project: Project = currentProject) {
  return render(
    <MemoryRouter>
      <ProjectContextBar project={project} currentStepLabel="Configure" isLinked={false} />
    </MemoryRouter>,
  )
}

describe('ProjectContextBar', () => {
  it('renders the current project name and step badge', () => {
    mockSignedIn()
    vi.mocked(projectsApi.list).mockResolvedValue({ projects: [currentProject] })

    renderBar()

    expect(screen.getByText('Current NFT Drop')).toBeInTheDocument()
    expect(screen.getByText('Configure')).toBeInTheDocument()
  })

  it('lists other projects in the switcher, excluding the current one', async () => {
    mockSignedIn()
    vi.mocked(projectsApi.list).mockResolvedValue({ projects: [currentProject, otherProject] })

    const user = userEvent.setup()
    renderBar()

    await user.click(screen.getByText('Switch project'))

    expect(await screen.findByText('My Token Launch')).toBeInTheDocument()
    // The current project must not list itself as something to switch to.
    expect(screen.queryByRole('button', { name: /Current NFT Drop/ })).not.toBeInTheDocument()
  })

  it('navigates to another project\'s own page (by its project_type) when clicked', async () => {
    mockSignedIn()
    vi.mocked(projectsApi.list).mockResolvedValue({ projects: [currentProject, otherProject] })

    const user = userEvent.setup()
    renderBar()

    await user.click(screen.getByText('Switch project'))
    await user.click(await screen.findByText('My Token Launch'))

    expect(navigateMock).toHaveBeenCalledWith('/tokens?project=proj-2')
  })

  it('shows "no other projects" instead of an empty or perpetually loading list', async () => {
    mockSignedIn()
    vi.mocked(projectsApi.list).mockResolvedValue({ projects: [currentProject] })

    const user = userEvent.setup()
    renderBar()

    await user.click(screen.getByText('Switch project'))

    expect(await screen.findByText('No other projects yet.')).toBeInTheDocument()
  })

  it('degrades to "no other projects" instead of an unhandled rejection when the fetch fails', async () => {
    mockSignedIn()
    vi.mocked(projectsApi.list).mockRejectedValue(new Error('network down'))

    const user = userEvent.setup()
    renderBar()

    await user.click(screen.getByText('Switch project'))

    expect(await screen.findByText('No other projects yet.')).toBeInTheDocument()
  })
})
