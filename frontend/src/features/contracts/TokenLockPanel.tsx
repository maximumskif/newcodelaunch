import { useQuery } from '@tanstack/react-query'
import { formatUnits } from 'viem'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { InlineError } from '../../components/ui/InlineError'
import type { ContractDeployment } from '../../lib/contractsApi'
import { TOKEN_LIMITS_ABI, fitsLimits, readTokenLimits } from '../../lib/tokenLimits'
import { TOKEN_TIMELOCK_ABI } from '../../lib/tokenTimelockAbi'
import { ERC20_ABI } from '../../lib/uniswapV2Abi'
import { TokenLimitsNote } from './TokenLimitsNote'
import { NETWORK_TO_CHAIN_ID } from './useDeployTemplate'
import { useOwnerTransaction } from './useOwnerTransaction'

// A Token Time-Lock's state, read from the contract: what it holds, for
// whom, until when — and, once that time has passed, a Release button.
// Anyone may send the release; the contract only ever pays the beneficiary.
export function TokenLockPanel({ deployment }: { deployment: ContractDeployment }) {
  const { writeContractAsync } = useWriteContract()
  const { address: wallet } = useAccount()
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
      // Transfer limits a release has to fit (our advanced ERC-20), if any.
      const limits = await readTokenLimits(client, token, lock, beneficiary)
      // "Unlocked yet?" is judged by the chain's own clock — the latest
      // block's timestamp, which is what release() checks — not this
      // device's clock (found in the e2e run: with the chain's time moved
      // forward, a wall-clock check still said "locked").
      return { token, beneficiary, releaseTime: Number(releaseTime), locked, symbol, decimals: Number(decimals), limits, chainTime: Number(block.timestamp) }
    },
  })

  const { send, isBusy, error, done } = useOwnerTransaction<'release' | 'exempt'>({
    chainId,
    doneMessages: { release: 'Released to the beneficiary.', exempt: 'This contract is now exempt from the token’s limits.' },
    onSettled: () => void reads.refetch(),
  })

  if (reads.isLoading) return <p className="text-sm text-ink-muted">Reading the lock…</p>
  if (reads.isError || !reads.data) return <InlineError>Couldn't read this lock right now.</InlineError>

  const { token, beneficiary, releaseTime, locked, symbol, decimals, limits, chainTime } = reads.data
  const unlocked = chainTime >= releaseTime
  // All of it, unless the token's limits cut a release down (releasePart).
  const now = fitsLimits(locked, limits)
  const amount = (n: bigint) => `${formatUnits(n, decimals)} ${symbol}`
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
        disabled={!unlocked || now === 0n || isBusy()}
        isLoading={isBusy('release')}
        onClick={() =>
          void send('release', () =>
            now < locked
              ? writeContractAsync({ address: lock, abi: TOKEN_TIMELOCK_ABI, functionName: 'releasePart', args: [now], chainId })
              : writeContractAsync({ address: lock, abi: TOKEN_TIMELOCK_ABI, functionName: 'release', chainId }),
          )
        }
      >
        {!unlocked ? `Releasable after ${until}` : now > 0n && now < locked ? `Release ${amount(now)} of ${amount(locked)} to beneficiary` : 'Release to beneficiary'}
      </Button>
      {unlocked && locked > 0n && limits && !limits.exempt && (
        <TokenLimitsNote
          limits={limits}
          amount={amount}
          canExempt={Boolean(wallet && wallet.toLowerCase() === limits.owner.toLowerCase())}
          busy={isBusy()}
          exempting={isBusy('exempt')}
          onExempt={() =>
            void send('exempt', () => writeContractAsync({ address: token, abi: TOKEN_LIMITS_ABI, functionName: 'excludeFromFees', args: [lock, true], chainId }))
          }
        />
      )}
      {done && <p className="text-success">{done}</p>}
      {error && <InlineError>{error}</InlineError>}
    </div>
  )
}
