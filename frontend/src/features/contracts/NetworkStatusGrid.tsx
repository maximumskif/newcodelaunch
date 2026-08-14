import { useQuery } from '@tanstack/react-query'

import { Card } from '../../components/ui/Card'
import { apiClient } from '../../lib/apiClient'

export function NetworkStatusGrid() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['blockchain-networks'],
    queryFn: () => apiClient.networks(),
  })

  return (
    <div>
      <h2 className="text-lg font-medium text-ink">Live Chain Status</h2>
      {isLoading && <p className="mt-3 text-ink-muted">Loading networks…</p>}
      {error && <p className="mt-3 text-danger">{(error as Error).message}</p>}
      <div className="mt-3 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {data?.networks.map((network) => (
          <NetworkStatusCard key={network.id} networkId={network.id} name={network.name} />
        ))}
      </div>
    </div>
  )
}

function NetworkStatusCard({ networkId, name }: { networkId: string; name: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['network-status', networkId],
    queryFn: () => apiClient.networkStatus(networkId),
    refetchInterval: 15_000,
  })

  return (
    <Card padding="sm">
      <p className="font-medium text-ink">{name}</p>
      <p className={`mt-1 text-sm ${data?.connected ? 'text-success' : 'text-danger'}`}>
        {isLoading ? 'Checking…' : data?.connected ? 'Connected' : (data?.error ?? 'Unavailable')}
      </p>
      {data?.connected && 'gas_price_gwei' in data && (
        <p className="mt-1 text-xs text-ink-faint">{String(data.gas_price_gwei)} gwei</p>
      )}
      {data?.connected && 'slot' in data && <p className="mt-1 text-xs text-ink-faint">slot {String(data.slot)}</p>}
    </Card>
  )
}
