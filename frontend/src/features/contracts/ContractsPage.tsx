import { useSearchParams } from 'react-router-dom'

import { PageHero } from '../../components/ui/PageHero'
import { DeployPanel } from './DeployPanel'
import { NetworkStatusGrid } from './NetworkStatusGrid'

export function ContractsPage() {
  const [searchParams] = useSearchParams()
  const projectId = searchParams.get('project')
  const templateId = searchParams.get('template')

  return (
    <div className="space-y-8 p-4 sm:p-8">
      <PageHero
        eyebrow="Smart Contracts Hub"
        title="Deploy a contract"
        description="Pick a template, fill in a few fields, and deploy from your own wallet. We compile the contract; you sign it — nothing is ever signed on our servers."
      >
        <NetworkStatusGrid />
      </PageHero>

      <DeployPanel
        title="1. Choose a template"
        description="Every template is real, readable Solidity — source-verifiable on the explorer after deploy."
        projectId={projectId}
        preselectedTemplateId={templateId}
      />
    </div>
  )
}
