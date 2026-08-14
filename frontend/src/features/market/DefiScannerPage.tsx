import { useQuery } from '@tanstack/react-query'

import { EmptyState } from '../../components/ui/EmptyState'
import { PageHero } from '../../components/ui/PageHero'
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
        eyebrow="Phase 6"
        title="DeFi Protocol Scanner"
        description="Real protocol TVL from DeFiLlama — real data, refreshed every minute, never a simulated number."
      />

      {isLoading && <p className="text-ink-muted">Loading protocol data…</p>}
      {error && <p className="text-danger">{(error as Error).message}</p>}
      {data && data.protocols.length === 0 && <EmptyState title="No protocol data available." />}

      {data && data.protocols.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface text-left text-xs text-ink-faint">
              <tr>
                <th className="px-4 py-2 font-medium">Protocol</th>
                <th className="px-4 py-2 font-medium">Category</th>
                <th className="px-4 py-2 font-medium">Chains</th>
                <th className="px-4 py-2 font-medium text-right">TVL</th>
                <th className="px-4 py-2 font-medium text-right">1D</th>
                <th className="px-4 py-2 font-medium text-right">7D</th>
              </tr>
            </thead>
            <tbody>
              {data.protocols.map((protocol) => (
                <tr key={protocol.id ?? protocol.name} className="border-b border-border last:border-0 hover:bg-surface-hover">
                  <td className="px-4 py-2.5">
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
                  <td className="px-4 py-2.5 text-ink-muted">{protocol.category ?? '—'}</td>
                  <td className="px-4 py-2.5 text-ink-faint">
                    <span className="truncate" title={protocol.chains.join(', ')}>
                      {protocol.chains.slice(0, 2).join(', ')}
                      {protocol.chains.length > 2 ? ` +${protocol.chains.length - 2}` : ''}
                    </span>
                  </td>
                  <td className="px-4 py-2.5 text-right text-ink">{formatTvl(protocol.tvl)}</td>
                  <td className={`px-4 py-2.5 text-right ${changeTone(protocol.change_1d)}`}>{formatChange(protocol.change_1d)}</td>
                  <td className={`px-4 py-2.5 text-right ${changeTone(protocol.change_7d)}`}>{formatChange(protocol.change_7d)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
