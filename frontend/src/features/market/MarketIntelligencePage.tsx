import { useQuery } from '@tanstack/react-query'

import { EmptyState } from '../../components/ui/EmptyState'
import { PageHero } from '../../components/ui/PageHero'
import { marketApi } from '../../lib/marketApi'

function formatPrice(value: number | null): string {
  if (value === null) return '—'
  return value >= 1
    ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    : `$${value.toPrecision(4)}`
}

function formatLarge(value: number | null): string {
  if (value === null) return '—'
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  return `$${value.toLocaleString()}`
}

export function MarketIntelligencePage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['market-tokens'],
    queryFn: () => marketApi.listTokens(20),
    refetchInterval: 60_000,
  })

  return (
    <div className="space-y-5 p-8">
      <PageHero
        eyebrow="Phase 6"
        title="Market Intelligence"
        description="Live token prices and market caps from CoinGecko — real data, refreshed every minute, never a simulated number."
      />

      {isLoading && <p className="text-ink-muted">Loading market data…</p>}
      {error && <p className="text-danger">{(error as Error).message}</p>}
      {data && data.tokens.length === 0 && <EmptyState title="No market data available." />}

      {data && data.tokens.length > 0 && (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full text-sm">
            <thead className="border-b border-border bg-surface text-left text-xs text-ink-faint">
              <tr>
                <th className="px-4 py-2 font-medium">#</th>
                <th className="px-4 py-2 font-medium">Token</th>
                <th className="px-4 py-2 font-medium text-right">Price</th>
                <th className="px-4 py-2 font-medium text-right">24h</th>
                <th className="px-4 py-2 font-medium text-right">Market Cap</th>
                <th className="px-4 py-2 font-medium text-right">Volume (24h)</th>
              </tr>
            </thead>
            <tbody>
              {data.tokens.map((token) => (
                <tr key={token.id} className="border-b border-border last:border-0 hover:bg-surface-hover">
                  <td className="px-4 py-2.5 text-ink-faint">{token.market_cap_rank ?? '—'}</td>
                  <td className="px-4 py-2.5">
                    <div className="flex items-center gap-2">
                      {token.image && <img src={token.image} alt="" className="h-5 w-5 rounded-full" />}
                      <span className="font-medium text-ink">{token.name}</span>
                      <span className="text-ink-faint">{token.symbol}</span>
                    </div>
                  </td>
                  <td className="px-4 py-2.5 text-right text-ink">{formatPrice(token.current_price)}</td>
                  <td
                    className={`px-4 py-2.5 text-right ${
                      token.price_change_percentage_24h === null
                        ? 'text-ink-faint'
                        : token.price_change_percentage_24h >= 0
                          ? 'text-success'
                          : 'text-danger'
                    }`}
                  >
                    {token.price_change_percentage_24h === null
                      ? '—'
                      : `${token.price_change_percentage_24h >= 0 ? '+' : ''}${token.price_change_percentage_24h.toFixed(2)}%`}
                  </td>
                  <td className="px-4 py-2.5 text-right text-ink-muted">{formatLarge(token.market_cap)}</td>
                  <td className="px-4 py-2.5 text-right text-ink-muted">{formatLarge(token.total_volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
