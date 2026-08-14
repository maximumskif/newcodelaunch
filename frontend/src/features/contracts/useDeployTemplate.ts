import { useCallback, useEffect, useState } from 'react'
import type { Abi } from 'viem'
import { useAccount, useChainId, useDeployContract, useSwitchChain, useWaitForTransactionReceipt } from 'wagmi'

import { contractsApi, type ContractDeployment } from '../../lib/contractsApi'
import { useAuth } from '../auth/AuthContext'

// NOTE: written against wagmi's documented useDeployContract/useWaitForTransactionReceipt
// shape, which has been stable across recent major versions — but this hook hasn't been
// smoke-tested against a real wallet in this sandbox (no browser here). First thing to
// verify once you can: deploy an erc20_basic token on a testnet and watch `step` progress
// idle -> compiling -> deploying -> confirming -> recording -> done.

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

  useEffect(() => {
    if (!receipt || !pendingRecord || !accessToken || !address || step !== 'confirming') return

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
  }, [receipt, pendingRecord, accessToken, address, step])

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
