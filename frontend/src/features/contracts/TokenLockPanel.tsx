import { useQuery } from '@tanstack/react-query'
import { formatUnits } from 'viem'
import { usePublicClient, useWriteContract } from 'wagmi'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { InlineError } from '../../components/ui/InlineError'
import type { ContractDeployment } from '../../lib/contractsApi'
import { TOKEN_TIMELOCK_ABI } from '../../lib/tokenTimelockAbi'
import { ERC20_ABI } from '../../lib/uniswapV2Abi'
import { NETWORK_TO_CHAIN_ID } from './useDeployTemplate'
import { useOwnerTransaction } from './useOwnerTransaction'

// A Token Time-Lock's state, read from the contract: what it holds, for
// whom, until when — and, once that time has passed, a Release button.
// Anyone may send the release; the contract only ever pays the beneficiary.
export function TokenLockPanel({ deployment }: { deployment: ContractDeployment }) {
  const { writeContractAsync } = useWriteContract()
  const chainId = NETWORK_TO_CHAIN_ID[deployment.network]
  const lock = deployment.contract_address as `0x${string}`
  const publicClient = usePublicClient({ chainId })

  const reads = useQuery({
    queryKey: ['token-lock', chainId, lock],
    enabled: Boolean(publicClient),
    queryFn: async () => {
      const client = publicClient!
      const [token, beneficiary, releaseTime, locked, block] = await Promise.all([
        client.readContract({ address: lock, abi: TOKEN_TIMELOCK_ABI, functionName: 'token' }),
        client.readContract({ address: lock, abi: TOKEN_TIMELOCK_ABI, functionName: 'beneficiary' }),
        client.readContract({ address: lock, abi: TOKEN_TIMELOCK_ABI, functionName: 'releaseTime' }),
        client.readContract({ address: lock, abi: TOKEN_TIMELOCK_ABI, functionName: 'lockedAmount' }),
        client.getBlock(),
      ])
      const [symbol, decimals] = await Promise.all([
        client.readContract({ address: token, abi: ERC20_ABI, functionName: 'symbol' }).catch(() => 'tokens'),
        client.readContract({ address: token, abi: ERC20_ABI, functionName: 'decimals' }).catch(() => 18),
      ])
      // "Unlocked yet?" is judged by the chain's own clock — the latest
      // block's timestamp, which is what release() checks — not this
      // device's clock (found in the e2e run: with the chain's time moved
      // forward, a wall-clock check still said "locked").
      return { token, beneficiary, releaseTime: Number(releaseTime), locked, symbol, decimals: Number(decimals), chainTime: Number(block.timestamp) }
    },
  })

  const { send, isBusy, error, done } = useOwnerTransaction<'release'>({
    chainId,
    doneMessages: { release: 'Released to the beneficiary.' },
    onSettled: () => void reads.refetch(),
  })

  if (reads.isLoading) return <p className="text-sm text-ink-muted">Reading the lock…</p>
  if (reads.isError || !reads.data) return <InlineError>Couldn't read this lock right now.</InlineError>

  const { token, beneficiary, releaseTime, locked, symbol, decimals, chainTime } = reads.data
  const unlocked = chainTime >= releaseTime
  const until = new Date(releaseTime * 1000).toLocaleString()

  return (
    <div className="space-y-3 rounded-lg border border-border bg-surface-raised p-4 text-sm" data-testid="token-lock">
      <div className="flex flex-wrap gap-2">
        <Badge tone={locked === 0n ? 'neutral' : unlocked ? 'warning' : 'success'}>
          {locked === 0n ? 'Empty' : unlocked ? 'Unlocked' : `Locked until ${until}`}
        </Badge>
        <Badge tone="neutral">
          {formatUnits(locked, decimals)} {symbol}
        </Badge>
      </div>
      <p className="break-all font-mono text-xs text-ink-faint">
        Token {token} · pays {beneficiary}
      </p>
      <Button
        variant="secondary"
        size="sm"
        disabled={!unlocked || locked === 0n || isBusy()}
        isLoading={isBusy('release')}
        onClick={() => void send('release', () => writeContractAsync({ address: lock, abi: TOKEN_TIMELOCK_ABI, functionName: 'release', chainId }))}
      >
        {unlocked ? 'Release to beneficiary' : `Releasable after ${until}`}
      </Button>
      {done && <p className="text-success">{done}</p>}
      {error && <InlineError>{error}</InlineError>}
    </div>
  )
}
