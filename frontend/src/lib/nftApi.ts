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

  deleteCollection: (token: string, collectionId: string) =>
    request<void>(`/nft/collections/${collectionId}`, { method: 'DELETE' }, token),

  addLayer: (token: string, collectionId: string, payload: { name: string; order_index: number }) =>
    request<{ layer: NFTLayer }>(
      `/nft/collections/${collectionId}/layers`,
      { method: 'POST', body: JSON.stringify(payload) },
      token,
    ),

  reorderLayers: (token: string, collectionId: string, layerIds: string[]) =>
    request<{ layers: NFTLayer[] }>(
      `/nft/collections/${collectionId}/layers/reorder`,
      { method: 'POST', body: JSON.stringify({ layer_ids: layerIds }) },
      token,
    ),

  updateLayer: (token: string, layerId: string, payload: { name: string }) =>
    request<{ layer: NFTLayer }>(`/nft/layers/${layerId}`, { method: 'PATCH', body: JSON.stringify(payload) }, token),

  deleteLayer: (token: string, layerId: string) =>
    request<void>(`/nft/layers/${layerId}`, { method: 'DELETE' }, token),

  addTrait: (token: string, layerId: string, name: string, rarityWeight: number, image: File) => {
    const formData = new FormData()
    formData.set('name', name)
    formData.set('rarity_weight', String(rarityWeight))
    formData.set('image', image)
    return requestMultipart<{ trait: NFTTrait }>(`/nft/layers/${layerId}/traits`, formData, token)
  },

  updateTrait: (token: string, traitId: string, payload: { name?: string; rarity_weight?: number }) =>
    request<{ trait: NFTTrait }>(`/nft/traits/${traitId}`, { method: 'PATCH', body: JSON.stringify(payload) }, token),

  deleteTrait: (token: string, traitId: string) =>
    request<void>(`/nft/traits/${traitId}`, { method: 'DELETE' }, token),

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

export interface BatchAnalysisResult {
  batch_id: string
  total_images: number
  results: ImageAnalysis[]
  trait_frequency: Record<string, Record<string, number>>
  rarity_scores: Record<string, { score: number; percentile: number; tier: string }>
  collection_insights: {
    collection_size: number
    unique_traits: Record<string, number>
    most_common_traits: Record<string, { value: string; percentage: number }>
    color_distribution: Record<string, number>
    diversity_score: number
  }
  processed_at: string
}

export const aiTraitsApi = {
  analyzeSingle: (token: string, image: File) => {
    const formData = new FormData()
    formData.set('image', image)
    return requestMultipart<ImageAnalysis>('/nft/analyze', formData, token)
  },

  // Bulk pre-upload planning tool, distinct from analyzeSingle's inline
  // per-trait suggestion in LayerCard — analyze a whole batch of candidate
  // trait images together (real CV analysis for every image, plus a real
  // AI-vision pass per image when OPENAI_API_KEY is set) to see the
  // resulting rarity/diversity spread across the batch before committing to
  // which ones to actually upload and at what weights.
  analyzeBatch: (token: string, images: File[]) => {
    const formData = new FormData()
    images.forEach((image) => formData.append('images', image))
    return requestMultipart<BatchAnalysisResult>('/nft/analyze/batch', formData, token)
  },
}
