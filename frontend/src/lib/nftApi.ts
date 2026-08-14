import { API_BASE_URL, request, requestMultipart } from './http'

export type NFTCollectionStatus = 'draft' | 'generated' | 'published'

export interface NFTTrait {
  id: string
  name: string
  rarity_weight: number
  image_path: string
}

export interface NFTLayer {
  id: string
  name: string
  order_index: number
  traits: NFTTrait[]
}

export interface NFTCollection {
  id: string
  name: string
  description: string
  collection_size: number
  image_size: number
  status: NFTCollectionStatus
  created_at: string
  layers?: NFTLayer[]
}

export interface NFTGeneratedItem {
  id: string
  token_index: number
  attributes: { trait_type: string; value: string }[]
  image_path: string
  ipfs_image_hash: string | null
  ipfs_metadata_hash: string | null
}

export function uploadUrl(relativePath: string): string {
  return `${API_BASE_URL}/nft/uploads/${relativePath.split('/').map(encodeURIComponent).join('/')}`
}

export function ipfsGatewayUrl(hash: string): string {
  return `https://gateway.pinata.cloud/ipfs/${hash}`
}

export function maxPossibleCombinations(layers: NFTLayer[]): number {
  if (layers.length === 0 || layers.some((layer) => layer.traits.length === 0)) return 0
  return layers.reduce((total, layer) => total * layer.traits.length, 1)
}

export const nftApi = {
  createCollection: (
    token: string,
    payload: { name: string; description: string; collection_size: number; image_size: number; project_id?: string },
  ) => request<{ collection: NFTCollection }>('/nft/collections', { method: 'POST', body: JSON.stringify(payload) }, token),

  listCollections: (token: string) => request<{ collections: NFTCollection[] }>('/nft/collections', {}, token),

  getCollection: (token: string, collectionId: string) =>
    request<{ collection: NFTCollection }>(`/nft/collections/${collectionId}`, {}, token),

  addLayer: (token: string, collectionId: string, payload: { name: string; order_index: number }) =>
    request<{ layer: NFTLayer }>(
      `/nft/collections/${collectionId}/layers`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  addTrait: (token: string, layerId: string, name: string, rarityWeight: number, image: File) => {
    const formData = new FormData()
    formData.set('name', name)
    formData.set('rarity_weight', String(rarityWeight))
    formData.set('image', image)
    return requestMultipart<{ trait: NFTTrait }>(`/nft/layers/${layerId}/traits`, formData, token)
  },

  generate: (token: string, collectionId: string, count: number) =>
    request<{ items: NFTGeneratedItem[] }>(
      `/nft/collections/${collectionId}/generate`,
      { method: 'POST', body: JSON.stringify({ count }) },
      token,
    ),

  listItems: (token: string, collectionId: string) =>
    request<{ items: NFTGeneratedItem[] }>(`/nft/collections/${collectionId}/items`, {}, token),

  publishItem: (token: string, itemId: string) =>
    request<{ item: NFTGeneratedItem }>(`/nft/items/${itemId}/publish`, { method: 'POST' }, token),

  getItemMetadata: (token: string, itemId: string) =>
    request<{ published: boolean; metadata: Record<string, unknown>; metadata_ipfs_hash?: string }>(
      `/nft/items/${itemId}/metadata`,
      {},
      token,
    ),
}

export interface ImageTraits {
  dominant_color: string
  color_palette: string[]
  color_scheme: string
  brightness_level: string
  saturation_level: string
  color_diversity: number
  art_style: string
  complexity_level: string
  background_type: string
  aspect_ratio: string
  resolution_category: string
  symmetry: string
  orientation: string
  balance: string
  dimensions: string
  megapixels: number
  format: string
  file_size_kb: number
  quality_estimate: string
  ai_detected_objects?: string[]
  ai_style_classification?: string
  ai_mood_detection?: string
  ai_rarity_suggestion?: string
}

export interface ImageAnalysis {
  filename: string
  analysis_id: string
  timestamp: string
  traits: ImageTraits
  suggested_rarity: 'common' | 'uncommon' | 'rare'
  confidence_scores: { color_analysis: number; composition: number; technical: number; overall: number }
  ai_error: string | null
}

// Batch analysis (POST /nft/analyze/batch) exists on the backend but has no
// frontend caller — AI trait analysis lives inline in the trait-upload step
// (LayerCard) as a per-trait rarity suggestion, not a standalone bulk tool.
export const aiTraitsApi = {
  analyzeSingle: (token: string, image: File) => {
    const formData = new FormData()
    formData.set('image', image)
    return requestMultipart<ImageAnalysis>('/nft/analyze', formData, token)
  },
}
