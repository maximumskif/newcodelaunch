import { useSearchParams } from 'react-router-dom'

import { PageHero } from '../../components/ui/PageHero'
import { DeployPanel } from '../contracts/DeployPanel'

export function TokenLaunchpadPage() {
  const [searchParams] = useSearchParams()
  const projectId = searchParams.get('project')
  const templateId = searchParams.get('template')

  return (
    <div className="space-y-6 p-8">
      <PageHero
        eyebrow="Token Launchpad"
        title="Launch a token"
        description="Deploy an ERC-20 token from a real, compiled Solidity template."
      />

      <DeployPanel
        title="Deploy Your Token"
        description="Pick a template, fill in the parameters, and deploy with your connected wallet — no private key ever leaves your browser."
        templateType="erc20"
        projectId={projectId}
        preselectedTemplateId={templateId}
      />
    </div>
  )
}
