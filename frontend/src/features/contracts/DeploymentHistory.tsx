import { EmptyState } from '../../components/ui/EmptyState'
import type { ContractDeployment } from '../../lib/contractsApi'
import { VerifySource } from './VerifySource'

export function DeploymentHistory({ deployments }: { deployments: ContractDeployment[] }) {
  if (deployments.length === 0) {
    return (
      <EmptyState
        title="No deployments yet"
        description="A contract you deploy from this page will show up here, with a link to the explorer."
        compact
      />
    )
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-border bg-surface">
      <table className="w-full text-left text-sm">
        <thead className="border-b border-border text-xs text-ink-faint">
          <tr>
            <th className="px-4 py-3 font-medium">Template</th>
            <th className="px-4 py-3 font-medium">Network</th>
            <th className="px-4 py-3 font-medium">Contract</th>
            <th className="px-4 py-3 font-medium">Source</th>
            <th className="px-4 py-3 font-medium">Deployed</th>
          </tr>
        </thead>
        <tbody>
          {deployments.map((deployment) => (
            <tr key={deployment.id} className="border-b border-border transition-colors duration-150 last:border-0 hover:bg-surface-hover">
              <td className="px-4 py-3 text-ink">{deployment.template_name}</td>
              <td className="px-4 py-3 text-ink">{deployment.network}</td>
              <td className="px-4 py-3 font-mono text-ink">
                {deployment.explorer_url ? (
                  <a
                    href={deployment.explorer_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-accent-400 hover:underline"
                  >
                    {deployment.contract_address.slice(0, 10)}…
                  </a>
                ) : (
                  `${deployment.contract_address.slice(0, 10)}…`
                )}
              </td>
              <td className="px-4 py-3 text-sm">
                <VerifySource deployment={deployment} compact />
              </td>
              <td className="px-4 py-3 text-ink-faint">{new Date(deployment.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
