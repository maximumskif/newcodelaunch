import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render as rtlRender, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import { parseEther, zeroAddress } from 'viem'
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { parseAmount } from '../../lib/amounts'
import { contractsApi, type ContractDeployment } from '../../lib/contractsApi'
import { LiquidityPanel } from './LiquidityPanel'

vi.mock('wagmi', () => ({
  useAccount: vi.fn(),
  useChainId: vi.fn(),
  usePublicClient: vi.fn(),
  useSwitchChain: vi.fn(),
  useWaitForTransactionReceipt: vi.fn(),
  useWriteContract: vi.fn(),
}))

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'tok', user: null, login: vi.fn(), updateUser: vi.fn(), logout: vi.fn() }),
}))

vi.mock('../../lib/contractsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/contractsApi')>()
  return {
    ...actual,
    contractsApi: { ...actual.contractsApi, listDexes: vi.fn(), listLiquidity: vi.fn(), recordLiquidity: vi.fn() },
  }
})

const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const TOKEN = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const PAIR = '0x1111111111111111111111111111111111111111'
const DEX = {
  name: 'Uniswap V2',
  router: '0x2222222222222222222222222222222222222222',
  factory: '0x3333333333333333333333333333333333333333',
  wrapped_native: '0x4444444444444444444444444444444444444444',
} as const

const basic = { id: 'dep-1', network: 'sepolia', contract_address: TOKEN, template_id: 'erc20_basic', contract_type: 'erc20' } as ContractDeployment
const advanced = { ...basic, template_id: 'erc20_advanced' } as ContractDeployment

const writeContractAsync = vi.fn()
let receipt: { data?: { status: 'success' | 'reverted' } } = { data: undefined }

interface ChainState {
  lpMine?: bigint
  lpAllowance?: bigint
  allowance?: bigint
  pair?: string
  reserves?: [bigint, bigint]
  pairRegistered?: boolean | 'legacy'
  tradingEnabled?: boolean
}

function mockChain({ lpMine = 0n, lpAllowance = 0n, allowance = 0n, pair = zeroAddress, reserves = [0n, 0n], pairRegistered = false, tradingEnabled = true }: ChainState = {}) {
  vi.mocked(useAccount).mockReturnValue({ address: OWNER } as unknown as ReturnType<typeof useAccount>)
  vi.mocked(useChainId).mockReturnValue(11155111)
  vi.mocked(useSwitchChain).mockReturnValue({ switchChainAsync: vi.fn() } as unknown as ReturnType<typeof useSwitchChain>)
  vi.mocked(useWriteContract).mockReturnValue({ writeContractAsync } as unknown as ReturnType<typeof useWriteContract>)
  vi.mocked(useWaitForTransactionReceipt).mockImplementation(() => receipt as ReturnType<typeof useWaitForTransactionReceipt>)
  const values: Record<string, unknown> = {
    symbol: 'TKN',
    decimals: 18,
    getPair: pair,
    balanceOf: parseEther('1000000'),
    allowance,
    getReserves: [...reserves, 0],
    token0: TOKEN,
    totalSupply: parseEther('100'),
    owner: OWNER,
    tradingEnabled,
    buyTaxRate: 300n,
    maxTransactionAmount: parseEther('10000'),
    maxWalletAmount: parseEther('20000'),
  }
  // The pair's own ERC-20 reads (LP tokens) differ from the token's.
  const pairValues: Record<string, unknown> = { balanceOf: lpMine, allowance: lpAllowance }
  vi.mocked(usePublicClient).mockReturnValue({
    getBalance: vi.fn(async () => parseEther('10')),
    readContract: vi.fn(async ({ address, functionName }: { address: string; functionName: string }) => {
      if (address === PAIR && functionName in pairValues) return pairValues[functionName]
      if (functionName === 'marketPairs') {
        if (pairRegistered === 'legacy') throw new Error('execution reverted')
        return pairRegistered
      }
      return values[functionName]
    }),
  } as unknown as ReturnType<typeof usePublicClient>)
}

function render(ui: ReactElement) {
  return rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)
}

describe('parseAmount', () => {
  it('takes positive amounts within the token’s decimals', () => {
    expect(parseAmount('1.5', 18)).toBe(1_500_000_000_000_000_000n)
    expect(parseAmount(' 2 ', 0)).toBe(2n)
    expect(parseAmount('0', 18)).toBeNull()
    expect(parseAmount('1.23', 1)).toBeNull()
    expect(parseAmount('-1', 18)).toBeNull()
    expect(parseAmount('1e3', 18)).toBeNull()
  })
})

describe('LiquidityPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    receipt = { data: undefined }
    writeContractAsync.mockResolvedValue('0xhash')
    vi.mocked(contractsApi.listDexes).mockResolvedValue({ dexes: { sepolia: DEX } })
    vi.mocked(contractsApi.listLiquidity).mockResolvedValue({ provisions: [] })
  })

  it('says so on a network without a DEX', async () => {
    mockChain()
    render(<LiquidityPanel deployment={{ ...basic, network: 'polygon_amoy' }} />)
    expect(await screen.findByText(/No supported DEX on polygon_amoy/)).toBeInTheDocument()
  })

  it('creates a pool: approve first, then add at exactly the amounts given', async () => {
    mockChain()
    const user = userEvent.setup()
    const { unmount } = render(<LiquidityPanel deployment={basic} />)
    expect(await screen.findByText('No liquidity yet')).toBeInTheDocument()
    await user.type(screen.getByLabelText(/TKN to add/), '100000')
    await user.type(screen.getByLabelText(/ETH to add/), '1')
    expect(screen.getByText('Starting price: 1 TKN = 0.00001 ETH')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve TKN' }))
    expect(writeContractAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ address: TOKEN, functionName: 'approve', args: [DEX.router, parseEther('100000')] }),
    )
    unmount()

    mockChain({ allowance: parseEther('100000') })
    render(<LiquidityPanel deployment={basic} />)
    await user.type(await screen.findByLabelText(/TKN to add/), '100000')
    await user.type(screen.getByLabelText(/ETH to add/), '1')
    await user.click(screen.getByRole('button', { name: 'Add liquidity' }))
    const call = writeContractAsync.mock.lastCall![0]
    expect(call).toMatchObject({ address: DEX.router, functionName: 'addLiquidityETH', value: parseEther('1') })
    // A new pool takes exactly these amounts — no slippage allowance.
    expect(call.args.slice(0, 5)).toEqual([TOKEN, parseEther('100000'), parseEther('100000'), parseEther('1'), OWNER])
  })

  it('adds to an existing pool at its price, with 1% slippage, and records the result', async () => {
    mockChain({ allowance: parseEther('1000000'), pair: PAIR, reserves: [parseEther('50000'), parseEther('2')] })
    vi.mocked(contractsApi.recordLiquidity).mockResolvedValue({ provision: {} as never })
    const user = userEvent.setup()
    const { rerender } = render(<LiquidityPanel deployment={basic} />)
    expect(await screen.findByText('Pool live')).toBeInTheDocument()
    expect(screen.queryByLabelText(/ETH to add/, { selector: 'input' })).not.toBeInTheDocument()
    await user.type(screen.getByLabelText(/TKN to add/), '1000')
    expect(screen.getByText('0.04')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Add liquidity' }))
    const call = writeContractAsync.mock.lastCall![0]
    expect(call.value).toBe(parseEther('0.04'))
    expect(call.args.slice(1, 4)).toEqual([parseEther('1000'), parseEther('990'), parseEther('0.0396')])

    receipt = { data: { status: 'success' } }
    rerender(
      <QueryClientProvider client={new QueryClient()}>
        <LiquidityPanel deployment={basic} />
      </QueryClientProvider>,
    )
    await waitFor(() => expect(contractsApi.recordLiquidity).toHaveBeenCalledWith('tok', 'dep-1', '0xhash'))
  })

  it('refuses more than the wallet holds', async () => {
    mockChain({ allowance: parseEther('1000000000') })
    const user = userEvent.setup()
    render(<LiquidityPanel deployment={basic} />)
    await user.type(await screen.findByLabelText(/TKN to add/), '2000000')
    await user.type(screen.getByLabelText(/ETH to add/), '1')
    expect(screen.getByText('That’s more than this wallet holds.'.replace('’', "'"))).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add liquidity' })).toBeDisabled()
  })

  it('offers to register an advanced token’s new pool as its trading pair', async () => {
    mockChain({ pair: PAIR, reserves: [parseEther('50000'), parseEther('2')], tradingEnabled: false })
    const user = userEvent.setup()
    render(<LiquidityPanel deployment={advanced} />)
    expect(await screen.findByText(/aren't taxed until it's registered/)).toBeInTheDocument()
    expect(screen.getByText(/Trading isn't enabled yet/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Register as trading pair' }))
    expect(writeContractAsync).toHaveBeenLastCalledWith(expect.objectContaining({ address: TOKEN, functionName: 'setMarketPair', args: [PAIR, true] }))
  })

  it('doesn’t nag about a pair that’s registered, and explains a legacy token', async () => {
    mockChain({ pair: PAIR, reserves: [parseEther('50000'), parseEther('2')], pairRegistered: true })
    const { unmount } = render(<LiquidityPanel deployment={advanced} />)
    expect(await screen.findByText('Pool live')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Register as trading pair' })).not.toBeInTheDocument()
    unmount()

    mockChain({ pair: PAIR, reserves: [parseEther('50000'), parseEther('2')], pairRegistered: 'legacy' })
    render(<LiquidityPanel deployment={advanced} />)
    expect(await screen.findByText(/earlier template version/)).toBeInTheDocument()
  })

  it('removes a share of the position at the pool’s ratio: approve the LP tokens, then remove with 1% slippage', async () => {
    const pool = { pair: PAIR, reserves: [parseEther('50000'), parseEther('2')] as [bigint, bigint] }
    mockChain({ ...pool, lpMine: parseEther('10') })
    const user = userEvent.setup()
    const { unmount } = render(<LiquidityPanel deployment={basic} />)
    await user.type(await screen.findByLabelText(/Share of your position/), '50')
    // 5 of 100 LP tokens: 5% of each reserve.
    expect(screen.getByText(/You get about 2500 TKN \+ 0.1 ETH/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Approve LP tokens' }))
    expect(writeContractAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ address: PAIR, functionName: 'approve', args: [DEX.router, parseEther('5')] }),
    )
    unmount()

    mockChain({ ...pool, lpMine: parseEther('10'), lpAllowance: parseEther('5') })
    render(<LiquidityPanel deployment={basic} />)
    await user.type(await screen.findByLabelText(/Share of your position/), '50')
    await user.click(screen.getByRole('button', { name: 'Remove liquidity' }))
    const call = writeContractAsync.mock.lastCall![0]
    expect(call).toMatchObject({ address: DEX.router, functionName: 'removeLiquidityETHSupportingFeeOnTransferTokens' })
    expect(call.args.slice(0, 5)).toEqual([TOKEN, parseEther('5'), parseEther('2475'), parseEther('0.099'), OWNER])
  })

  it('warns that an advanced token taxes a removal, and blocks one over its transfer limit', async () => {
    mockChain({ pair: PAIR, reserves: [parseEther('50000'), parseEther('2')], lpMine: parseEther('100'), lpAllowance: parseEther('100'), pairRegistered: true })
    const user = userEvent.setup()
    render(<LiquidityPanel deployment={advanced} />)
    await user.type(await screen.findByLabelText(/Share of your position/), '10')
    // 5000 TKN out, less the 3% buy tax.
    expect(screen.getByText(/You get about 4850 TKN/)).toBeInTheDocument()
    expect(screen.getByText(/3% buy tax/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove liquidity' })).toBeEnabled()

    await user.clear(screen.getByLabelText(/Share of your position/))
    await user.type(screen.getByLabelText(/Share of your position/), '30')
    expect(screen.getByText(/more TKN than this token lets move in one transfer \(10000\)/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Remove liquidity' })).toBeDisabled()
  })

  it('offers no removal without a position', async () => {
    mockChain({ pair: PAIR, reserves: [parseEther('50000'), parseEther('2')] })
    render(<LiquidityPanel deployment={basic} />)
    expect(await screen.findByText('Pool live')).toBeInTheDocument()
    expect(screen.queryByTestId('liquidity-remove')).not.toBeInTheDocument()
  })
})
