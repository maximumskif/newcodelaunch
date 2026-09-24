import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { InlineError } from '../../components/ui/InlineError'
import { candyMachineApi, SOLANA_NETWORKS, type CreatorDashboard, type CreatorDrop, type NetworkTotals, type SolanaNetworkId } from '../../lib/candyMachineApi'
import { useAuth } from '../auth/AuthContext'
import { EditPhasesDialog } from './EditPhasesDialog'

function networkLabel(id: string): string {
  return SOLANA_NETWORKS.find((network) => network.id === id)?.label ?? id
}

function formatSol(value: number): string {
  return `${value.toLocaleString('en-US', { maximumFractionDigits: 9 })} SOL`
}

// A two-price (allowlist + public) drop's revenue is a range — the chain
// doesn't record which phase each mint came through.
function formatRevenue(min: number, max: number): string {
  return min === max ? formatSol(min) : `${formatSol(min).replace(' SOL', '')}–${formatSol(max)}`
}

// The creator's own drops with live on-chain sales — what /mint shows when
// it isn't launching a specific collection.
export function DropsDashboard() {
  const { accessToken } = useAuth()
  const [dashboard, setDashboard] = useState<CreatorDashboard | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(false)
  const [editing, setEditing] = useState<CreatorDrop | null>(null)

  const load = useCallback(() => {
    if (!accessToken) return
    setIsLoading(true)
    setError(null)
    candyMachineApi
      .dashboard(accessToken)
      .then(setDashboard)
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Loading your drops failed'))
      .finally(() => setIsLoading(false))
  }, [accessToken])

  useEffect(() => {
    // Fetching on mount/token change is the "synchronize with an external
    // system" case this rule carves out — same idiom as MintLaunchPage.
    // oxlint-disable-next-line react/set-state-in-effect
    load()
  }, [load])

  if (!accessToken) {
    return <p className="text-ink-faint">Sign in with your wallet to see your drops.</p>
  }

  const totals = Object.entries(dashboard?.totals_by_network ?? {}) as [SolanaNetworkId, NetworkTotals][]

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-medium text-ink">Your drops</h2>
        <Button variant="secondary" size="sm" isLoading={isLoading} onClick={load}>
          Refresh
        </Button>
      </div>

      {error && <InlineError>{error}</InlineError>}

      {totals.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          {totals.map(([network, total]) => (
            <div key={network} className="rounded-xl border border-border bg-surface p-4">
              <p className="text-xs text-ink-faint">{networkLabel(network)}</p>
              <p className="mt-1 text-2xl font-semibold text-ink">{formatRevenue(total.revenue_min_sol, total.revenue_max_sol)}</p>
              <p className="text-sm text-ink-muted">
                {total.items_redeemed.toLocaleString('en-US')} minted across {total.drops} drop{total.drops === 1 ? '' : 's'}
              </p>
            </div>
          ))}
        </div>
      )}

      {dashboard && dashboard.drops.length === 0 && (
        <EmptyState
          title="No drops yet"
          description={'Publish items to IPFS in the NFT Generator, then use "Launch Mint Site" there to launch your first drop.'}
          action={
            <Link to="/nft" className="mt-2 inline-flex">
              <Button variant="secondary" size="sm">
                Go to NFT Generator
              </Button>
            </Link>
          }
        />
      )}

      {dashboard && dashboard.drops.length > 0 && (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-left text-sm">
            <thead className="border-b border-border text-xs text-ink-faint">
              <tr>
                <th className="px-4 py-3 font-medium">Drop</th>
                <th className="px-4 py-3 font-medium">Minted</th>
                <th className="px-4 py-3 font-medium">Price</th>
                <th className="px-4 py-3 font-medium">Revenue</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Links</th>
              </tr>
            </thead>
            <tbody>
              {dashboard.drops.map((drop) => {
                const minted = drop.items_redeemed ?? 0
                const percent = drop.items_available > 0 ? Math.round((minted / drop.items_available) * 100) : 0
                return (
                  <tr key={drop.id} className="border-b border-border last:border-0">
                    <td className="px-4 py-3 text-ink">
                      {drop.collection_name ?? 'Untitled collection'}
                      <span className="block text-xs text-ink-faint">{networkLabel(drop.network)}</span>
                    </td>
                    <td className="px-4 py-3 text-ink">
                      {drop.live_status_available ? (
                        <>
                          {minted} / {drop.items_available}
                          <div
                            className="mt-1 h-1.5 w-24 overflow-hidden rounded-full bg-surface-hover"
                            role="progressbar"
                            aria-label={`${drop.collection_name ?? 'Drop'} minted`}
                            aria-valuemin={0}
                            aria-valuemax={drop.items_available}
                            aria-valuenow={minted}
                          >
                            <div className="h-full bg-accent-500" style={{ width: `${percent}%` }} />
                          </div>
                        </>
                      ) : (
                        <span className="text-ink-faint">Unavailable</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-ink">
                      {formatSol(drop.price_sol)}
                      {drop.allowlist && (
                        <span className="block text-xs text-ink-faint">
                          {formatSol(drop.allowlist.price_sol)} allowlist · {drop.allowlist.size} wallets
                        </span>
                      )}
                      {drop.mint_limit && <span className="block text-xs text-ink-faint">Max {drop.mint_limit} per wallet</span>}
                    </td>
                    <td className="px-4 py-3 text-ink">
                      {drop.revenue_min_sol === null || drop.revenue_max_sol === null
                        ? '—'
                        : formatRevenue(drop.revenue_min_sol, drop.revenue_max_sol)}
                    </td>
                    <td className="px-4 py-3">
                      {drop.live_status_available && drop.items_remaining === 0 ? (
                        <Badge tone="accent">Sold out</Badge>
                      ) : drop.phase === 'public' ? (
                        <Badge tone="success">Live</Badge>
                      ) : drop.phase === 'allowlist' ? (
                        <Badge tone="info">Allowlist phase</Badge>
                      ) : (
                        <Badge tone="neutral">Starts {new Date(drop.go_live_date).toLocaleString()}</Badge>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <span className="flex flex-col gap-0.5 text-xs">
                        <Link to={`/mint/buy/${drop.candy_machine}`} className="text-accent-400 hover:underline">
                          Storefront
                        </Link>
                        {drop.explorer_url && (
                          <a href={drop.explorer_url} target="_blank" rel="noreferrer" className="text-accent-400 hover:underline">
                            Explorer
                          </a>
                        )}
                        {drop.items_remaining !== 0 && (
                          <button
                            type="button"
                            onClick={() => setEditing(drop)}
                            aria-label={`Edit phases for ${drop.collection_name ?? 'this drop'}`}
                            className="text-left text-accent-400 hover:underline"
                          >
                            Edit phases
                          </button>
                        )}
                      </span>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
      {editing && (
        <EditPhasesDialog
          drop={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null)
            load()
          }}
        />
      )}
    </section>
  )
}
