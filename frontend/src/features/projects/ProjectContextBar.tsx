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
  // Caller-supplied, not derived here on purpose: a candy_machine project
  // always already has nft_collection set (it's created from an already-
  // published collection), so a generic "any link exists" check would show
  // "Deployed" on MintLaunchPage from the very first render, before a candy
  // machine actually exists — each page knows which specific link is its
  // own "done" signal (contract_deployment / nft_collection / candy_machine_deployment).
  isLinked: boolean
}

// Shown on the token/contract/NFT pages when arriving via ?project=<id> —
// makes it visible that this page is a continuation of a project the
// wizard started (step 1: type + name, done in NewProjectWizard), not a
// disconnected standalone page. This is step 2 (configure); the create
// action itself (deploy / generate+publish) is step 3, reflected here once
// the project links to a real ContractDeployment/NFTCollection/CandyMachineDeployment.
export function ProjectContextBar({ project, currentStepLabel, isLinked }: Props) {
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
