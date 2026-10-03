import { useState } from 'react'
import type { Abi } from 'viem'
import { useAccount, useChainId, useDeployContract, usePublicClient, useSwitchChain, useWriteContract } from 'wagmi'

import { Button } from '../../components/ui/Button'
import { fromBaseUnits, type Recipient } from '../../lib/airdrop'
import { contractsApi, type ContractDeployment } from '../../lib/contractsApi'
import { errorMessage } from '../../lib/errors'
import { MULTISEND_ABI } from '../../lib/multisendAbi'
import { ERC20_ABI } from '../../lib/uniswapV2Abi'
import type { Schedule } from '../../lib/vesting'
import { useAuth } from '../auth/AuthContext'
import { NETWORK_TO_CHAIN_ID } from '../contracts/useDeployTemplate'
import { short } from './airdropParts'

// A wallet prompt per schedule — more than this is a job for a script.
export const MAX_BATCH = 50
// Recipients per Multisend transaction, as in the Airdrop tool.
const PER_SEND = 150

export interface BatchRow {
  recipient: Recipient
  deployment?: ContractDeployment
  funded?: boolean
}

// Vesting for several wallets on one schedule: one Token Vesting contract
// each (deployed one after another from the creator's wallet, each recorded
// like any deployment), then all of them funded through the shared Multisend
// — one approval and one transaction per 150, instead of a transfer each.
// A rejected prompt stops the run; running again picks up where it stopped,
// skipping what's already deployed or funded.
export function useVestingBatch({ network, token, schedule }: { network: string; token: `0x${string}` | null; schedule: Schedule | null }) {
  const chainId = NETWORK_TO_CHAIN_ID[network]
  const { address } = useAccount()
  const { accessToken } = useAuth()
  const publicClient = usePublicClient({ chainId })
  const currentChainId = useChainId()
  const { switchChainAsync } = useSwitchChain()
  const { deployContractAsync } = useDeployContract()
  const { writeContractAsync } = useWriteContract()
  const [rows, setRows] = useState<BatchRow[]>([])
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  const wait = async (hash: `0x${string}`) => {
    const receipt = await publicClient!.waitForTransactionReceipt({ hash })
    if (receipt.status === 'reverted') throw new Error('The transaction reverted on-chain')
    return receipt
  }

  // compile -> deploy from this wallet -> record, the same three calls as
  // useDeployTemplate, awaited in sequence.
  const deployAndRecord = async (templateId: string, parameters: Record<string, string>) => {
    const compiled = await contractsApi.compile(templateId, parameters)
    const hash = await deployContractAsync({ abi: compiled.abi as Abi, bytecode: compiled.bytecode as `0x${string}`, chainId })
    const receipt = await wait(hash)
    const { deployment } = await contractsApi.createDeployment(accessToken!, {
      template_id: templateId,
      network,
      contract_address: receipt.contractAddress ?? '',
      transaction_hash: hash,
      deployer_address: address!,
      parameters,
    })
    return deployment
  }

  const run = async (recipients: Recipient[]) => {
    if (!token || !schedule || !address || !accessToken || !publicClient) return
    setError(null)
    // Rows already deployed for the same wallet and amount are kept.
    const key = (r: Recipient) => `${r.address.toLowerCase()}:${r.amount}`
    const kept = new Map(rows.filter((row) => row.deployment).map((row) => [key(row.recipient), row]))
    let current: BatchRow[] = recipients.map((recipient) => ({ ...(kept.get(key(recipient)) ?? {}), recipient }))
    const update = (next: BatchRow[]) => {
      current = next
      setRows(next)
    }
    update(current)
    try {
      if (chainId && currentChainId !== chainId) await switchChainAsync({ chainId })

      for (let i = 0; i < current.length; i++) {
        if (current[i].deployment) continue
        setBusy(`Confirm vesting contract ${i + 1} of ${current.length} in your wallet…`)
        const deployment = await deployAndRecord('token_vesting', {
          TOKEN: token,
          BENEFICIARY: current[i].recipient.address,
          START_TIME: String(schedule.start),
          CLIFF_TIME: String(schedule.cliff),
          END_TIME: String(schedule.end),
        })
        update(current.map((row, j) => (j === i ? { ...row, deployment } : row)))
      }

      const unfunded = current.filter((row) => !row.funded)
      if (!unfunded.length) return
      let sender = (await contractsApi.multisend(network)).address
      if (!sender) {
        setBusy('One-time setup: confirm the shared airdrop contract for this network in your wallet…')
        sender = (await deployAndRecord('multisend', {})).contract_address as `0x${string}`
      }
      const total = unfunded.reduce((sum, row) => sum + row.recipient.amount, 0n)
      const allowance = await publicClient.readContract({ address: token, abi: ERC20_ABI, functionName: 'allowance', args: [address, sender] })
      if (allowance < total) {
        setBusy('Approve the airdrop contract for the total in your wallet…')
        await wait(await writeContractAsync({ address: token, abi: ERC20_ABI, functionName: 'approve', args: [sender, total], chainId }))
      }
      const sends = Math.ceil(unfunded.length / PER_SEND)
      for (let i = 0; i < sends; i++) {
        const batch = unfunded.slice(i * PER_SEND, (i + 1) * PER_SEND)
        setBusy(`Confirm funding transaction ${i + 1} of ${sends} in your wallet…`)
        await wait(
          await writeContractAsync({
            address: sender,
            abi: MULTISEND_ABI,
            functionName: 'send',
            args: [token, batch.map((row) => row.deployment!.contract_address as `0x${string}`), batch.map((row) => row.recipient.amount)],
            chainId,
          }),
        )
        const sent = new Set(batch)
        update(current.map((row) => (sent.has(row) ? { ...row, funded: true } : row)))
      }
    } catch (err) {
      setError(errorMessage(err, 'Stopped'))
    } finally {
      setBusy(null)
    }
  }

  return { rows, run, busy, error }
}

// How many wallet prompts a batch takes, for the summary.
export function batchTransactions(count: number) {
  return { deploys: count, sends: Math.ceil(count / PER_SEND) }
}

export function BatchLog({ rows, decimals, symbol, onRetry, busy }: { rows: BatchRow[]; decimals: number; symbol: string; onRetry: () => void; busy: boolean }) {
  if (!rows.length) return null
  const deployed = rows.filter((row) => row.deployment).length
  const funded = rows.filter((row) => row.funded).length
  const finished = funded === rows.length
  return (
    <section aria-labelledby="vesting-batch" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="vesting-batch" className="font-mono text-sm font-semibold text-ink-faint">
          {finished ? `${rows.length} schedules created and funded` : `created ${deployed} of ${rows.length} · funded ${funded}`}
        </h2>
        {!finished && !busy && (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            continue where it stopped
          </Button>
        )}
      </div>
      <ol className="space-y-1.5 rounded-lg border border-border bg-surface p-4 font-mono text-xs" data-testid="vesting-batch-log">
        {rows.map((row) => (
          <li key={row.recipient.line} className="flex flex-wrap gap-x-3">
            <span className={row.funded ? 'text-success' : 'text-ink-faint'}>{row.funded ? '✓' : row.deployment ? '…' : '·'}</span>
            <span className="text-ink">
              {fromBaseUnits(row.recipient.amount, decimals)} {symbol} → {short(row.recipient.address)}
            </span>
            <span className="text-ink-muted">
              {row.deployment ? `contract ${short(row.deployment.contract_address)}${row.funded ? ', funded' : ', not funded yet'}` : 'not created yet'}
            </span>
          </li>
        ))}
      </ol>
    </section>
  )
}
