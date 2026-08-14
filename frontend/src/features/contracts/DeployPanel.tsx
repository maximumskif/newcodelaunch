import { useEffect, useRef, useState } from 'react'
import { useAccount } from 'wagmi'

import { Button } from '../../components/ui/Button'
import { contractsApi, type ContractDeployment, type ContractTemplateSummary, type DeploymentEstimate } from '../../lib/contractsApi'
import { projectsApi } from '../../lib/projectsApi'
import { useAuth } from '../auth/AuthContext'
import { EVM_NETWORKS, useNetwork } from '../network/NetworkContext'
import { DeploymentHistory } from './DeploymentHistory'
import { TemplateForm } from './TemplateForm'
import { useDeployTemplate } from './useDeployTemplate'

const BUSY_STEPS = new Set(['compiling', 'deploying', 'confirming', 'recording'])
const DRAFT_SAVE_DEBOUNCE_MS = 800

interface Props {
  title: string
  description: string
  templateType?: 'erc20' | 'erc721'
  projectId?: string | null
}

// Shared by the Smart Contracts Hub (all templates) and Token Launchpad
// (templateType='erc20') pages — same compile/estimate/deploy/history flow,
// just a different template subset and page chrome around it.
export function DeployPanel({ title, description, templateType, projectId }: Props) {
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

  const { deploy, step, error, deployment, txHash } = useDeployTemplate()

  useEffect(() => {
    contractsApi.listTemplates(templateType).then(({ templates: fetched }) => {
      setTemplates(fetched)
      setSelectedId((current) => current ?? fetched[0]?.id ?? null)
    })
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
    projectsApi.get(accessToken, projectId).then(({ project }) => {
      if (cancelled) return
      const draft = project.draft_data as { template_id?: string; parameters?: Record<string, string> }
      if (draft.template_id) setSelectedId(draft.template_id)
      if (draft.parameters) setValues(draft.parameters)
      if (project.network) setNetwork(project.network)
      setHasRestoredDraft(true)
    })
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- run once per projectId, not on every accessToken/setNetwork identity change
  }, [accessToken, projectId])

  // Autosave: keep the project's draft_data in sync with the in-progress
  // form so resuming later restores exactly where the user left off.
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  useEffect(() => {
    if (!accessToken || !projectId || !hasRestoredDraft || !selectedId) return
    clearTimeout(saveTimer.current)
    saveTimer.current = setTimeout(() => {
      void projectsApi.update(accessToken, projectId, {
        draft_data: { template_id: selectedId, parameters: values },
      })
    }, DRAFT_SAVE_DEBOUNCE_MS)
    return () => clearTimeout(saveTimer.current)
  }, [accessToken, projectId, hasRestoredDraft, selectedId, values])

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
      setEstimateError(err instanceof Error ? err.message : 'Estimate failed')
    } finally {
      setIsEstimating(false)
    }
  }

  const handleDeploy = () => {
    if (!selectedTemplate) return
    void deploy(selectedTemplate.id, collectParameters(), network, projectId ?? undefined)
  }

  const isBusy = BUSY_STEPS.has(step)

  return (
    <div>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-ink">{title}</h2>
          <p className="mt-1 text-ink-muted">{description}</p>
        </div>
        <p className="text-sm text-ink-faint">
          Network: <span className="text-ink-muted">{EVM_NETWORKS.find((item) => item.id === network)?.label ?? network}</span>{' '}
          — change it in the top bar
        </p>
      </div>

      <div className="mt-4 grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          {templates.map((template) => (
            <button
              key={template.id}
              onClick={() => setSelectedId(template.id)}
              className={`w-full rounded-md border px-3 py-2 text-left text-sm transition-colors duration-150 ${
                template.id === selectedId ? 'border-accent-500 bg-accent-500/10' : 'border-border hover:bg-surface-hover'
              }`}
            >
              <p className="font-medium text-ink">{template.name}</p>
              <p className="text-ink-faint">{template.description}</p>
            </button>
          ))}
        </div>

        {selectedTemplate && (
          <div className="space-y-4">
            <TemplateForm params={selectedTemplate.deployment_params} values={values} onChange={handleChange} />

            <div className="flex flex-wrap items-center gap-3">
              <Button variant="secondary" onClick={handleEstimate} disabled={!address} isLoading={isEstimating}>
                Estimate cost
              </Button>
              <Button variant="primary" onClick={handleDeploy} disabled={!address || isBusy}>
                {isBusy ? `${step}…` : 'Deploy'}
              </Button>
              {!address && <span className="text-sm text-ink-faint">Connect an EVM wallet to estimate or deploy</span>}
            </div>

            {estimateError && <p className="text-sm text-danger">{estimateError}</p>}
            {estimate && (
              <p className="text-sm text-ink-muted">
                ~{estimate.gas_estimate.toLocaleString()} gas at {estimate.gas_price_gwei.toFixed(2)} gwei ≈{' '}
                {estimate.deployment_cost_native.toFixed(6)} {estimate.native_token}
              </p>
            )}

            {error && <p className="text-sm text-danger">{error}</p>}
            {txHash && step !== 'error' && (
              <p className="text-sm text-ink-muted">
                tx: <span className="font-mono">{txHash}</span> — {step}
              </p>
            )}
            {deployment && (
              <p className="text-sm text-success">
                Deployed at <span className="font-mono">{deployment.contract_address}</span>.{' '}
                {deployment.explorer_url && (
                  <a href={deployment.explorer_url} target="_blank" rel="noreferrer" className="underline">
                    View on explorer
                  </a>
                )}
              </p>
            )}
          </div>
        )}
      </div>

      <div className="mt-10">
        <h3 className="text-base font-medium text-ink">Deployment History</h3>
        <div className="mt-3">
          {accessToken ? (
            <DeploymentHistory deployments={history} />
          ) : (
            <p className="text-ink-faint">Sign in with your wallet to see your deployment history.</p>
          )}
        </div>
      </div>
    </div>
  )
}
