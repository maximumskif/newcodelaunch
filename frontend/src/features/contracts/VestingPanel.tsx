import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { InlineError } from '../../components/ui/InlineError'
import { fromBaseUnits, toBaseUnits } from '../../lib/airdrop'
import type { ContractDeployment } from '../../lib/contractsApi'
import { ERC20_ABI } from '../../lib/uniswapV2Abi'
import { TOKEN_VESTING_ABI, vestedAt } from '../../lib/vesting'
import { NETWORK_TO_CHAIN_ID } from './useDeployTemplate'
import { useOwnerTransaction } from './useOwnerTransaction'

const day = (seconds: number) => new Date(seconds * 1000).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })

// A Token Vesting contract's state, read from the chain: how much has
// vested, been paid out and is still to come, a Release button for what's
// due (anyone may send it — the contract only pays the beneficiary), and a
// way to add tokens, which vest on the same schedule. `initialAmount`
// prefills that field right after creating a schedule.
export function VestingPanel({ deployment, initialAmount = '' }: { deployment: ContractDeployment; initialAmount?: string }) {
  const { writeContractAsync } = useWriteContract()
  const { address: wallet } = useAccount()
  const chainId = NETWORK_TO_CHAIN_ID[deployment.network]
  const vesting = deployment.contract_address as `0x${string}`
  const publicClient = usePublicClient({ chainId })
  const [amountText, setAmountText] = useState(initialAmount)

  const reads = useQuery({
    queryKey: ['token-vesting', chainId, vesting, wallet],
    enabled: Boolean(publicClient),
    queryFn: async () => {
      const client = publicClient!
      const read = <T,>(functionName: 'token' | 'beneficiary' | 'startTime' | 'cliffTime' | 'endTime' | 'released' | 'releasable') =>
        client.readContract({ address: vesting, abi: TOKEN_VESTING_ABI, functionName }) as Promise<T>
      const [token, beneficiary, start, cliff, end, released, releasable, block] = await Promise.all([
        read<`0x${string}`>('token'),
        read<string>('beneficiary'),
        read<bigint>('startTime'),
        read<bigint>('cliffTime'),
        read<bigint>('endTime'),
        read<bigint>('released'),
        read<bigint>('releasable'),
        client.getBlock(),
      ])
      const [held, symbol, decimals, walletBalance] = await Promise.all([
        client.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [vesting] }),
        client.readContract({ address: token, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => 'tokens'),
        client.readContract({ address: token, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 18),
        wallet ? client.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [wallet] }) : Promise.resolve(0n),
      ])
      // The chain's clock, which is what the contract vests by (see TokenLockPanel).
      const schedule = { start: Number(start), cliff: Number(cliff), end: Number(end) }
      return { token, beneficiary, schedule, released, releasable, held, symbol, decimals: Number(decimals), walletBalance, chainTime: Number(block.timestamp) }
    },
  })

  const { send, isBusy, error, done } = useOwnerTransaction<'release' | 'fund'>({
    chainId,
    doneMessages: { release: 'Released to the beneficiary.', fund: 'Tokens added — they vest on the same schedule.' },
    onSettled: ({ action, status }) => {
      if (action === 'fund' && status === 'success') setAmountText('')
      void reads.refetch()
    },
  })

  if (reads.isLoading) return <p className="text-sm text-ink-muted">Reading the vesting contract…</p>
  if (reads.isError || !reads.data) return <InlineError>Couldn't read this vesting contract right now.</InlineError>

  const { token, beneficiary, schedule, released, releasable, held, symbol, decimals, walletBalance, chainTime } = reads.data
  const total = held + released
  const vested = vestedAt(total, schedule, chainTime)
  const amount = (n: bigint) => `${fromBaseUnits(n, decimals)} ${symbol}`
  const percent = total > 0n ? Number((vested * 10_000n) / total) / 100 : 0
  const toAdd = toBaseUnits(amountText, decimals)
  const overBalance = toAdd !== null && toAdd > walletBalance
  const ended = chainTime >= schedule.end

  const status =
    total === 0n ? { tone: 'warning' as const, label: 'Not funded yet' }
    : ended && held === 0n ? { tone: 'neutral' as const, label: 'Fully paid out' }
    : chainTime < schedule.cliff ? { tone: 'success' as const, label: `Cliff until ${day(schedule.cliff)}` }
    : ended ? { tone: 'warning' as const, label: 'Fully vested' }
    : { tone: 'success' as const, label: `Vesting until ${day(schedule.end)}` }

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-raised p-4 text-sm" data-testid="token-vesting">
      <div className="flex flex-wrap gap-2">
        <Badge tone={status.tone}>{status.label}</Badge>
        <Badge tone="neutral">{amount(total)} in total</Badge>
      </div>

      {total > 0n && (
        <div className="space-y-1.5">
          <div
            className="h-1.5 overflow-hidden rounded-full bg-surface"
            role="progressbar"
            aria-label="Vested so far"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={percent}
          >
            <div className="h-full bg-accent-500" style={{ width: `${percent}%` }} />
          </div>
          <p className="font-mono text-xs text-ink-muted">
            {percent}% vested · {amount(released)} paid out · {amount(releasable)} ready to release
          </p>
        </div>
      )}

      <p className="text-xs text-ink-muted">
        Starts {day(schedule.start)}
        {schedule.cliff > schedule.start ? `, nothing before ${day(schedule.cliff)}` : ''}, all vested by {day(schedule.end)}.
      </p>
      <p className="break-all font-mono text-xs text-ink-faint">
        Token {token} · pays {beneficiary}
      </p>

      <Button
        variant="secondary"
        size="sm"
        disabled={releasable === 0n || isBusy()}
        isLoading={isBusy('release')}
        onClick={() => void send('release', () => writeContractAsync({ address: vesting, abi: TOKEN_VESTING_ABI, functionName: 'release', chainId }))}
      >
        {releasable > 0n ? `Release ${amount(releasable)} to beneficiary` : 'Nothing to release yet'}
      </Button>

      {!ended && wallet && (
        <div className="space-y-1.5 border-t border-border pt-3">
          <label className="block text-xs text-ink-muted" htmlFor={`vesting-add-${deployment.id}`}>
            {total === 0n ? `Fund it: ${symbol} to vest` : `Add ${symbol} (vests on the same schedule)`} · you hold {amount(walletBalance)}
          </label>
          <div className="flex gap-2">
            <input
              id={`vesting-add-${deployment.id}`}
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              inputMode="decimal"
              placeholder="0"
              className="h-9 min-w-0 flex-1 rounded-md border border-border bg-canvas px-3 font-mono text-sm text-ink focus:border-accent-500 focus:outline-none"
            />
            <Button
              size="sm"
              disabled={!toAdd || overBalance || isBusy()}
              isLoading={isBusy('fund')}
              onClick={() =>
                void send('fund', () => writeContractAsync({ address: token, abi: ERC20_ABI, functionName: 'transfer', args: [vesting, toAdd!], chainId }))
              }
            >
              {total === 0n ? 'Fund' : 'Add'}
            </Button>
          </div>
          {amountText.trim() && toAdd === null && <p className="text-xs text-warning">Enter an amount like 1000 or 12.5.</p>}
          {overBalance && <p className="text-xs text-warning">That's more than this wallet holds.</p>}
          <p className="text-xs text-ink-faint">Tokens sent here can only ever go to the beneficiary. There's no way to take them back.</p>
        </div>
      )}

      {done && <p className="text-success">{done}</p>}
      {error && <InlineError>{error}</InlineError>}
    </div>
  )
}
