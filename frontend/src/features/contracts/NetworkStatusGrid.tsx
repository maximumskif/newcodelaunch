import { useQuery } from '@tanstack/react-query'

import { InlineError } from '../../components/ui/InlineError'
import { apiClient, type NetworkSummary } from '../../lib/apiClient'

// Live status for every network, as a compact strip: one chip per network
// (green dot + gas price or slot when reachable, red + reason when not),
// mainnets and testnets in their own rows.
export function NetworkStatusGrid() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['blockchain-networks'],
    queryFn: () => apiClient.networks(),
  })
  const networks = data?.networks ?? []
  const groups: [string, NetworkSummary[]][] = [
    ['Mainnets', networks.filter((network) => !network.is_testnet)],
    ['Testnets', networks.filter((network) => network.is_testnet)],
  ]

  return (
    <section aria-labelledby="network-status-heading" className="space-y-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 id="network-status-heading" className="font-display text-sm font-semibold uppercase tracking-widest text-ink-muted">
          Network status
        </h2>
        <span className="text-xs text-ink-faint">Live · refreshes every 15s</span>
      </div>
      {error && <InlineError>{(error as Error).message}</InlineError>}
      {isLoading && <div className="h-10 animate-pulse rounded-lg bg-surface" />}
      {groups.map(
        ([label, items]) =>
          items.length > 0 && (
            <div key={label} className="flex flex-wrap items-center gap-2">
              <span className="w-20 shrink-0 text-xs text-ink-faint">{label}</span>
              {items.map((network) => (
                <NetworkChip key={network.id} networkId={network.id} name={network.name} />
              ))}
            </div>
          ),
      )}
    </section>
  )
}

function NetworkChip({ networkId, name }: { networkId: string; name: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['network-status', networkId],
    queryFn: () => apiClient.networkStatus(networkId),
    refetchInterval: 15_000,
  })
  const connected = Boolean(data?.connected)
  const metric =
    connected && 'gas_price_gwei' in data!
      ? `${Number(Number(data.gas_price_gwei).toPrecision(3))} gwei`
      : connected && 'slot' in data!
        ? `slot ${Number(data.slot).toLocaleString()}`
        : null
  const status = isLoading ? 'Checking…' : connected ? 'Connected' : (data?.error ?? 'Unavailable')

  return (
    <span
      title={`${name}: ${status}`}
      className={`inline-flex items-center gap-2 rounded-full border px-3 py-1.5 text-xs ${
        isLoading ? 'border-border text-ink-faint' : connected ? 'border-border bg-surface text-ink' : 'border-danger/30 bg-danger/5 text-danger'
      }`}
    >
      <span className="relative flex h-2 w-2 shrink-0">
        {connected && <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-success opacity-60" />}
        <span className={`relative inline-flex h-2 w-2 rounded-full ${isLoading ? 'bg-ink-faint' : connected ? 'bg-success' : 'bg-danger'}`} />
      </span>
      <span className="font-medium">{name}</span>
      {metric && <span className="font-mono text-ink-faint">{metric}</span>}
      {!isLoading && !connected && <span className="sr-only">{status}</span>}
    </span>
  )
}
