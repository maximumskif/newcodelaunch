import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { PageHero } from '../../components/ui/PageHero'
import { Stepper } from '../../components/ui/Stepper'
import { EVM_NETWORKS } from '../network/NetworkContext'
import { PROJECT_TYPES, WIZARD_PROJECT_TYPES } from '../../lib/projectTypes'
import { projectsApi, type ProjectType } from '../../lib/projectsApi'
import { useAuth } from '../auth/AuthContext'

// Two local steps (pick a type, then name it) that end by creating a real
// Project draft and handing off into the existing token/nft/contract page —
// the wizard doesn't reimplement any of those flows, it just gives them a
// resumable entry point. See ProjectsDashboard for the "resume" half of
// save/resume: reopening a draft from there reuses this same project_id.
export function NewProjectWizard() {
  const { accessToken } = useAuth()
  const navigate = useNavigate()

  const [projectType, setProjectType] = useState<ProjectType | null>(null)
  const [name, setName] = useState('')
  const [network, setNetwork] = useState('sepolia')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const step = projectType ? 'details' : 'type'
  const meta = projectType ? PROJECT_TYPES[projectType] : null

  const handleCreate = async () => {
    if (!accessToken || !projectType || !name.trim()) return
    setIsSubmitting(true)
    setError(null)
    try {
      const { project } = await projectsApi.create(accessToken, {
        name: name.trim(),
        project_type: projectType,
        chain: 'evm',
        network: meta?.needsNetwork ? network : undefined,
      })
      navigate(`${PROJECT_TYPES[project.project_type].path}?project=${project.id}`)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create project')
      setIsSubmitting(false)
    }
  }

  if (!accessToken) {
    return (
      <div className="space-y-5 p-8">
        <PageHero eyebrow="Phase 3" title="New Project" description="Connect and sign in with a wallet first." />
      </div>
    )
  }

  return (
    <div className="space-y-5 p-8">
      <PageHero
        eyebrow="Phase 3"
        title="New Project"
        description="Start something new — your progress is saved as a draft you can resume from the dashboard."
      />

      <Stepper
        activeId={step}
        steps={[
          { id: 'type', label: 'Choose a type', done: Boolean(projectType) },
          { id: 'details', label: 'Name it', done: false },
        ]}
      />

      {!projectType ? (
        <div className="grid gap-3 sm:grid-cols-3">
          {(Object.entries(WIZARD_PROJECT_TYPES) as [ProjectType, (typeof PROJECT_TYPES)[ProjectType]][]).map(
            ([type, info]) => {
              const Icon = info.icon
              return (
                <button key={type} onClick={() => setProjectType(type)} className="text-left">
                  <Card padding="md" className="h-full transition-colors duration-150 hover:border-accent-500">
                    <Icon className="h-5 w-5 text-accent-400" />
                    <p className="mt-3 text-sm font-medium text-ink">{info.label}</p>
                    <p className="mt-1 text-xs text-ink-faint">{info.description}</p>
                  </Card>
                </button>
              )
            },
          )}
        </div>
      ) : (
        <Card padding="lg" className="max-w-md space-y-4">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-ink">{meta!.label}</p>
            <Button variant="ghost" size="sm" onClick={() => setProjectType(null)}>
              Change type
            </Button>
          </div>

          <label className="block text-sm text-ink-muted">
            Project name
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder={`My ${meta!.label.toLowerCase()}`}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink placeholder:text-ink-faint"
            />
          </label>

          {meta!.needsNetwork && (
            <label className="block text-sm text-ink-muted">
              Network
              <div className="mt-1 flex gap-1.5">
                {EVM_NETWORKS.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setNetwork(item.id)}
                    className={`rounded-md border px-2.5 py-1.5 text-xs transition-colors duration-150 ${
                      network === item.id ? 'border-accent-500 bg-accent-500/10 text-ink' : 'border-border text-ink-muted hover:bg-surface-hover'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </label>
          )}

          {error && <p className="text-sm text-danger">{error}</p>}

          <Button variant="primary" className="w-full" disabled={!name.trim()} isLoading={isSubmitting} onClick={handleCreate}>
            Create draft and continue
          </Button>
        </Card>
      )}
    </div>
  )
}
