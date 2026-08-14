import type { ContractDeployment } from '../../lib/contractsApi'

export function DeploymentHistory({ deployments }: { deployments: ContractDeployment[] }) {
  if (deployments.length === 0) {
    return <p className="text-white/50">No deployments yet.</p>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-white/50">
          <tr>
            <th className="pb-2 pr-4">Template</th>
            <th className="pb-2 pr-4">Network</th>
            <th className="pb-2 pr-4">Contract</th>
            <th className="pb-2 pr-4">Deployed</th>
          </tr>
        </thead>
        <tbody>
          {deployments.map((deployment) => (
            <tr key={deployment.id} className="border-t border-white/10">
              <td className="py-2 pr-4">{deployment.template_name}</td>
              <td className="py-2 pr-4">{deployment.network}</td>
              <td className="py-2 pr-4 font-mono">
                {deployment.explorer_url ? (
                  <a
                    href={deployment.explorer_url}
                    target="_blank"
                    rel="noreferrer"
                    className="text-purple-400 hover:underline"
                  >
                    {deployment.contract_address.slice(0, 10)}…
                  </a>
                ) : (
                  `${deployment.contract_address.slice(0, 10)}…`
                )}
              </td>
              <td className="py-2 pr-4 text-white/50">{new Date(deployment.created_at).toLocaleString()}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
