import { Fragment, useState } from 'react'

import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import type { ContractDeployment } from '../../lib/contractsApi'
import { Erc20ManagePanel } from './Erc20ManagePanel'
import { LiquidityPanel } from './LiquidityPanel'
import { VerifySource } from './VerifySource'

export function DeploymentHistory({ deployments }: { deployments: ContractDeployment[] }) {
  // One expanded row at a time, showing one of its panels.
  const [open, setOpen] = useState<{ id: string; panel: 'manage' | 'liquidity' } | null>(null)
  const toggle = (id: string, panel: 'manage' | 'liquidity') =>
    setOpen((current) => (current?.id === id && current.panel === panel ? null : { id, panel }))
  const isOpen = (id: string, panel: 'manage' | 'liquidity') => open?.id === id && open.panel === panel
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
            <th className="px-4 py-3 font-medium">
              <span className="sr-only">Actions</span>
            </th>
          </tr>
        </thead>
        <tbody>
          {deployments.map((deployment) => (
            <Fragment key={deployment.id}>
              <tr className="border-b border-border transition-colors duration-150 last:border-0 hover:bg-surface-hover">
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
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {deployment.template_id === 'erc20_advanced' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={isOpen(deployment.id, 'manage')}
                        aria-label={`Manage ${deployment.contract_address}`}
                        onClick={() => toggle(deployment.id, 'manage')}
                      >
                        {isOpen(deployment.id, 'manage') ? 'Hide' : 'Manage'}
                      </Button>
                    )}
                    {deployment.contract_type === 'erc20' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        aria-expanded={isOpen(deployment.id, 'liquidity')}
                        aria-label={`Liquidity for ${deployment.contract_address}`}
                        onClick={() => toggle(deployment.id, 'liquidity')}
                      >
                        {isOpen(deployment.id, 'liquidity') ? 'Hide' : 'Liquidity'}
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
              {open?.id === deployment.id && (
                <tr>
                  <td colSpan={6} className="px-4 pb-4">
                    {open.panel === 'manage' ? <Erc20ManagePanel deployment={deployment} /> : <LiquidityPanel deployment={deployment} />}
                  </td>
                </tr>
              )}
            </Fragment>
          ))}
        </tbody>
      </table>
    </div>
  )
}
