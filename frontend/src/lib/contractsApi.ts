import { request } from './http'

export interface DeploymentParam {
  name: string
  type: string
  required: boolean
  default?: unknown
  description?: string
}

export interface ContractTemplateSummary {
  id: string
  name: string
  type: 'erc20' | 'erc721'
  description: string
  deployment_params: DeploymentParam[]
  features: string[]
  gas_estimate: number
}

export interface ContractTemplateDetail extends ContractTemplateSummary {
  solidity_code: string
}

export interface CompiledContract {
  abi: unknown[]
  bytecode: string
  contract_name: string
}

export interface DeploymentEstimate {
  gas_estimate: number
  gas_price_gwei: number
  deployment_cost_native: number
  native_token: string
  network: string
}

export interface ContractDeployment {
  id: string
  template_id: string
  template_name: string
  contract_type: string
  network: string
  contract_address: string
  transaction_hash: string
  deployer_address: string
  parameters: Record<string, unknown>
  gas_used: number | null
  deployment_cost_native: number | null
  explorer_url: string | null
  created_at: string
}

export interface CreateDeploymentPayload {
  template_id: string
  network: string
  contract_address: string
  transaction_hash: string
  deployer_address: string
  parameters: Record<string, unknown>
}

export const contractsApi = {
  listTemplates: (type?: 'erc20' | 'erc721') =>
    request<{ templates: ContractTemplateSummary[] }>(`/contracts/templates${type ? `?type=${type}` : ''}`),

  getTemplate: (templateId: string) =>
    request<{ template: ContractTemplateDetail }>(`/contracts/templates/${templateId}`),

  compile: (templateId: string, parameters: Record<string, unknown>) =>
    request<CompiledContract>('/contracts/compile', {
      method: 'POST',
      body: JSON.stringify({ template_id: templateId, parameters }),
    }),

  estimate: (templateId: string, parameters: Record<string, unknown>, network: string, deployerAddress: string) =>
    request<DeploymentEstimate>('/contracts/estimate', {
      method: 'POST',
      body: JSON.stringify({ template_id: templateId, parameters, network, deployer_address: deployerAddress }),
    }),

  createDeployment: (token: string, payload: CreateDeploymentPayload) =>
    request<{ deployment: ContractDeployment }>(
      '/contracts/deployments',
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  listDeployments: (token: string) =>
    request<{ deployments: ContractDeployment[] }>('/contracts/deployments', {}, token),

  getDeployment: (contractAddress: string) =>
    request<{ deployment: ContractDeployment; live_status: Record<string, unknown> | null }>(
      `/contracts/deployments/${contractAddress}`,
    ),
}
