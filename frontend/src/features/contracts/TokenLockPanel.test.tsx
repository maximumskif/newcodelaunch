import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render as rtlRender, screen } from '@testing-library/react'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import { parseEther } from 'viem'
import { useChainId, usePublicClient, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContractDeployment } from '../../lib/contractsApi'
import { TokenLockPanel } from './TokenLockPanel'

vi.mock('wagmi', () => ({
  useChainId: vi.fn(),
  usePublicClient: vi.fn(),
  useSwitchChain: vi.fn(),
  useWaitForTransactionReceipt: vi.fn(),
  useWriteContract: vi.fn(),
}))

const LOCK = '0x5555555555555555555555555555555555555555'
const deployment = { id: 'lock-1', network: 'sepolia', contract_address: LOCK, template_id: 'token_timelock' } as ContractDeployment
const writeContractAsync = vi.fn()

function mockLock(releaseTime: bigint, locked = parseEther('25')) {
  vi.mocked(useChainId).mockReturnValue(11155111)
  vi.mocked(useSwitchChain).mockReturnValue({ switchChainAsync: vi.fn() } as unknown as ReturnType<typeof useSwitchChain>)
  vi.mocked(useWriteContract).mockReturnValue({ writeContractAsync } as unknown as ReturnType<typeof useWriteContract>)
  vi.mocked(useWaitForTransactionReceipt).mockReturnValue({ data: undefined } as ReturnType<typeof useWaitForTransactionReceipt>)
  const values: Record<string, unknown> = {
    token: '0x1111111111111111111111111111111111111111',
    beneficiary: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266',
    releaseTime,
    lockedAmount: locked,
    symbol: 'UNI-V2',
    decimals: 18,
  }
  vi.mocked(usePublicClient).mockReturnValue({
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => values[functionName]),
    getBlock: vi.fn(async () => ({ timestamp: BigInt(Math.floor(Date.now() / 1000)) })),
  } as unknown as ReturnType<typeof usePublicClient>)
}

const render = (ui: ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)

describe('TokenLockPanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    writeContractAsync.mockResolvedValue('0xhash')
  })

  it('can’t release before the release time', async () => {
    mockLock(4_102_444_800n)
    render(<TokenLockPanel deployment={deployment} />)
    expect(await screen.findByText(/^Locked until/)).toBeInTheDocument()
    expect(screen.getByText('25 UNI-V2')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Releasable after/ })).toBeDisabled()
  })

  it('releases to the beneficiary once unlocked', async () => {
    mockLock(1_000n)
    const user = userEvent.setup()
    render(<TokenLockPanel deployment={deployment} />)
    await user.click(await screen.findByRole('button', { name: 'Release to beneficiary' }))
    expect(writeContractAsync).toHaveBeenCalledWith(expect.objectContaining({ address: LOCK, functionName: 'release' }))
  })

  it('says when it’s empty', async () => {
    mockLock(1_000n, 0n)
    render(<TokenLockPanel deployment={deployment} />)
    expect(await screen.findByText('Empty')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Release to beneficiary' })).toBeDisabled()
  })
})
