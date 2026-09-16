import { useQuery } from '@tanstack/react-query'

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
    queryFn: () => marketApi.listProtocols(20),
    refetchInterval: 60_000,
  })

  return (
    <div className="space-y-5 p-8">
      <PageHero
        eyebrow="Live Data"
        title="DeFi Protocol Scanner"
        description="Real protocol TVL from DeFiLlama — real data, refreshed every minute, never a simulated number."
      />

      {error && <InlineError className="text-danger">{(error as Error).message}</InlineError>}
      {data && data.protocols.length === 0 && <EmptyState title="No protocol data available." />}

      {(isLoading || (data && data.protocols.length > 0)) && (
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
              {data?.protocols.map((protocol) => (
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
