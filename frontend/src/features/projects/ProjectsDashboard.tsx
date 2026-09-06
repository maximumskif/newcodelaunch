import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'

import { Badge, type BadgeTone } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { ConfirmDialog } from '../../components/ui/Dialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconPlus, IconTrash } from '../../components/ui/icons'
import { PageHero } from '../../components/ui/PageHero'
import { PROJECT_TYPES } from '../../lib/projectTypes'
import { projectsApi, type Project, type ProjectStatus } from '../../lib/projectsApi'
import { useAuth } from '../auth/AuthContext'

const STATUS_TONE: Record<ProjectStatus, BadgeTone> = {
  draft: 'neutral',
  active: 'success',
  archived: 'neutral',
}

const STATUS_LABEL: Record<ProjectStatus, string> = {
  draft: 'Draft',
  active: 'Active',
  archived: 'Archived',
}

function linkedRecordLabel(project: Project): string | null {
  if (project.contract_deployment) return `${project.contract_deployment.contract_address.slice(0, 10)}…`
  if (project.nft_collection) return project.nft_collection.name
  if (project.candy_machine_deployment) return `${project.candy_machine_deployment.candy_machine.slice(0, 10)}…`
  return null
}

export function ProjectsDashboard() {
  const { accessToken } = useAuth()
  const navigate = useNavigate()

  const [projects, setProjects] = useState<Project[]>([])
  const [isLoading, setIsLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [pendingDelete, setPendingDelete] = useState<Project | null>(null)
  const [isDeleting, setIsDeleting] = useState(false)

  const refresh = async (token: string) => {
    setIsLoading(true)
    setError(null)
    try {
      const { projects: fetched } = await projectsApi.list(token)
      setProjects(fetched)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load projects')
    } finally {
      setIsLoading(false)
    }
  }

  useEffect(() => {
    if (accessToken) void refresh(accessToken)
  }, [accessToken])

  const handleArchive = async (project: Project) => {
    if (!accessToken) return
    const nextStatus = project.status === 'archived' ? 'draft' : 'archived'
    const { project: updated } = await projectsApi.update(accessToken, project.id, { status: nextStatus })
    setProjects((prev) => prev.map((p) => (p.id === updated.id ? updated : p)))
  }

  const handleConfirmDelete = async () => {
    if (!accessToken || !pendingDelete) return
    setIsDeleting(true)
    try {
      await projectsApi.remove(accessToken, pendingDelete.id)
      setProjects((prev) => prev.filter((p) => p.id !== pendingDelete.id))
      setPendingDelete(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete project')
    } finally {
      setIsDeleting(false)
    }
  }

  return (
    <div className="space-y-5 p-8">
      <PageHero
        eyebrow="Phase 3"
        title="Dashboard"
        description="Every project you've started — resume a draft where you left off, or jump back into something already deployed."
      />

      {!accessToken ? (
        <Card padding="lg" className="text-center">
          <p className="text-ink-muted">Connect and sign in with a wallet above to see your projects.</p>
        </Card>
      ) : (
        <>
          <div className="flex items-center justify-between">
            <p className="text-sm text-ink-faint">
              {isLoading ? 'Loading…' : `${projects.length} project${projects.length === 1 ? '' : 's'}`}
            </p>
            <Link to="/projects/new" className="inline-flex">
              <Button variant="primary" size="sm">
                <IconPlus className="h-3.5 w-3.5" />
                New Project
              </Button>
            </Link>
          </div>

          {error && <p className="text-sm text-danger">{error}</p>}

          {!isLoading && projects.length === 0 ? (
            <EmptyState
              title="No projects yet"
              description="Start a token, NFT collection, or contract — your progress is saved automatically."
              action={
                <Link to="/projects/new" className="mt-2 inline-flex">
                  <Button variant="secondary" size="sm">
                    Start your first project
                  </Button>
                </Link>
              }
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {projects.map((project) => {
                const meta = PROJECT_TYPES[project.project_type]
                const Icon = meta.icon
                const linked = linkedRecordLabel(project)
                return (
                  <Card key={project.id} padding="md" className="flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex items-center gap-2">
                        <Icon className="h-4 w-4 shrink-0 text-ink-faint" />
                        <h3 className="text-sm font-medium text-ink">{project.name}</h3>
                      </div>
                      <Badge tone={STATUS_TONE[project.status]}>{STATUS_LABEL[project.status]}</Badge>
                    </div>

                    <div className="text-xs text-ink-faint">
                      <p>{meta.label}{project.network ? ` · ${project.network}` : ''}</p>
                      {linked && <p className="mt-1 truncate font-mono">{linked}</p>}
                      <p className="mt-1">Updated {new Date(project.updated_at).toLocaleDateString()}</p>
                    </div>

                    <div className="mt-auto flex items-center justify-between gap-2 pt-1">
                      <Button
                        variant="secondary"
                        size="sm"
                        onClick={() => navigate(`${meta.path}?project=${project.id}`)}
                      >
                        {project.status === 'draft' ? 'Resume' : 'View'}
                      </Button>
                      <div className="flex items-center gap-1">
                        <Button variant="ghost" size="sm" onClick={() => void handleArchive(project)}>
                          {project.status === 'archived' ? 'Unarchive' : 'Archive'}
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          className="!p-1.5 text-danger hover:bg-danger/10"
                          aria-label="Delete project"
                          onClick={() => setPendingDelete(project)}
                        >
                          <IconTrash className="h-3.5 w-3.5" />
                        </Button>
                      </div>
                    </div>
                  </Card>
                )
              })}
            </div>
          )}
        </>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete "${pendingDelete?.name}"?`}
        description="This can't be undone. The project's own draft notes and organization are removed — any real on-chain deployment or NFT collection it links to isn't affected."
        confirmLabel="Delete"
        isConfirming={isDeleting}
        onConfirm={() => void handleConfirmDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  )
}
