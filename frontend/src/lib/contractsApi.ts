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
  nft_collection_id: string | null
  parameters: Record<string, unknown>
  gas_used: number | null
  deployment_cost_native: number | null
  explorer_url: string | null
  // Block-explorer source verification — see VerifySource.tsx.
  verification_status: 'unverified' | 'pending' | 'verified' | 'failed'
  verification_message: string | null
  created_at: string
}

export interface CreateDeploymentPayload {
  template_id: string
  network: string
  contract_address: string
  transaction_hash: string
  deployer_address: string
  parameters: Record<string, unknown>
  project_id?: string
  // Set when an ERC-721 is deployed from an NFT Generator collection.
  nft_collection_id?: string
}

// The DEX a network supports for adding liquidity (backend services/liquidity.py).
export interface Dex {
  name: string
  router: `0x${string}`
  factory: `0x${string}`
  wrapped_native: `0x${string}`
}

// One add-liquidity transaction, as read back from the chain. Amounts are
// base units (strings — uint256).
export interface LiquidityProvision {
  id: string
  deployment_id: string
  network: string
  dex_name: string
  pair_address: string
  provider_address: string
  transaction_hash: string
  token_amount: string
  native_amount: string
  created_at: string
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

  // Submit the deployment's source to its network's block explorer, then
  // poll refreshVerification until the status leaves 'pending'.
  verifySource: (token: string, deploymentId: string) =>
    request<{ deployment: ContractDeployment }>(`/contracts/deployments/${deploymentId}/verify`, { method: 'POST' }, token),

  refreshVerification: (token: string, deploymentId: string) =>
    request<{ deployment: ContractDeployment }>(`/contracts/deployments/${deploymentId}/verification`, {}, token),

  listDeployments: (token: string) =>
    request<{ deployments: ContractDeployment[] }>('/contracts/deployments', {}, token),

  listDexes: () => request<{ dexes: Record<string, Dex> }>('/contracts/dexes'),

  listLiquidity: (token: string, deploymentId: string) =>
    request<{ provisions: LiquidityProvision[] }>(`/contracts/deployments/${deploymentId}/liquidity`, {}, token),

  recordLiquidity: (token: string, deploymentId: string, transactionHash: string) =>
    request<{ provision: LiquidityProvision }>(
      `/contracts/deployments/${deploymentId}/liquidity`,
      { method: 'POST', body: JSON.stringify({ transaction_hash: transactionHash }) },
      token,
    ),

  getDeployment: (contractAddress: string) =>
    request<{ deployment: ContractDeployment; live_status: Record<string, unknown> | null }>(
      `/contracts/deployments/${contractAddress}`,
    ),
}
