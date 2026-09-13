import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { Dropdown } from '../../components/ui/Dropdown'
import { IconChevronDown } from '../../components/ui/icons'
import { PROJECT_TYPES } from '../../lib/projectTypes'
import { projectsApi, type Project, type ProjectStatus } from '../../lib/projectsApi'
import { useAuth } from '../auth/AuthContext'

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
  const { accessToken } = useAuth()
  const navigate = useNavigate()
  // null = not fetched yet (dropdown's own loading state); fetched once per
  // mounted bar, not re-fetched on every open — this bar only lives on a
  // single project's page for as long as that page is, so a project
  // created/deleted elsewhere while this is open is already a rare enough
  // case not to warrant refetching on every click.
  const [otherProjects, setOtherProjects] = useState<Project[] | null>(null)

  useEffect(() => {
    if (!accessToken) return
    let cancelled = false
    projectsApi
      .list(accessToken)
      .then(({ projects: fetched }) => {
        if (!cancelled) setOtherProjects(fetched.filter((candidate) => candidate.id !== project.id))
      })
      .catch(() => {
        // The switcher is a convenience, not this page's main content — a
        // failed fetch degrades to "no other projects" rather than leaving
        // the dropdown stuck on "Loading…" forever or throwing an unhandled
        // rejection.
        if (!cancelled) setOtherProjects([])
      })
    return () => {
      cancelled = true
    }
  }, [accessToken, project.id])

  const goToProject = (target: Project) => {
    navigate(`${PROJECT_TYPES[target.project_type].path}?project=${target.id}`)
  }

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-accent-500/30 bg-accent-500/5 px-4 py-2.5">
      <div className="flex items-center gap-2 text-sm">
        <span className="text-ink-faint">Project</span>
        <span className="font-medium text-ink">{project.name}</span>
        <Badge tone={STATUS_TONE[project.status]}>{isLinked ? 'Deployed' : currentStepLabel}</Badge>
      </div>
      {/* ml-auto: this row is `flex-wrap`, and at a narrow width the
          dropdown trigger below wraps onto its own line — without this, a
          lone wrapped flex item sits at that line's start (far left), which
          combined with `align="right"` (the menu's right edge anchored to
          the trigger's own right edge) pushed the whole w-64 menu off the
          left edge of the viewport instead of over the trigger. ml-auto
          keeps the trigger pinned to its line's right edge in both the
          wrapped and unwrapped case, which is what `align="right"` assumes. */}
      <Dropdown
        align="right"
        className="ml-auto"
        trigger={
          <>
            <span className="text-xs">Switch project</span>
            <IconChevronDown className="h-3.5 w-3.5" />
          </>
        }
      >
        {otherProjects === null ? (
          <p className="px-3 py-2 text-xs text-ink-faint">Loading…</p>
        ) : otherProjects.length === 0 ? (
          <p className="px-3 py-2 text-xs text-ink-faint">No other projects yet.</p>
        ) : (
          otherProjects.map((other) => (
            <button
              key={other.id}
              type="button"
              onClick={() => goToProject(other)}
              className="flex w-full items-center justify-between gap-2 rounded-md px-3 py-2 text-left text-sm text-ink hover:bg-surface-hover"
            >
              <span className="truncate">{other.name}</span>
              <span className="shrink-0 text-xs text-ink-faint">{PROJECT_TYPES[other.project_type].label}</span>
            </button>
          ))
        )}
        <div className="my-1 border-t border-border" />
        <Link to="/dashboard" className="block rounded-md px-3 py-2 text-sm text-ink-muted hover:bg-surface-hover">
          View all projects
        </Link>
      </Dropdown>
    </div>
  )
}
