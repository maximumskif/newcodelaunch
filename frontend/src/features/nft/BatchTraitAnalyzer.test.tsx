import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { BatchAnalysisResult } from '../../lib/nftApi'
import { aiTraitsApi } from '../../lib/nftApi'
import { BatchTraitAnalyzer } from './BatchTraitAnalyzer'

vi.mock('../../lib/nftApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/nftApi')>()
  return {
    ...actual,
    aiTraitsApi: {
      ...actual.aiTraitsApi,
      analyzeBatch: vi.fn(),
    },
  }
})

const result: BatchAnalysisResult = {
  batch_id: 'batch_1',
  total_images: 2,
  results: [
    {
      filename: 'blue.png',
      analysis_id: 'a1',
      timestamp: '2026-01-01T00:00:00Z',
      traits: {
        dominant_color: 'blue',
        color_palette: ['blue'],
        color_scheme: 'cool',
        brightness_level: 'medium',
        saturation_level: 'moderate',
        color_diversity: 1,
        art_style: 'clean',
        complexity_level: 'simple',
        background_type: 'solid',
        aspect_ratio: 'square',
        resolution_category: 'low',
        symmetry: 'symmetric',
        orientation: 'square',
        balance: 'balanced',
        dimensions: '32x32',
        megapixels: 0.001,
        format: 'PNG',
        file_size_kb: 1,
        quality_estimate: 'low',
      },
      suggested_rarity: 'common',
      confidence_scores: { color_analysis: 0.95, composition: 0.8, technical: 0.99, overall: 0.85 },
      ai_error: null,
    },
  ],
  trait_frequency: {},
  rarity_scores: {},
  collection_insights: {
    collection_size: 2,
    unique_traits: {},
    most_common_traits: { dominant_color: { value: 'blue', percentage: 100 } },
    color_distribution: { blue: 2 },
    diversity_score: 0.5,
  },
  processed_at: '2026-01-01T00:00:00Z',
}

beforeEach(() => {
  vi.mocked(aiTraitsApi.analyzeBatch).mockReset()
})

describe('BatchTraitAnalyzer', () => {
  it('the Analyze button is disabled until files are selected, and calls analyzeBatch with them', async () => {
    const user = userEvent.setup()
    vi.mocked(aiTraitsApi.analyzeBatch).mockResolvedValue(result)
    render(<BatchTraitAnalyzer token="tok" />)

    expect(screen.getByRole('button', { name: /^Analyze/ })).toBeDisabled()

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    const files = [new File(['a'], 'blue.png', { type: 'image/png' }), new File(['b'], 'red.png', { type: 'image/png' })]
    await user.upload(fileInput, files)

    const analyzeButton = screen.getByRole('button', { name: 'Analyze 2 images' })
    expect(analyzeButton).toBeEnabled()
    await user.click(analyzeButton)

    await waitFor(() => expect(aiTraitsApi.analyzeBatch).toHaveBeenCalledWith('tok', files))
  })

  it('renders per-image and collection-level results after a successful analysis', async () => {
    const user = userEvent.setup()
    vi.mocked(aiTraitsApi.analyzeBatch).mockResolvedValue(result)
    render(<BatchTraitAnalyzer token="tok" />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(fileInput, [new File(['a'], 'blue.png', { type: 'image/png' })])
    await user.click(screen.getByRole('button', { name: /^Analyze/ }))

    expect(await screen.findByText('blue.png')).toBeInTheDocument()
    expect(screen.getByText('2 images analyzed')).toBeInTheDocument()
    expect(screen.getByText('Diversity score: 0.50')).toBeInTheDocument()
    expect(screen.getByText(/dominant_color: blue/)).toBeInTheDocument()
  })

  it('shows an error message when the request fails', async () => {
    const user = userEvent.setup()
    vi.mocked(aiTraitsApi.analyzeBatch).mockRejectedValue(new Error('AI service unavailable'))
    render(<BatchTraitAnalyzer token="tok" />)

    const fileInput = document.querySelector('input[type="file"]') as HTMLInputElement
    await user.upload(fileInput, [new File(['a'], 'blue.png', { type: 'image/png' })])
    await user.click(screen.getByRole('button', { name: /^Analyze/ }))

    expect(await screen.findByText('AI service unavailable')).toBeInTheDocument()
  })
})
