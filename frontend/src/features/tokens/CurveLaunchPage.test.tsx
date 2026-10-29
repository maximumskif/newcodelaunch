import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { contractsApi } from '../../lib/contractsApi'
import { useDeployTemplate } from '../contracts/useDeployTemplate'
import { CurveLaunchPage } from './CurveLaunchPage'

vi.mock('wagmi', () => ({ useAccount: vi.fn() }))

vi.mock('../contracts/useDeployTemplate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../contracts/useDeployTemplate')>()
  return { ...actual, useDeployTemplate: vi.fn() }
})

vi.mock('../network/NetworkContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../network/NetworkContext')>()
  return { ...actual, useNetwork: () => ({ network: 'sepolia', setNetwork: vi.fn() }) }
})

vi.mock('../../lib/contractsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/contractsApi')>()
  return { ...actual, contractsApi: { ...actual.contractsApi, listDeployments: vi.fn(), listDexes: vi.fn(), getCurveFee: vi.fn() } }
})

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'tok', user: null, login: vi.fn(), updateUser: vi.fn(), logout: vi.fn() }),
}))

// Stands in for the curve panel a finished launch shows; it reads the chain.
vi.mock('./CurvePanel', () => ({ CurvePanel: () => null }))

const FEE_WALLET = '0x000000000000000000000000000000000000FEE0'
const deploy = vi.fn()

const show = () =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter>
        <CurveLaunchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )

describe('CurveLaunchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(useAccount).mockReturnValue({ address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' } as unknown as ReturnType<typeof useAccount>)
    vi.mocked(useDeployTemplate).mockReturnValue({ deploy, step: 'idle', error: null, deployment: null, txHash: undefined })
    vi.mocked(contractsApi.listDeployments).mockResolvedValue({ deployments: [] })
    vi.mocked(contractsApi.listDexes).mockResolvedValue({
      dexes: {
        sepolia: {
          name: 'Uniswap V2',
          router: '0x0000000000000000000000000000000000000001',
          factory: '0x0000000000000000000000000000000000000002',
          wrapped_native: '0x0000000000000000000000000000000000000003',
        },
      },
    })
  })

  it("launches with the platform's fee wallet and says what the fee is", async () => {
    vi.mocked(contractsApi.getCurveFee).mockResolvedValue({ fee_bps: 100, recipient: FEE_WALLET })
    show()
    await userEvent.type(screen.getByPlaceholderText('Nova Coin'), 'Moon Cat')
    await userEvent.type(screen.getByPlaceholderText('NOVA'), 'MCAT')
    expect(screen.getByText('1% to the platform')).toBeInTheDocument()
    expect(screen.getByText(/pays a 1% fee to the platform/)).toBeInTheDocument()
    const launch = await screen.findByRole('button', { name: '[ launch on the curve ]' })
    await vi.waitFor(() => expect(launch).toBeEnabled())
    await userEvent.click(launch)
    expect(deploy).toHaveBeenCalledWith(
      'curve_token',
      expect.objectContaining({ FEE_RECIPIENT: FEE_WALLET, FACTORY: '0x0000000000000000000000000000000000000002' }),
      'sepolia',
      undefined,
      undefined,
      undefined,
    )
  })

  it("can't launch when the fee wallet isn't known", async () => {
    vi.mocked(contractsApi.getCurveFee).mockRejectedValue(new Error('not set up'))
    show()
    await userEvent.type(screen.getByPlaceholderText('Nova Coin'), 'Moon Cat')
    await userEvent.type(screen.getByPlaceholderText('NOVA'), 'MCAT')
    expect(await screen.findByText("Bonding-curve launches aren't available right now.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: '[ launch on the curve ]' })).toBeDisabled()
  })
})
