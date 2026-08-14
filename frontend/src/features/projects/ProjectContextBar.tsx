import { Link } from 'react-router-dom'

import { Badge, type BadgeTone } from '../../components/ui/Badge'
import type { Project, ProjectStatus } from '../../lib/projectsApi'

const STATUS_TONE: Record<ProjectStatus, BadgeTone> = {
  draft: 'neutral',
  active: 'success',
  archived: 'neutral',
}

interface Props {
  project: Project
  currentStepLabel: string
}

// Shown on the token/contract/NFT pages when arriving via ?project=<id> —
// makes it visible that this page is a continuation of a project the
// wizard started (step 1: type + name, done in NewProjectWizard), not a
// disconnected standalone page. This is step 2 (configure); the create
// action itself (deploy / generate+publish) is step 3, reflected here once
// the project links to a real ContractDeployment/NFTCollection.
export function ProjectContextBar({ project, currentStepLabel }: Props) {
  const isLinked = Boolean(project.contract_deployment || project.nft_collection)

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent-500/30 bg-accent-500/5 px-4 py-2.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-ink-faint">Project</span>
        <span className="font-medium text-ink">{project.name}</span>
        <Badge tone={STATUS_TONE[project.status]}>{isLinked ? 'Deployed' : currentStepLabel}</Badge>
      </div>
      <Link to="/dashboard" className="text-xs text-ink-muted underline hover:text-ink">
        ← Back to dashboard
      </Link>
    </div>
  )
}
