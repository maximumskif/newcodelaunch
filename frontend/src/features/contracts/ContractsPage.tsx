import { useSearchParams } from 'react-router-dom'

import { PageHero } from '../../components/ui/PageHero'
import { DeployPanel } from './DeployPanel'
import { NetworkStatusGrid } from './NetworkStatusGrid'

export function ContractsPage() {
  const [searchParams] = useSearchParams()
  const projectId = searchParams.get('project')
  const templateId = searchParams.get('template')

  return (
    <div className="space-y-8 p-8">
      <PageHero
        eyebrow="Smart Contracts Hub"
        title="Compile, estimate, deploy"
        description="Live chain status, plus compile, estimate, and deploy from real Solidity templates."
      />

      <NetworkStatusGrid />

      <DeployPanel
        title="Deploy a Contract"
        description="Your connected wallet signs the deployment transaction — the backend only compiles the contract and records the result afterward."
        projectId={projectId}
        preselectedTemplateId={templateId}
      />
    </div>
  )
}
