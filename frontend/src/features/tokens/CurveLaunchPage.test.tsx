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

const auth = vi.hoisted(() => ({ token: 'tok' as string | null }))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ accessToken: auth.token, user: null, login: vi.fn(), updateUser: vi.fn(), logout: vi.fn() }),
}))

// Stands in for the curve panel a finished launch shows; it reads the chain.
vi.mock('./CurvePanel', () => ({ CurvePanel: () => null }))

const FEE_WALLET = '0x000000000000000000000000000000000000FEE0'
const deploy = vi.fn()

const show = (path = '/tokens/curve') =>
  render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <MemoryRouter initialEntries={[path]}>
        <CurveLaunchPage />
      </MemoryRouter>
    </QueryClientProvider>,
  )

describe('CurveLaunchPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    auth.token = 'tok'
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
    vi.mocked(contractsApi.getCurveFee).mockResolvedValue({ fee_bps: 100, creator_fee_bps: 30, recipient: FEE_WALLET })
    show()
    await userEvent.type(screen.getByPlaceholderText('Nova Coin'), 'Moon Cat')
    await userEvent.type(screen.getByPlaceholderText('NOVA'), 'MCAT')
    expect(screen.getByText('1%: 0.3% to you, 0.7% to the platform')).toBeInTheDocument()
    expect(screen.getByText(/0\.3% of the trade to you, as the creator/)).toBeInTheDocument()
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

  it('fills in a launch from a Telegram link', async () => {
    vi.mocked(contractsApi.getCurveFee).mockResolvedValue({ fee_bps: 100, creator_fee_bps: 30, recipient: FEE_WALLET })
    show('/tokens/curve?name=Moon+Cat&symbol=MCAT&network=sepolia&ref=telegram')
    expect(screen.getByPlaceholderText('Nova Coin')).toHaveValue('Moon Cat')
    expect(screen.getByPlaceholderText('NOVA')).toHaveValue('MCAT')
    expect(screen.getByTestId('curve-from-telegram')).toHaveTextContent('From Telegram: Moon Cat ($MCAT) on Sepolia. Check the details below')
    const launch = await screen.findByRole('button', { name: '[ launch on the curve ]' })
    await vi.waitFor(() => expect(launch).toBeEnabled())
    await userEvent.click(launch)
    expect(deploy).toHaveBeenCalledWith('curve_token', expect.objectContaining({ TOKEN_NAME: 'Moon Cat', TOKEN_SYMBOL: 'MCAT' }), 'sepolia', undefined, undefined, undefined)
  })

  it('ignores a network it does not know', () => {
    vi.mocked(contractsApi.getCurveFee).mockResolvedValue({ fee_bps: 100, creator_fee_bps: 30, recipient: FEE_WALLET })
    show('/tokens/curve?name=Moon+Cat&network=nowhere')
    expect(screen.getByRole('combobox')).toHaveValue('sepolia')
    expect(screen.queryByTestId('curve-from-telegram')).not.toBeInTheDocument()
  })

  it('shows the Telegram coin before sign-in', () => {
    auth.token = null
    vi.mocked(contractsApi.getCurveFee).mockResolvedValue({ fee_bps: 100, creator_fee_bps: 30, recipient: FEE_WALLET })
    show('/tokens/curve?name=Moon+Cat&symbol=MCAT&network=sepolia&ref=telegram')
    expect(screen.getByTestId('curve-from-telegram')).toHaveTextContent('From Telegram: Moon Cat ($MCAT) on Sepolia. Sign in below')
  })
})
