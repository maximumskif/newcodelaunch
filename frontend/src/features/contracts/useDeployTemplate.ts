import { useCallback, useEffect, useRef, useState } from 'react'
import type { Abi } from 'viem'
import { useAccount, useChainId, useDeployContract, useSwitchChain, useWaitForTransactionReceipt } from 'wagmi'

import { contractsApi, type ContractDeployment } from '../../lib/contractsApi'
import { useAuth } from '../auth/AuthContext'

// Verified for real end-to-end against a local chain (see frontend/e2e/) —
// `step` does progress idle -> compiling -> deploying -> confirming, but
// the recording effect below had a real bug that first real run caught:
// see hasStartedRecordingRef's comment.

const NETWORK_TO_CHAIN_ID: Record<string, number> = {
  sepolia: 11155111,
  ethereum: 1,
  polygon_amoy: 80002,
  polygon: 137,
  bsc_testnet: 97,
  bsc: 56,
}

export type DeployStep = 'idle' | 'compiling' | 'deploying' | 'confirming' | 'recording' | 'done' | 'error'

interface PendingRecord {
  templateId: string
  network: string
  parameters: Record<string, unknown>
  projectId?: string
}

// Shared by both the Smart Contracts Hub and Token Launchpad pages — the deploy flow
// (compile server-side, deploy from the connected wallet, record the result) is
// identical; only the template list shown to the user differs between the two pages.
export function useDeployTemplate() {
  const { address } = useAccount()
  const currentChainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { deployContractAsync } = useDeployContract()
  const { accessToken } = useAuth()

  const [step, setStep] = useState<DeployStep>('idle')
  const [error, setError] = useState<string | null>(null)
  const [deployment, setDeployment] = useState<ContractDeployment | null>(null)
  const [txHash, setTxHash] = useState<`0x${string}` | undefined>()
  const [pendingRecord, setPendingRecord] = useState<PendingRecord | null>(null)

  const { data: receipt } = useWaitForTransactionReceipt({ hash: txHash })

  // Found via real end-to-end testing (frontend/e2e/): this effect used to
  // list `step` in its own dependency array, and called setStep('recording')
  // synchronously inside itself. That state update is itself a dependency
  // change, so React scheduled this exact effect instance's cleanup before
  // the in-flight createDeployment() promise could resolve — cleanup set
  // `cancelled = true` on that closure, so the eventual successful response
  // was silently discarded by the `if (cancelled) return` guard below.
  // Every real deployment got permanently stuck showing "recording…" in the
  // UI even though the backend had already recorded it correctly. A ref
  // (not `step`) now guards against double-starting the record call, so the
  // effect only depends on state that changes for real external reasons.
  const hasStartedRecordingRef = useRef(false)

  useEffect(() => {
    if (!receipt || !pendingRecord || !accessToken || !address) return
    if (hasStartedRecordingRef.current) return
    hasStartedRecordingRef.current = true

    let cancelled = false
    setStep('recording')

    contractsApi
      .createDeployment(accessToken, {
        template_id: pendingRecord.templateId,
        network: pendingRecord.network,
        contract_address: receipt.contractAddress ?? '',
        transaction_hash: receipt.transactionHash,
        deployer_address: address,
        parameters: pendingRecord.parameters,
        project_id: pendingRecord.projectId,
      })
      .then(({ deployment: recorded }) => {
        if (cancelled) return
        setDeployment(recorded)
        setStep('done')
      })
      .catch((err: unknown) => {
        if (cancelled) return
        setError(err instanceof Error ? err.message : 'Failed to record deployment')
        setStep('error')
      })

    return () => {
      cancelled = true
    }
  }, [receipt, pendingRecord, accessToken, address])

  const deploy = useCallback(
    async (templateId: string, parameters: Record<string, unknown>, network: string, projectId?: string) => {
      if (!address) {
        setError('Connect an EVM wallet first')
        return
      }
      if (!accessToken) {
        setError('Sign in with your wallet first')
        return
      }

      setError(null)
      setDeployment(null)
      setTxHash(undefined)
      setStep('compiling')
      hasStartedRecordingRef.current = false

      try {
        const compiled = await contractsApi.compile(templateId, parameters)

        const chainId = NETWORK_TO_CHAIN_ID[network]
        if (chainId && currentChainId !== chainId) {
          await switchChainAsync({ chainId })
        }

        setStep('deploying')
        setPendingRecord({ templateId, network, parameters, projectId })
        const hash = await deployContractAsync({
          abi: compiled.abi as Abi,
          bytecode: compiled.bytecode as `0x${string}`,
          chainId,
        })
        setTxHash(hash)
        setStep('confirming')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Deployment failed')
        setStep('error')
      }
    },
    [address, accessToken, currentChainId, switchChainAsync, deployContractAsync],
  )

  return { deploy, step, error, deployment, txHash }
}
