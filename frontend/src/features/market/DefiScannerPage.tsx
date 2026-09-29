import { useQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { EmptyState } from '../../components/ui/EmptyState'
import { InlineError } from '../../components/ui/InlineError'
import { PageHero } from '../../components/ui/PageHero'
import { SkeletonTableRow } from '../../components/ui/Skeleton'
import { marketApi } from '../../lib/marketApi'

function formatTvl(value: number | null): string {
  if (value === null) return '—'
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  return `$${value.toLocaleString()}`
}

function formatChange(value: number | null): string {
  if (value === null) return '—'
  return `${value >= 0 ? '+' : ''}${value.toFixed(2)}%`
}

function changeTone(value: number | null): string {
  if (value === null) return 'text-ink-faint'
  return value >= 0 ? 'text-success' : 'text-danger'
}

export function DefiScannerPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['defi-protocols'],
    queryFn: () => marketApi.listProtocols(100),
    refetchInterval: 60_000,
  })
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState<string | null>(null)
  // DeFiLlama's list leads with centralized exchanges' reserves (Binance,
  // OKX, …) — real numbers, but not DeFi, so they're hidden by default.
  const [hideCex, setHideCex] = useState(true)

  const all = useMemo(() => data?.protocols ?? [], [data])
  const categories = useMemo(() => {
    const counts = new Map<string, number>()
    for (const protocol of all) {
      if (protocol.category && !(hideCex && protocol.category === 'CEX')) counts.set(protocol.category, (counts.get(protocol.category) ?? 0) + 1)
    }
    return [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name]) => name)
  }, [all, hideCex])
  const needle = search.trim().toLowerCase()
  const protocols = all.filter(
    (protocol) =>
      !(hideCex && protocol.category === 'CEX') &&
      (!category || protocol.category === category) &&
      (!needle || protocol.name.toLowerCase().includes(needle) || protocol.chains.some((chain) => chain.toLowerCase().includes(needle))),
  )
  const combinedTvl = protocols.reduce((sum, protocol) => sum + (protocol.tvl ?? 0), 0)
  const upThisWeek = protocols.filter((protocol) => (protocol.change_7d ?? 0) > 0).length

  return (
    <div className="space-y-5 p-4 sm:p-8">
      <PageHero
        eyebrow="Live Data"
        title="DeFi Protocol Scanner"
        description="Where the money is in DeFi: total value locked per protocol from DeFiLlama, refreshed every minute."
      />

      {data && (
        <div className="space-y-4">
          <dl className="grid grid-cols-3 gap-3">
            {[
              ['Protocols shown', String(protocols.length)],
              ['Combined TVL', formatTvl(combinedTvl)],
              ['Up over 7 days', `${upThisWeek} of ${protocols.length}`],
            ].map(([label, value]) => (
              <div key={label} className="rounded-xl border border-border bg-surface p-4">
                <dt className="text-xs text-ink-faint">{label}</dt>
                <dd className="mt-1 font-mono text-xl text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="defi-search" className="sr-only">Search protocols or chains</label>
            <input
              id="defi-search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Search protocols or chains"
              className="h-9 w-full rounded-md border border-border bg-canvas px-3 text-sm text-ink placeholder:text-ink-faint focus:border-accent-500 focus:outline-none sm:w-64"
            />
            <div className="flex flex-wrap gap-1.5" role="group" aria-label="Category">
              {[null, ...categories].map((name) => (
                <button
                  key={name ?? 'all'}
                  type="button"
                  aria-pressed={category === name}
                  onClick={() => setCategory(name)}
                  className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                    category === name ? 'border-accent-500 bg-accent-500/15 text-ink' : 'border-border text-ink-muted hover:bg-surface-hover'
                  }`}
                >
                  {name ?? 'All'}
                </button>
              ))}
            </div>
            <label className="ml-auto flex items-center gap-2 text-xs text-ink-muted">
              <input type="checkbox" checked={hideCex} onChange={(event) => setHideCex(event.target.checked)} />
              Hide centralized exchanges
            </label>
          </div>
        </div>
      )}

      {error && <InlineError className="text-danger">{(error as Error).message}</InlineError>}
      {data && protocols.length === 0 && <EmptyState title={all.length === 0 ? 'No protocol data available.' : 'No protocols match these filters.'} />}

      {(isLoading || protocols.length > 0) && (
        <div className="animate-fade-up overflow-x-auto rounded-xl border border-border bg-surface [animation-delay:80ms]">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Protocol</th>
                <th className="px-4 py-3 font-medium">Category</th>
                <th className="px-4 py-3 font-medium">Chains</th>
                <th className="px-4 py-3 font-medium text-right">TVL</th>
                <th className="px-4 py-3 font-medium text-right">1D</th>
                <th className="px-4 py-3 font-medium text-right">7D</th>
              </tr>
            </thead>
            <tbody>
              {isLoading &&
                Array.from({ length: 8 }).map((_, index) => <SkeletonTableRow key={index} columns={6} />)}
              {protocols.map((protocol) => (
                <tr key={protocol.id ?? protocol.name} className="border-b border-border transition-colors duration-150 last:border-0 hover:bg-surface-hover">
                  <td className="px-4 py-3">
                    {protocol.url ? (
                      <a href={protocol.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 hover:underline">
                        {protocol.logo && <img src={protocol.logo} alt="" className="h-5 w-5 rounded-full" />}
                        <span className="font-medium text-ink">{protocol.name}</span>
                      </a>
                    ) : (
                      <div className="flex items-center gap-2">
                        {protocol.logo && <img src={protocol.logo} alt="" className="h-5 w-5 rounded-full" />}
                        <span className="font-medium text-ink">{protocol.name}</span>
                      </div>
                    )}
                  </td>
                  <td className="px-4 py-3 text-ink-muted">{protocol.category ?? '—'}</td>
                  <td className="px-4 py-3 text-ink-faint">
                    <span className="truncate" title={protocol.chains.join(', ')}>
                      {protocol.chains.slice(0, 2).join(', ')}
                      {protocol.chains.length > 2 ? ` +${protocol.chains.length - 2}` : ''}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-mono text-ink">{formatTvl(protocol.tvl)}</td>
                  <td className={`px-4 py-3 text-right font-mono ${changeTone(protocol.change_1d)}`}>{formatChange(protocol.change_1d)}</td>
                  <td className={`px-4 py-3 text-right font-mono ${changeTone(protocol.change_7d)}`}>{formatChange(protocol.change_7d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
