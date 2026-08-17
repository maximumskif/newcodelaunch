import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { describe, expect, it, vi } from 'vitest'

import { contractsApi, type ContractTemplateSummary } from '../../lib/contractsApi'
import { projectsApi, type Project } from '../../lib/projectsApi'
import { useAuth } from '../auth/AuthContext'
import { NetworkProvider, useNetwork } from '../network/NetworkContext'
import { DeployPanel } from './DeployPanel'
import { useDeployTemplate } from './useDeployTemplate'

// AppShell's real top-bar network selector lives outside DeployPanel — this
// stands in for it, sharing the same NetworkProvider, so a test can trigger
// a live network switch the same way a user actually would.
function NetworkSwitcherStub() {
  const { setNetwork } = useNetwork()
  return (
    <>
      <button type="button" onClick={() => setNetwork('ethereum')}>
        switch to ethereum
      </button>
      <button type="button" onClick={() => setNetwork('polygon')}>
        switch to polygon
      </button>
    </>
  )
}

vi.mock('wagmi', () => ({ useAccount: vi.fn() }))

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }))

vi.mock('./useDeployTemplate', () => ({ useDeployTemplate: vi.fn() }))

vi.mock('../../lib/contractsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/contractsApi')>()
  return {
    ...actual,
    contractsApi: { ...actual.contractsApi, listTemplates: vi.fn(), listDeployments: vi.fn() },
  }
})

vi.mock('../../lib/projectsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/projectsApi')>()
  return {
    ...actual,
    projectsApi: { ...actual.projectsApi, get: vi.fn(), update: vi.fn() },
  }
})

const TOKEN_TEMPLATE: ContractTemplateSummary = {
  id: 'erc20_basic',
  name: 'ERC-20 Basic',
  type: 'erc20',
  description: 'A basic fungible token.',
  deployment_params: [],
  features: [],
  gas_estimate: 500000,
}

function baseProject(overrides: Partial<Project> = {}): Project {
  return {
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
    ...overrides,
  }
}

function mockConnectedWallet() {
  vi.mocked(useAccount).mockReturnValue({ address: '0xConnected000000000000000000000000000000' } as unknown as ReturnType<typeof useAccount>)
}

function mockIdleDeployHook() {
  vi.mocked(useDeployTemplate).mockReturnValue({
    deploy: vi.fn(),
    step: 'idle',
    error: null,
    deployment: null,
    txHash: undefined,
  })
}

function renderPanel(projectId?: string) {
  return render(
    <MemoryRouter>
      <NetworkProvider>
        <DeployPanel title="Token Launchpad" description="desc" templateType="erc20" projectId={projectId ?? null} />
      </NetworkProvider>
    </MemoryRouter>,
  )
}

describe('DeployPanel', () => {
  it('requires the mainnet confirmation checkbox before Deploy is enabled on a mainnet network', async () => {
    // Regression test: DeployPanel's own draft-restore is the only way this
    // component ever lands on a mainnet network in tests (the network
    // selector itself lives in AppShell's top bar) — resuming a project
    // whose saved network is 'ethereum' should show the mainnet gate.
    mockConnectedWallet()
    vi.mocked(useAuth).mockReturnValue({ accessToken: 'tok', user: null, login: vi.fn(), logout: vi.fn() })
    mockIdleDeployHook()
    vi.mocked(contractsApi.listTemplates).mockResolvedValue({ templates: [TOKEN_TEMPLATE] })
    vi.mocked(contractsApi.listDeployments).mockResolvedValue({ deployments: [] })
    vi.mocked(projectsApi.get).mockResolvedValue({ project: baseProject({ network: 'ethereum' }) })

    const user = userEvent.setup()
    renderPanel('proj-1')

    const deployButton = await screen.findByRole('button', { name: 'Deploy' })
    expect(deployButton).toBeDisabled()

    const checkbox = await screen.findByRole('checkbox')
    await user.click(checkbox)

    expect(deployButton).toBeEnabled()
  })

  it('re-arms the mainnet checkbox on a live network switch instead of carrying the tick over', async () => {
    mockConnectedWallet()
    vi.mocked(useAuth).mockReturnValue({ accessToken: 'tok', user: null, login: vi.fn(), logout: vi.fn() })
    mockIdleDeployHook()
    vi.mocked(contractsApi.listTemplates).mockResolvedValue({ templates: [TOKEN_TEMPLATE] })
    vi.mocked(contractsApi.listDeployments).mockResolvedValue({ deployments: [] })

    const user = userEvent.setup()
    render(
      <NetworkProvider>
        <NetworkSwitcherStub />
        <DeployPanel title="Token Launchpad" description="desc" templateType="erc20" />
      </NetworkProvider>,
    )

    // Starts on sepolia (testnet) — no gate yet.
    let deployButton = await screen.findByRole('button', { name: 'Deploy' })
    expect(deployButton).toBeEnabled()

    await user.click(screen.getByText('switch to ethereum'))
    deployButton = screen.getByRole('button', { name: 'Deploy' })
    expect(deployButton).toBeDisabled()

    await user.click(screen.getByRole('checkbox'))
    expect(deployButton).toBeEnabled()

    // Switching again (still mainnet, but a different one) must re-arm —
    // this is the exact bug the correctness review pass fixed: `isMainnet`
    // alone doesn't change value here (true -> true), only the effect keyed
    // on `network` catches it.
    await user.click(screen.getByText('switch to polygon'))
    expect(deployButton).toBeDisabled()
  })

  it('does not show the mainnet gate on a testnet, and Deploy is enabled once a wallet is connected', async () => {
    mockConnectedWallet()
    vi.mocked(useAuth).mockReturnValue({ accessToken: 'tok', user: null, login: vi.fn(), logout: vi.fn() })
    mockIdleDeployHook()
    vi.mocked(contractsApi.listTemplates).mockResolvedValue({ templates: [TOKEN_TEMPLATE] })
    vi.mocked(contractsApi.listDeployments).mockResolvedValue({ deployments: [] })

    renderPanel()

    const deployButton = await screen.findByRole('button', { name: 'Deploy' })
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument()
    expect(deployButton).toBeEnabled()
  })

  it('disables Deploy and Estimate when no wallet is connected', async () => {
    vi.mocked(useAccount).mockReturnValue({ address: undefined } as unknown as ReturnType<typeof useAccount>)
    vi.mocked(useAuth).mockReturnValue({ accessToken: null, user: null, login: vi.fn(), logout: vi.fn() })
    mockIdleDeployHook()
    vi.mocked(contractsApi.listTemplates).mockResolvedValue({ templates: [TOKEN_TEMPLATE] })

    renderPanel()

    expect(await screen.findByRole('button', { name: 'Deploy' })).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Estimate cost' })).toBeDisabled()
    expect(screen.getByText('Connect an EVM wallet to estimate or deploy')).toBeInTheDocument()
  })

  it('autosaves the draft including the current network, not just template/parameters', async () => {
    // Regression test: a prior bug (first correctness review pass) had the
    // autosave payload omit `network` entirely, so resuming a project always
    // reverted a manual mid-session network switch. The restore effect here
    // sets network to 'polygon_amoy' — the autosave that follows must carry
    // that same value, not the NetworkProvider's own 'sepolia' default.
    mockConnectedWallet()
    vi.mocked(useAuth).mockReturnValue({ accessToken: 'tok', user: null, login: vi.fn(), logout: vi.fn() })
    mockIdleDeployHook()
    vi.mocked(contractsApi.listTemplates).mockResolvedValue({ templates: [TOKEN_TEMPLATE] })
    vi.mocked(contractsApi.listDeployments).mockResolvedValue({ deployments: [] })
    vi.mocked(projectsApi.get).mockResolvedValue({
      project: baseProject({ network: 'polygon_amoy', draft_data: { template_id: 'erc20_basic', parameters: {} } }),
    })
    vi.mocked(projectsApi.update).mockResolvedValue({ project: baseProject({ network: 'polygon_amoy' }) })

    renderPanel('proj-1')

    await screen.findByRole('button', { name: 'Deploy' })

    await waitFor(
      () =>
        expect(projectsApi.update).toHaveBeenCalledWith('tok', 'proj-1', {
          draft_data: { template_id: 'erc20_basic', parameters: {} },
          network: 'polygon_amoy',
        }),
      { timeout: 3000 },
    )
  })
})
