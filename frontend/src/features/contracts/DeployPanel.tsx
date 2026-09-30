import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { IconCheck, IconSpinner } from '../../components/ui/icons'
import { InlineError } from '../../components/ui/InlineError'
import { MainnetConfirmCheckbox } from '../../components/ui/MainnetConfirmCheckbox'
import { SignInPrompt } from '../../components/ui/SignInPrompt'
import { contractsApi, type ContractDeployment, type ContractTemplateSummary, type DeploymentEstimate } from '../../lib/contractsApi'
import { projectsApi, type Project } from '../../lib/projectsApi'
import { tokenPagePath } from '../../lib/tokenPagesApi'
import { useAuth } from '../auth/AuthContext'
import { EVM_NETWORKS, isMainnetNetwork, useNetwork } from '../network/NetworkContext'
import { ProjectContextBar } from '../projects/ProjectContextBar'
import { DeploymentHistory } from './DeploymentHistory'
import { isPickable, templateMeta } from './templateMeta'
import { TemplateForm } from './TemplateForm'
import { VerifySource } from './VerifySource'
import { useDeployTemplate, type DeployStep } from './useDeployTemplate'
import { errorMessage } from '../../lib/errors'

const BUSY_STEPS = new Set(['compiling', 'deploying', 'confirming', 'recording'])
const DRAFT_SAVE_DEBOUNCE_MS = 800

interface Props {
  title: string
  description: string
  templateType?: 'erc20' | 'erc721'
  projectId?: string | null
  preselectedTemplateId?: string | null
}

// Shared by the Smart Contracts Hub (all templates) and Token Launchpad
// (templateType='erc20') pages — same compile/estimate/deploy/history flow,
// just a different template subset and page chrome around it.
export function DeployPanel({ title, description, templateType, projectId, preselectedTemplateId }: Props) {
  const { address } = useAccount()
  const { accessToken } = useAuth()
  const { network, setNetwork } = useNetwork()

  const [templates, setTemplates] = useState<ContractTemplateSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, string>>({})
  const [estimate, setEstimate] = useState<DeploymentEstimate | null>(null)
  const [estimateError, setEstimateError] = useState<string | null>(null)
  const [isEstimating, setIsEstimating] = useState(false)
  const [history, setHistory] = useState<ContractDeployment[]>([])
  const [hasRestoredDraft, setHasRestoredDraft] = useState(!projectId)
  const [project, setProject] = useState<Project | null>(null)
  const [mainnetConfirmed, setMainnetConfirmed] = useState(false)
  // Re-arms the confirmation every time the network changes (so switching
  // straight from one mainnet to another still requires a fresh tick),
  // without a useEffect — React's own recommended "adjust state when a prop
  // changes" pattern (https://react.dev/learn/you-might-not-need-an-effect):
  // comparing against the last-seen network during render and adjusting
  // state right then avoids the extra effect-triggered render an effect
  // would add.
  const [confirmedForNetwork, setConfirmedForNetwork] = useState(network)
  if (network !== confirmedForNetwork) {
    setConfirmedForNetwork(network)
    setMainnetConfirmed(false)
  }

  const { deploy, step, error, deployment, txHash } = useDeployTemplate()

  const isMainnet = isMainnetNetwork(network)

  useEffect(() => {
    contractsApi.listTemplates(templateType).then(({ templates: all }) => {
      const fetched = all.filter(isPickable)
      setTemplates(fetched)
      const preselected = preselectedTemplateId && fetched.some((t) => t.id === preselectedTemplateId) ? preselectedTemplateId : null
      setSelectedId((current) => current ?? preselected ?? fetched[0]?.id ?? null)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- preselectedTemplateId only matters on first load, before any selection is made
  }, [templateType])

  useEffect(() => {
    if (!accessToken) return
    contractsApi.listDeployments(accessToken).then(({ deployments }) => setHistory(deployments))
  }, [accessToken, deployment])

  // Resume: pull the last-saved template/parameter selection (and network)
  // back out of the project's draft_data, once, when arriving via ?project=.
  useEffect(() => {
    if (!accessToken || !projectId) return
    let cancelled = false
    projectsApi.get(accessToken, projectId).then(({ project: fetched }) => {
      if (cancelled) return
      setProject(fetched)
      const draft = fetched.draft_data as { template_id?: string; parameters?: Record<string, string> }
      if (draft.template_id) setSelectedId(draft.template_id)
      if (draft.parameters) setValues(draft.parameters)
      if (fetched.network) setNetwork(fetched.network)
      setHasRestoredDraft(true)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per projectId, not on every accessToken/setNetwork identity change
  }, [accessToken, projectId])

  // Once a deploy actually lands and gets recorded (and best-effort linked
  // server-side), re-fetch so the context bar's "Deployed" badge reflects
  // reality instead of staying on "Configuring" after the fact.
  useEffect(() => {
    if (!accessToken || !projectId || !deployment) return
    projectsApi.get(accessToken, projectId).then(({ project: fetched }) => setProject(fetched))
  }, [accessToken, projectId, deployment])

  // Autosave: keep the project's draft_data (and network — otherwise a
  // manual mid-session network switch would get silently reverted the next
  // time this project is resumed, since the restore effect above always
  // re-applies whatever network was last saved) in sync with the
  // in-progress form so resuming later restores exactly where things were left.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (!accessToken || !projectId || !hasRestoredDraft || !selectedId) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void projectsApi.update(accessToken, projectId, {
        draft_data: { template_id: selectedId, parameters: values },
        network,
      })
    }, DRAFT_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(saveTimer.current)
  }, [accessToken, projectId, hasRestoredDraft, selectedId, values, network])

  const selectedTemplate = templates.find((template) => template.id === selectedId) ?? null

  const handleChange = (name: string, value: string) => {
    setValues((prev) => ({ ...prev, [name]: value }))
  }

  const collectParameters = (): Record<string, string> => {
    const merged: Record<string, string> = {}
    for (const param of selectedTemplate?.deployment_params ?? []) {
      merged[param.name] = values[param.name] ?? (param.default !== undefined ? String(param.default) : '')
    }
    return merged
  }

  const handleEstimate = async () => {
    if (!selectedTemplate || !address) return
    setEstimateError(null)
    setIsEstimating(true)
    try {
      const result = await contractsApi.estimate(selectedTemplate.id, collectParameters(), network, address)
      setEstimate(result)
    } catch (err) {
      setEstimateError(errorMessage(err, 'Estimate failed'))
    } finally {
      setIsEstimating(false)
    }
  }

  const handleDeploy = () => {
    if (!selectedTemplate) return
    void deploy(selectedTemplate.id, collectParameters(), network, projectId ?? undefined)
  }

  const isBusy = BUSY_STEPS.has(step)
  const networkLabel = EVM_NETWORKS.find((item) => item.id === network)?.label ?? network
  const meta = selectedTemplate ? templateMeta(selectedTemplate.id) : null
  const identity = meta?.identityParams.map((name) => collectParameters()[name]).find(Boolean)

  return (
    <div className="space-y-8">
      {project && (
        <ProjectContextBar
          project={project}
          currentStepLabel={templateType === 'erc20' ? 'Configuring token' : 'Configuring contract'}
          isLinked={Boolean(project.contract_deployment)}
        />
      )}

      <section aria-labelledby="deploy-heading" className="space-y-4">
        <div>
          <h2 id="deploy-heading" className="font-display text-2xl font-semibold tracking-tight text-ink">{title}</h2>
          <p className="mt-1 max-w-2xl text-ink-muted">{description}</p>
        </div>
        <div className={`grid gap-3 sm:grid-cols-2 ${templates.length > 3 ? 'xl:grid-cols-4' : templates.length === 3 ? 'xl:grid-cols-3' : ''}`}>
          {templates.map((template) => (
            <TemplateCard key={template.id} template={template} selected={template.id === selectedId} onSelect={() => setSelectedId(template.id)} />
          ))}
        </div>
      </section>

      {selectedTemplate && meta && (
        <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1fr)_340px]">
          <section aria-labelledby="configure-heading" className="rounded-xl border border-border bg-surface p-6">
            <div className="mb-6 flex items-center gap-3 border-b border-border pb-5">
              <span className="grid h-10 w-10 place-items-center rounded-lg bg-accent-500 text-canvas">
                <meta.icon className="h-5 w-5" />
              </span>
              <div>
                <h3 id="configure-heading" className="font-display text-lg font-semibold text-ink">2. Fill in the details</h3>
                <p className="text-sm text-ink-faint">{selectedTemplate.name} · fields marked * are required, and are written into the contract's code.</p>
              </div>
            </div>
            <TemplateForm params={selectedTemplate.deployment_params} values={values} onChange={handleChange} />
          </section>

          <aside aria-label="Deployment summary" className="space-y-4 rounded-xl border border-border bg-surface p-5 lg:sticky lg:top-6">
            <h3 className="font-display text-base font-semibold text-ink">Summary</h3>
            <dl className="space-y-2.5 text-sm">
              <SummaryRow label="Network">
                <span className={isMainnet ? 'font-medium text-warning' : 'text-ink'}>{networkLabel}</span>
                {isMainnet ? <Badge tone="warning" className="ml-2">Mainnet</Badge> : <Badge className="ml-2">Testnet</Badge>}
              </SummaryRow>
              <SummaryRow label="Template">{selectedTemplate.name}</SummaryRow>
              {identity && <SummaryRow label="Name">{identity}</SummaryRow>}
              <SummaryRow label="Estimated cost">
                {estimate ? (
                  <span className="font-mono">
                    {estimate.deployment_cost_native.toFixed(6)} {estimate.native_token}
                  </span>
                ) : (
                  <span className="text-ink-faint">Not estimated</span>
                )}
              </SummaryRow>
            </dl>
            {estimate && (
              <p className="text-xs text-ink-faint">
                ~{estimate.gas_estimate.toLocaleString()} gas at {estimate.gas_price_gwei.toFixed(2)} gwei ≈{' '}
                {estimate.deployment_cost_native.toFixed(6)} {estimate.native_token}
              </p>
            )}
            <p className="text-xs text-ink-faint">Change the network in the top bar.</p>

            {isMainnet && (
              <MainnetConfirmCheckbox
                checked={mainnetConfirmed}
                onChange={setMainnetConfirmed}
                disabled={isBusy}
                verb="deploys to"
                networkLabel="mainnet"
              />
            )}

            <div className="grid gap-2">
              <Button
                variant="primary"
                onClick={handleDeploy}
                disabled={!address || isBusy || (isMainnet && !mainnetConfirmed)}
                className="w-full justify-center"
              >
                {isBusy ? `${step}…` : 'Deploy'}
              </Button>
              <Button variant="secondary" onClick={handleEstimate} disabled={!address} isLoading={isEstimating} className="w-full justify-center">
                Estimate cost
              </Button>
              {!address && <p className="text-center text-xs text-ink-faint">Connect an EVM wallet to estimate or deploy</p>}
            </div>

            {step !== 'idle' && <DeployProgress step={step} />}
            {estimateError && <InlineError>{estimateError}</InlineError>}
            {error && <InlineError>{error}</InlineError>}
            {txHash && step !== 'error' && (
              <p className="break-all text-xs text-ink-faint">
                tx <span className="font-mono">{txHash}</span>
              </p>
            )}
            {deployment && (
              <div className="space-y-2 rounded-lg border border-success/30 bg-success/5 p-3 text-sm" data-testid="deploy-result">
                <p className="text-success">
                  Deployed at <span className="break-all font-mono">{deployment.contract_address}</span>.
                </p>
                <div className="flex flex-wrap items-center gap-3">
                  {deployment.explorer_url && (
                    <a href={deployment.explorer_url} target="_blank" rel="noreferrer" className="text-accent-300 hover:underline">
                      View on explorer
                    </a>
                  )}
                  <VerifySource key={deployment.id} deployment={deployment} compact />
                </div>
                {deployment.contract_type === 'erc20' && (
                  <div className="border-t border-success/20 pt-2">
                    <p className="font-mono text-xs text-ink-faint">next</p>
                    <div className="mt-1 flex flex-wrap gap-x-3 gap-y-1 font-mono text-xs">
                      {[
                        ['public page', tokenPagePath(deployment.network, deployment.contract_address)],
                        ['add liquidity ↓', '#history'],
                        ['airdrop', `/liquidity/airdrop?network=${deployment.network}&token=${deployment.contract_address}`],
                        ['holders', `/liquidity/snapshot?network=${deployment.network}&address=${deployment.contract_address}`],
                      ].map(([label, to]) => (
                        <Link key={label} to={to} className="text-accent-300 hover:underline">
                          {label} →
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </aside>
        </div>
      )}

      <section id="history" aria-labelledby="history-heading" className="scroll-mt-4 space-y-3">
        <div className="flex items-baseline justify-between">
          <h3 id="history-heading" className="font-display text-lg font-semibold text-ink">Deployment history</h3>
          {accessToken && history.length > 0 && <span className="text-xs text-ink-faint">{history.length} deployed</span>}
        </div>
        {accessToken ? (
          <DeploymentHistory deployments={history} />
        ) : (
          <SignInPrompt purpose="deploy, and to see and manage what you've deployed" compact />
        )}
      </section>
    </div>
  )
}

function TemplateCard({ template, selected, onSelect }: { template: ContractTemplateSummary; selected: boolean; onSelect: () => void }) {
  const { icon: Icon, tags } = templateMeta(template.id)
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={selected}
      className={`group relative flex h-full flex-col gap-3 rounded-xl border p-4 text-left transition-all duration-150 ${
        selected
          ? 'border-accent-500 bg-accent-500/10 shadow-[var(--shadow-glow-accent)]'
          : 'border-border bg-surface hover:-translate-y-0.5 hover:border-border-strong hover:bg-surface-hover'
      }`}
    >
      <div className="flex items-start justify-between">
        <span
          className={`grid h-9 w-9 place-items-center rounded-lg ${selected ? 'bg-accent-500 text-canvas' : 'bg-surface-raised text-accent-300'}`}
        >
          <Icon className="h-[18px] w-[18px]" />
        </span>
        {selected && (
          <span className="grid h-5 w-5 place-items-center rounded-full bg-accent-500 text-canvas">
            <IconCheck className="h-3 w-3" />
          </span>
        )}
      </div>
      <div>
        <p className="font-medium text-ink">{template.name}</p>
        <p className="mt-1 line-clamp-2 text-sm text-ink-muted">{template.description}</p>
      </div>
      {tags.length > 0 && (
        <div className="mt-auto flex flex-wrap gap-1.5">
          {tags.map((tag) => (
            <span key={tag} className="rounded-md bg-surface-raised px-2 py-0.5 text-[11px] text-ink-muted">
              {tag}
            </span>
          ))}
        </div>
      )}
    </button>
  )
}

function SummaryRow({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3">
      <dt className="text-ink-faint">{label}</dt>
      <dd className="flex items-center text-right text-ink">{children}</dd>
    </div>
  )
}

const PROGRESS: { step: DeployStep; label: string }[] = [
  { step: 'compiling', label: 'Compile' },
  { step: 'deploying', label: 'Sign & broadcast' },
  { step: 'confirming', label: 'Confirm on-chain' },
  { step: 'recording', label: 'Verify & record' },
]

// Where a deploy is: done steps checked, the current one spinning. On an
// error it stops where it failed (the error message says why).
function DeployProgress({ step }: { step: DeployStep }) {
  const current = step === 'done' ? PROGRESS.length : PROGRESS.findIndex((item) => item.step === step)
  return (
    <ol className="space-y-2 rounded-lg border border-border bg-canvas p-3 text-sm" aria-label="Deployment progress">
      {PROGRESS.map((item, index) => {
        const state = step === 'error' ? 'idle' : index < current ? 'done' : index === current ? 'active' : 'idle'
        return (
          <li key={item.step} className="flex items-center gap-2.5">
            <span
              className={`grid h-5 w-5 shrink-0 place-items-center rounded-full text-[10px] ${
                state === 'done' ? 'bg-success/15 text-success' : state === 'active' ? 'bg-accent-500/20 text-accent-300' : 'bg-surface-raised text-ink-faint'
              }`}
            >
              {state === 'done' ? <IconCheck className="h-3 w-3" /> : state === 'active' ? <IconSpinner className="h-3 w-3" /> : index + 1}
            </span>
            <span className={state === 'idle' ? 'text-ink-faint' : 'text-ink'}>{item.label}</span>
          </li>
        )
      })}
    </ol>
  )
}
