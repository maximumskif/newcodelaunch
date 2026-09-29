import { Fragment, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import type { ContractDeployment } from '../../lib/contractsApi'
import { tokenPagePath } from '../../lib/tokenPagesApi'
import { EVM_NETWORKS, isMainnetNetwork } from '../network/NetworkContext'
import { templateMeta } from './templateMeta'
import { Erc20ManagePanel } from './Erc20ManagePanel'
import { LiquidityPanel } from './LiquidityPanel'
import { TokenLockPanel } from './TokenLockPanel'
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
                <td className="px-4 py-3 text-ink">
                  <span className="flex items-center gap-2.5">
                    <TemplateIcon id={deployment.template_id} />
                    {deployment.template_name}
                  </span>
                </td>
                <td className="px-4 py-3 text-ink">
                  {EVM_NETWORKS.find((item) => item.id === deployment.network)?.label ?? deployment.network}
                  {!isMainnetNetwork(deployment.network) && <span className="ml-1.5 text-xs text-ink-faint">testnet</span>}
                </td>
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
                <td className="px-4 py-3 whitespace-nowrap text-ink-faint" title={new Date(deployment.created_at).toLocaleString()}>
                  {new Date(deployment.created_at).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })}
                </td>
                <td className="px-4 py-3">
                  <div className="flex gap-1">
                    {(deployment.template_id === 'erc20_advanced' || deployment.template_id === 'token_timelock') && (
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
                      <Link
                        to={tokenPagePath(deployment.network, deployment.contract_address)}
                        aria-label={`Public page for ${deployment.contract_address}`}
                        className="self-center px-2 text-xs text-accent-400 hover:underline"
                      >
                        Public page
                      </Link>
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
                    {open.panel === 'liquidity' ? (
                      <LiquidityPanel deployment={deployment} />
                    ) : deployment.template_id === 'token_timelock' ? (
                      <TokenLockPanel deployment={deployment} />
                    ) : (
                      <Erc20ManagePanel deployment={deployment} />
                    )}
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

function TemplateIcon({ id }: { id: string }) {
  const { icon: Icon } = templateMeta(id)
  return (
    <span aria-hidden className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-surface-raised text-accent-300">
      <Icon className="h-3.5 w-3.5" />
    </span>
  )
}
