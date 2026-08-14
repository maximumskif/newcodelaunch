import type { ContractDeployment } from './contractsApi'
import type { NFTCollection } from './nftApi'
import { request } from './http'

export type ProjectType = 'token' | 'nft_collection' | 'contract'
export type ProjectStatus = 'draft' | 'active' | 'archived'

export interface Project {
  id: string
  name: string
  project_type: ProjectType
  chain: string
  network: string | null
  status: ProjectStatus
  draft_data: Record<string, unknown>
  contract_deployment: ContractDeployment | null
  nft_collection: NFTCollection | null
  created_at: string
  updated_at: string
}

export interface CreateProjectPayload {
  name: string
  project_type: ProjectType
  chain: string
  network?: string
  draft_data?: Record<string, unknown>
}

export interface UpdateProjectPayload {
  name?: string
  draft_data?: Record<string, unknown>
  network?: string
  status?: ProjectStatus
}

export const projectsApi = {
  create: (token: string, payload: CreateProjectPayload) =>
    request<{ project: Project }>('/projects', { method: 'POST', body: JSON.stringify(payload) }, token),

  list: (token: string, status?: ProjectStatus) =>
    request<{ projects: Project[] }>(`/projects${status ? `?status=${status}` : ''}`, {}, token),

  get: (token: string, projectId: string) => request<{ project: Project }>(`/projects/${projectId}`, {}, token),

  update: (token: string, projectId: string, payload: UpdateProjectPayload) =>
    request<{ project: Project }>(`/projects/${projectId}`, { method: 'PATCH', body: JSON.stringify(payload) }, token),

  remove: (token: string, projectId: string) =>
    request<void>(`/projects/${projectId}`, { method: 'DELETE' }, token),
}
