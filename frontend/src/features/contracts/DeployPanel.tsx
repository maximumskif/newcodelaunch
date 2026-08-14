import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'

import { contractsApi, type ContractDeployment, type ContractTemplateSummary, type DeploymentEstimate } from '../../lib/contractsApi'
import { useAuth } from '../auth/AuthContext'
import { DeploymentHistory } from './DeploymentHistory'
import { TemplateForm } from './TemplateForm'
import { useDeployTemplate } from './useDeployTemplate'

const NETWORKS = [
  { id: 'ethereum', label: 'Ethereum' },
  { id: 'polygon', label: 'Polygon' },
  { id: 'bsc', label: 'BNB Smart Chain' },
]

const BUSY_STEPS = new Set(['compiling', 'deploying', 'confirming', 'recording'])

interface Props {
  title: string
  description: string
  templateType?: 'erc20' | 'erc721'
}

// Shared by the Smart Contracts Hub (all templates) and Token Launchpad
// (templateType='erc20') pages — same compile/estimate/deploy/history flow,
// just a different template subset and page chrome around it.
export function DeployPanel({ title, description, templateType }: Props) {
  const { address } = useAccount()
  const { accessToken } = useAuth()

  const [templates, setTemplates] = useState<ContractTemplateSummary[]>([])
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [network, setNetwork] = useState('ethereum')
  const [values, setValues] = useState<Record<string, string>>({})
  const [estimate, setEstimate] = useState<DeploymentEstimate | null>(null)
  const [estimateError, setEstimateError] = useState<string | null>(null)
  const [isEstimating, setIsEstimating] = useState(false)
  const [history, setHistory] = useState<ContractDeployment[]>([])

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
    void deploy(selectedTemplate.id, collectParameters(), network)
  }

  const isBusy = BUSY_STEPS.has(step)

  return (
    <div>
      <h2 className="text-lg font-medium">{title}</h2>
      <p className="mt-1 text-white/60">{description}</p>

      <div className="mt-4 grid gap-6 lg:grid-cols-[280px_1fr]">
        <div className="space-y-2">
          {templates.map((template) => (
            <button
              key={template.id}
              onClick={() => setSelectedId(template.id)}
              className={`w-full rounded-lg border px-3 py-2 text-left text-sm ${
                template.id === selectedId ? 'border-purple-500 bg-purple-500/10' : 'border-white/10 hover:bg-white/5'
              }`}
            >
              <p className="font-medium">{template.name}</p>
              <p className="text-white/50">{template.description}</p>
            </button>
          ))}
        </div>

        {selectedTemplate && (
          <div className="space-y-4">
            <div className="flex flex-wrap gap-2">
              {NETWORKS.map((item) => (
                <button
                  key={item.id}
                  onClick={() => setNetwork(item.id)}
                  className={`rounded-md border px-3 py-1 text-sm ${
                    network === item.id ? 'border-purple-500 bg-purple-500/10' : 'border-white/10 hover:bg-white/5'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>

            <TemplateForm params={selectedTemplate.deployment_params} values={values} onChange={handleChange} />

            <div className="flex flex-wrap items-center gap-3">
              <button
                onClick={handleEstimate}
                disabled={!address || isEstimating}
                className="rounded-md border border-white/10 px-4 py-2 text-sm hover:bg-white/5 disabled:opacity-50"
              >
                {isEstimating ? 'Estimating…' : 'Estimate cost'}
              </button>
              <button
                onClick={handleDeploy}
                disabled={!address || isBusy}
                className="rounded-md bg-purple-600 px-4 py-2 text-sm font-medium hover:bg-purple-500 disabled:opacity-50"
              >
                {isBusy ? `${step}…` : 'Deploy'}
              </button>
              {!address && <span className="text-sm text-white/50">Connect an EVM wallet to estimate or deploy</span>}
            </div>

            {estimateError && <p className="text-sm text-red-400">{estimateError}</p>}
            {estimate && (
              <p className="text-sm text-white/60">
                ~{estimate.gas_estimate.toLocaleString()} gas at {estimate.gas_price_gwei.toFixed(2)} gwei ≈{' '}
                {estimate.deployment_cost_native.toFixed(6)} {estimate.native_token}
              </p>
            )}

            {error && <p className="text-sm text-red-400">{error}</p>}
            {txHash && step !== 'error' && (
              <p className="text-sm text-white/60">
                tx: <span className="font-mono">{txHash}</span> — {step}
              </p>
            )}
            {deployment && (
              <p className="text-sm text-emerald-400">
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
        <h3 className="text-base font-medium">Deployment History</h3>
        <div className="mt-3">
          {accessToken ? (
            <DeploymentHistory deployments={history} />
          ) : (
            <p className="text-white/50">Sign in with your wallet to see your deployment history.</p>
          )}
        </div>
      </div>
    </div>
  )
}
