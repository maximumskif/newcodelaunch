import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import type { Project } from '../../lib/projectsApi'
import { projectsApi } from '../../lib/projectsApi'
import { useAuth } from '../auth/AuthContext'
import { ProjectsDashboard } from './ProjectsDashboard'

vi.mock('../auth/AuthContext', () => ({
  useAuth: vi.fn(),
}))

vi.mock('../../lib/projectsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/projectsApi')>()
  return {
    ...actual,
    projectsApi: { ...actual.projectsApi, list: vi.fn(), update: vi.fn(), remove: vi.fn() },
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

const baseProject: Project = {
  id: 'proj-1',
  name: 'My Drop',
  project_type: 'candy_machine',
  chain: 'solana',
  network: 'solana_devnet',
  status: 'active',
  draft_data: {},
  contract_deployment: null,
  nft_collection: null,
  candy_machine_deployment: {
    id: 'cm-1',
    nft_collection_id: 'col-1',
    network: 'solana_devnet',
    collection_mint: 'MINT1111111111111111111111111111111111111',
    candy_machine: 'CM111111111111111111111111111111111111111',
    price_sol: 0.5,
    items_available: 10,
    go_live_date: '2026-01-01T00:00:00Z',
    creator_wallet: 'CREATOR11111111111111111111111111111111111',
    transaction_signatures: ['sig1'],
    explorer_url: null,
    created_at: '2026-01-01T00:00:00Z',
  },
  created_at: '2026-01-01T00:00:00Z',
  updated_at: '2026-01-02T00:00:00Z',
}

function renderDashboard() {
  return render(
    <MemoryRouter>
      <ProjectsDashboard />
    </MemoryRouter>,
  )
}

describe('ProjectsDashboard', () => {
  it('prompts to sign in when there is no access token instead of calling the API', () => {
    vi.mocked(useAuth).mockReturnValue({ accessToken: null, user: null, login: vi.fn(), logout: vi.fn() })

    renderDashboard()

    expect(screen.getByText(/Connect and sign in/)).toBeInTheDocument()
    expect(projectsApi.list).not.toHaveBeenCalled()
  })

  it('renders a candy_machine project without crashing, showing its linked address', async () => {
    // Regression test: PROJECT_TYPES (frontend) didn't have a `candy_machine`
    // entry even though the backend's Project.to_dict() has included a
    // candy_machine_deployment link since Phase 6 — PROJECT_TYPES[project
    // .project_type] resolved to undefined and `const Icon = meta.icon`
    // threw, crashing the whole dashboard the moment any project had this
    // type.
    mockSignedIn()
    vi.mocked(projectsApi.list).mockResolvedValue({ projects: [baseProject] })

    renderDashboard()

    expect(await screen.findByText('My Drop')).toBeInTheDocument()
    expect(screen.getByText(/Candy Machine/)).toBeInTheDocument()
    expect(screen.getByText('CM11111111…')).toBeInTheDocument()
  })

  it('shows an empty state with no projects', async () => {
    mockSignedIn()
    vi.mocked(projectsApi.list).mockResolvedValue({ projects: [] })

    renderDashboard()

    expect(await screen.findByText('No projects yet')).toBeInTheDocument()
  })

  it('archives a project and reflects the new status without a full reload', async () => {
    mockSignedIn()
    const draftProject: Project = { ...baseProject, project_type: 'token', status: 'draft', candy_machine_deployment: null }
    vi.mocked(projectsApi.list).mockResolvedValue({ projects: [draftProject] })
    vi.mocked(projectsApi.update).mockResolvedValue({ project: { ...draftProject, status: 'archived' } })

    const user = userEvent.setup()
    renderDashboard()

    await screen.findByText('My Drop')
    await user.click(screen.getByText('Archive'))

    await waitFor(() => expect(projectsApi.update).toHaveBeenCalledWith('tok', 'proj-1', { status: 'archived' }))
    expect(await screen.findByText('Archived')).toBeInTheDocument()
  })

  it('deletes a project and removes its card', async () => {
    mockSignedIn()
    const draftProject: Project = { ...baseProject, project_type: 'token', status: 'draft', candy_machine_deployment: null }
    vi.mocked(projectsApi.list).mockResolvedValue({ projects: [draftProject] })
    vi.mocked(projectsApi.remove).mockResolvedValue(undefined)

    const user = userEvent.setup()
    renderDashboard()

    await screen.findByText('My Drop')
    await user.click(screen.getByLabelText('Delete project'))

    await waitFor(() => expect(projectsApi.remove).toHaveBeenCalledWith('tok', 'proj-1'))
    await waitFor(() => expect(screen.queryByText('My Drop')).not.toBeInTheDocument())
  })
})
