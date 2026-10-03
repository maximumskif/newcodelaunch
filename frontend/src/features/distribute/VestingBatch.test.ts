import { act, renderHook } from '@testing-library/react'
import { useAccount, useChainId, useDeployContract, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { Recipient } from '../../lib/airdrop'
import { contractsApi } from '../../lib/contractsApi'
import { useVestingBatch } from './VestingBatch'

vi.mock('wagmi', () => ({
  useAccount: vi.fn(),
  useChainId: vi.fn(),
  useDeployContract: vi.fn(),
  usePublicClient: vi.fn(),
  useSwitchChain: vi.fn(),
  useWriteContract: vi.fn(),
}))
vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'tok', user: null, login: vi.fn(), updateUser: vi.fn(), logout: vi.fn() }),
}))
vi.mock('../../lib/contractsApi', () => ({
  contractsApi: { compile: vi.fn(), createDeployment: vi.fn(), multisend: vi.fn() },
}))

const TOKEN = '0x1111111111111111111111111111111111111111'
const MULTISEND = '0x9999999999999999999999999999999999999999'
const schedule = { start: 1000, cliff: 1000, end: 2000 }
const team: Recipient[] = [
  { line: 1, address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', amount: 10n },
  { line: 2, address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', amount: 20n },
  { line: 3, address: '0xcccccccccccccccccccccccccccccccccccccccc', amount: 30n },
]

const deployContractAsync = vi.fn()
const writeContractAsync = vi.fn()
let deployed = 0

describe('useVestingBatch', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    deployed = 0
    vi.mocked(useAccount).mockReturnValue({ address: '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266' } as unknown as ReturnType<typeof useAccount>)
    vi.mocked(useChainId).mockReturnValue(11155111)
    vi.mocked(useSwitchChain).mockReturnValue({ switchChainAsync: vi.fn() } as unknown as ReturnType<typeof useSwitchChain>)
    vi.mocked(useDeployContract).mockReturnValue({ deployContractAsync } as unknown as ReturnType<typeof useDeployContract>)
    vi.mocked(useWriteContract).mockReturnValue({ writeContractAsync } as unknown as ReturnType<typeof useWriteContract>)
    vi.mocked(usePublicClient).mockReturnValue({
      waitForTransactionReceipt: vi.fn(async ({ hash }: { hash: string }) => ({ status: 'success', contractAddress: `0xvest${hash}` })),
      readContract: vi.fn(async () => 0n),
    } as unknown as ReturnType<typeof usePublicClient>)
    vi.mocked(contractsApi.compile).mockResolvedValue({ abi: [], bytecode: '0x00' } as unknown as Awaited<ReturnType<typeof contractsApi.compile>>)
    vi.mocked(contractsApi.createDeployment).mockImplementation(async (_token, payload) => ({
      deployment: { id: payload.transaction_hash, contract_address: payload.contract_address, parameters: payload.parameters },
    }) as unknown as Awaited<ReturnType<typeof contractsApi.createDeployment>>)
    vi.mocked(contractsApi.multisend).mockResolvedValue({ address: MULTISEND })
    deployContractAsync.mockImplementation(async () => `${++deployed}`)
    writeContractAsync.mockResolvedValue('0xsent')
  })

  it('picks up where a rejected prompt stopped: no second contract for anyone, then funds all in one send', async () => {
    deployContractAsync
      .mockImplementationOnce(async () => `${++deployed}`)
      .mockImplementationOnce(async () => `${++deployed}`)
      .mockRejectedValueOnce(new Error('User rejected the request.'))
    const { result } = renderHook(() => useVestingBatch({ network: 'sepolia', token: TOKEN, schedule }))

    await act(() => result.current.run(team))
    expect(result.current.error).toBe('You cancelled this in your wallet.')
    expect(result.current.rows.map((row) => Boolean(row.deployment))).toEqual([true, true, false])
    expect(writeContractAsync).not.toHaveBeenCalled()

    await act(() => result.current.run(team))
    expect(result.current.error).toBeNull()
    expect(deployContractAsync).toHaveBeenCalledTimes(4) // 2 + the rejected one + the retry of the third
    expect(vi.mocked(contractsApi.createDeployment).mock.calls.map(([, p]) => p.parameters!.BENEFICIARY)).toEqual(team.map((r) => r.address))
    expect(writeContractAsync).toHaveBeenCalledWith(expect.objectContaining({ functionName: 'approve', args: [MULTISEND, 60n] }))
    expect(writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({ address: MULTISEND, functionName: 'send', args: [TOKEN, ['0xvest1', '0xvest2', '0xvest3'], [10n, 20n, 30n]] }),
    )
    expect(result.current.rows.every((row) => row.funded)).toBe(true)
  })
})
