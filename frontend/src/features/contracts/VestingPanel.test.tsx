import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import { parseEther } from 'viem'
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContractDeployment } from '../../lib/contractsApi'
import { VestingPanel } from './VestingPanel'

vi.mock('wagmi', () => ({
  useAccount: vi.fn(),
  useChainId: vi.fn(),
  usePublicClient: vi.fn(),
  useSwitchChain: vi.fn(),
  useWaitForTransactionReceipt: vi.fn(),
  useWriteContract: vi.fn(),
}))

const VESTING = '0x6666666666666666666666666666666666666666'
const TOKEN = '0x1111111111111111111111111111111111111111'
const WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const deployment = { id: 'vest-1', network: 'sepolia', contract_address: VESTING, template_id: 'token_vesting' } as ContractDeployment
const writeContractAsync = vi.fn()

// A 400-token schedule from t=1000 to t=2000 with a cliff at 1250, read at `now`.
function mockVesting({ now, held = parseEther('400'), released = 0n, releasable = 0n }: { now: number; held?: bigint; released?: bigint; releasable?: bigint }) {
  vi.mocked(useAccount).mockReturnValue({ address: WALLET } as unknown as ReturnType<typeof useAccount>)
  vi.mocked(useChainId).mockReturnValue(11155111)
  vi.mocked(useSwitchChain).mockReturnValue({ switchChainAsync: vi.fn() } as unknown as ReturnType<typeof useSwitchChain>)
  vi.mocked(useWriteContract).mockReturnValue({ writeContractAsync } as unknown as ReturnType<typeof useWriteContract>)
  vi.mocked(useWaitForTransactionReceipt).mockReturnValue({ data: undefined } as ReturnType<typeof useWaitForTransactionReceipt>)
  const values: Record<string, unknown> = {
    token: TOKEN,
    beneficiary: '0x2222222222222222222222222222222222222222',
    startTime: 1000n,
    cliffTime: 1250n,
    endTime: 2000n,
    released,
    releasable,
    symbol: 'TEAM',
    decimals: 18,
  }
  vi.mocked(usePublicClient).mockReturnValue({
    readContract: vi.fn(async ({ functionName, args }: { functionName: string; args?: string[] }) =>
      functionName === 'balanceOf' ? (args![0] === VESTING ? held : parseEther('1000')) : values[functionName],
    ),
    getBlock: vi.fn(async () => ({ timestamp: BigInt(now) })),
  } as unknown as ReturnType<typeof usePublicClient>)
}

const render = (ui: ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)

describe('VestingPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    writeContractAsync.mockResolvedValue('0xhash')
  })

  it('shows the cliff and nothing to release before it', async () => {
    mockVesting({ now: 1100 })
    render(<VestingPanel deployment={deployment} />)
    expect(await screen.findByText(/^Cliff until/)).toBeInTheDocument()
    expect(screen.getByText(/^0% vested/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Nothing to release yet' })).toBeDisabled()
  })

  it('releases what has vested, counting what was already paid out', async () => {
    mockVesting({ now: 1500, held: parseEther('300'), released: parseEther('100'), releasable: parseEther('100') })
    const user = userEvent.setup()
    render(<VestingPanel deployment={deployment} />)
    expect(await screen.findByText('400 TEAM in total')).toBeInTheDocument()
    expect(screen.getByText('50% vested · 100 TEAM paid out · 100 TEAM ready to release')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Release 100 TEAM to beneficiary' }))
    expect(writeContractAsync).toHaveBeenCalledWith(expect.objectContaining({ address: VESTING, functionName: 'release' }))
  })

  it('funds an empty schedule with a plain transfer of the prefilled amount', async () => {
    mockVesting({ now: 1100, held: 0n })
    const user = userEvent.setup()
    render(<VestingPanel deployment={deployment} initialAmount="250" />)
    expect(await screen.findByText('Not funded yet')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Fund' }))
    expect(writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({ address: TOKEN, functionName: 'transfer', args: [VESTING, parseEther('250')] }),
    )
  })

  it('won’t send more than the wallet holds', async () => {
    mockVesting({ now: 1100 })
    render(<VestingPanel deployment={deployment} initialAmount="5000" />)
    expect(await screen.findByText("That's more than this wallet holds.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Add' })).toBeDisabled()
  })
})
