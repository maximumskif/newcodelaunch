import { act, renderHook, waitFor } from '@testing-library/react'
import { useAccount, useChainId, useDeployContract, useSwitchChain, useWaitForTransactionReceipt } from 'wagmi'
import { describe, expect, it, vi } from 'vitest'

import { contractsApi, type ContractDeployment } from '../../lib/contractsApi'
import { useAuth } from '../auth/AuthContext'
import { useDeployTemplate } from './useDeployTemplate'

// Regression test for a real bug only a real end-to-end run caught (see
// frontend/e2e/): the recording effect used to list `step` in its own
// dependency array and call setStep('recording') inside itself. That state
// update is itself a dependency change, so React cleaned up that exact
// effect instance (setting `cancelled = true`) before the in-flight
// createDeployment() promise could resolve — silently discarding a
// successful result. Every real deployment got stuck showing "recording…"
// forever even though the backend had already recorded it. This test
// reproduces the actual race: a re-render lands *between* the record call
// starting and resolving, which is exactly what used to trigger the bug.

vi.mock('wagmi', () => ({
  useAccount: vi.fn(),
  useChainId: vi.fn(),
  useDeployContract: vi.fn(),
  useSwitchChain: vi.fn(),
  useWaitForTransactionReceipt: vi.fn(),
}))

vi.mock('../auth/AuthContext', () => ({ useAuth: vi.fn() }))

vi.mock('../../lib/contractsApi', () => ({
  contractsApi: { compile: vi.fn(), createDeployment: vi.fn() },
}))

const TX_HASH = '0xTxHash00000000000000000000000000000000000000000000000000000000' as const

describe('useDeployTemplate', () => {
  it('reaches "done" with the recorded deployment, even when a re-render happens between the record call starting and resolving', async () => {
    vi.mocked(useAccount).mockReturnValue({
      address: '0xDeployer000000000000000000000000000000',
    } as unknown as ReturnType<typeof useAccount>)
    vi.mocked(useChainId).mockReturnValue(11155111)
    vi.mocked(useSwitchChain).mockReturnValue({
      switchChainAsync: vi.fn(),
    } as unknown as ReturnType<typeof useSwitchChain>)
    vi.mocked(useAuth).mockReturnValue({ accessToken: 'tok', user: null, login: vi.fn(), logout: vi.fn() })

    const deployContractAsync = vi.fn().mockResolvedValue(TX_HASH)
    vi.mocked(useDeployContract).mockReturnValue({
      deployContractAsync,
    } as unknown as ReturnType<typeof useDeployContract>)

    // useWaitForTransactionReceipt is read fresh on every render — this lets
    // the test control exactly when "the chain confirms" relative to
    // re-renders, the same way real receipt polling resolves asynchronously
    // relative to React's own render cycle.
    let receiptValue: unknown
    vi.mocked(useWaitForTransactionReceipt).mockImplementation(
      () => ({ data: receiptValue }) as unknown as ReturnType<typeof useWaitForTransactionReceipt>,
    )

    vi.mocked(contractsApi.compile).mockResolvedValue({ abi: [], bytecode: '0x00', contract_name: 'Foo' })

    let resolveCreateDeployment!: (value: { deployment: ContractDeployment }) => void
    vi.mocked(contractsApi.createDeployment).mockReturnValue(
      new Promise((resolve) => {
        resolveCreateDeployment = resolve
      }),
    )

    const { result, rerender } = renderHook(() => useDeployTemplate())

    await act(async () => {
      await result.current.deploy('erc20_basic', {}, 'sepolia')
    })
    expect(result.current.step).toBe('confirming')

    receiptValue = {
      status: 'success',
      contractAddress: '0xNewContract0000000000000000000000000000',
      transactionHash: TX_HASH,
    }
    rerender()
    await waitFor(() => expect(result.current.step).toBe('recording'))

    // The exact race the real bug hit: another re-render lands here, before
    // createDeployment()'s promise resolves below.
    rerender()

    await act(async () => {
      resolveCreateDeployment({
        deployment: { id: 'dep-1', contract_address: '0xNewContract0000000000000000000000000000' } as ContractDeployment,
      })
    })

    await waitFor(() => expect(result.current.step).toBe('done'))
    expect(result.current.deployment?.id).toBe('dep-1')
  })
})
