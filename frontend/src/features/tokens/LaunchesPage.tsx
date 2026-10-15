import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'
import { formatUnits } from 'viem'

import { Badge } from '../../components/ui/Badge'
import { EmptyState } from '../../components/ui/EmptyState'
import { InlineError } from '../../components/ui/InlineError'
import { PageHero } from '../../components/ui/PageHero'
import { formatAmount, timeAgo } from '../../lib/marketFormat'
import { tokenPagePath, tokenPagesApi, type CurveLaunch } from '../../lib/tokenPagesApi'
import { EVM_NETWORKS } from '../network/NetworkContext'

const coins = (raw: string) => formatAmount(Number(formatUnits(BigInt(raw), 18)))

// Public: the latest bonding-curve launches, read from the chain, for
// anyone browsing for something to buy. Each card opens the token's public
// page, where the trading happens.
export function LaunchesPage() {
  const [network, setNetwork] = useState<string | null>(null)
  const launches = useQuery({
    queryKey: ['curve-launches', network],
    queryFn: () => tokenPagesApi.curveLaunches(network ?? undefined),
    refetchInterval: 30_000,
  })
  const label = (id: string) => EVM_NETWORKS.find((n) => n.id === id)?.label ?? id

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-4 sm:p-8">
      <PageHero
        eyebrow="Bonding curves"
        title="New launches"
        description="Tokens launched on a bonding curve here, newest first. Each one sells along its curve until it raises its target, then moves into a DEX pool with the liquidity burned. Read from the chain, not from what creators say."
      />

      <div className="flex flex-wrap gap-2" role="group" aria-label="Network">
        {[null, ...EVM_NETWORKS.map((n) => n.id)].map((id) => (
          <button
            key={id ?? 'all'}
            type="button"
            aria-pressed={network === id}
            onClick={() => setNetwork(id)}
            className={`rounded-md border px-3 py-1.5 font-mono text-xs transition-colors duration-150 ${
              network === id ? 'border-accent-500 bg-accent-500/15 text-ink' : 'border-border text-ink-muted hover:bg-surface-hover'
            }`}
          >
            {id ? label(id) : 'All networks'}
          </button>
        ))}
      </div>

      {launches.isLoading ? (
        <p className="text-sm text-ink-muted">Reading launches from the chain…</p>
      ) : launches.isError || !launches.data ? (
        <InlineError>Couldn't load launches right now.</InlineError>
      ) : !launches.data.launches.length ? (
        <EmptyState
          title="No launches yet"
          description={network ? `Nothing has launched on a curve on ${label(network)} yet.` : 'Nothing has launched on a curve yet.'}
        />
      ) : (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3" aria-label="Launches">
          {launches.data.launches.map((launch) => (
            <LaunchCard key={`${launch.network}-${launch.address}`} launch={launch} networkLabel={label(launch.network)} />
          ))}
        </ul>
      )}
    </div>
  )
}

function LaunchCard({ launch, networkLabel }: { launch: CurveLaunch; networkLabel: string }) {
  const native = EVM_NETWORKS.find((n) => n.id === launch.network)?.nativeToken ?? 'ETH'
  const target = BigInt(launch.graduation_target)
  const raised = launch.eth_reserve !== null ? BigInt(launch.eth_reserve) : null
  const percent = launch.graduated ? 100 : raised !== null && target > 0n ? Math.min(100, Math.floor(Number((raised * 1000n) / target)) / 10) : null

  return (
    <li>
      <Link
        to={tokenPagePath(launch.network, launch.address)}
        className="block h-full space-y-3 rounded-xl border border-border bg-surface p-4 transition-colors duration-150 hover:border-accent-500/60 hover:bg-surface-hover"
      >
        <div className="flex items-center gap-3">
          <span aria-hidden className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-accent-500 font-display text-lg font-semibold text-canvas">
            {launch.symbol.slice(0, 1).toUpperCase()}
          </span>
          <div className="min-w-0">
            <p className="truncate font-display font-semibold text-ink">{launch.name}</p>
            <p className="font-mono text-xs text-ink-muted">
              {launch.symbol} · {networkLabel}
              {launch.created_at ? ` · ${timeAgo(Date.parse(launch.created_at) / 1000)}` : ''}
            </p>
          </div>
        </div>
        {launch.graduated === null ? (
          <p className="text-xs text-ink-faint">Couldn't read this curve just now.</p>
        ) : (
          <div className="space-y-1.5">
            <div className="h-1.5 overflow-hidden rounded-full bg-canvas" role="progressbar" aria-label={`${launch.symbol} raised toward graduation`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? 0}>
              <div className="h-full bg-accent-500" style={{ width: `${percent ?? 0}%` }} />
            </div>
            <div className="flex items-center justify-between gap-2">
              <p className="font-mono text-xs text-ink-muted">
                {launch.graduated ? `${coins(launch.eth_reserve!)} ${native} raised` : `${percent}% · ${coins(launch.eth_reserve!)} of ${coins(launch.graduation_target)} ${native}`}
              </p>
              {launch.graduated && <Badge tone="success">Graduated</Badge>}
            </div>
          </div>
        )}
      </Link>
    </li>
  )
}
