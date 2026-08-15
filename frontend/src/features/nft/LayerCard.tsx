import { useEffect, useMemo, useState } from 'react'

import { Button } from '../../components/ui/Button'
import { Dropzone } from '../../components/ui/Dropzone'
import { IconPlus, IconSparkles, IconSpinner } from '../../components/ui/icons'
import { aiTraitsApi, nftApi, uploadUrl, type ImageAnalysis, type NFTLayer } from '../../lib/nftApi'
import { RarityBadge } from './ui/RarityBadge'
import { COLOR_HEX } from './ui/colorHex'

interface Props {
  token: string
  layer: NFTLayer
  onTraitAdded: () => void
}

// Suggested starting rarity_weight per AI-detected tier — common traits should
// show up often, rare ones rarely. Just a starting point; the slider stays editable.
const SUGGESTED_WEIGHT: Record<string, number> = { common: 70, uncommon: 40, rare: 15 }

export function LayerCard({ token, layer, onTraitAdded }: Props) {
  const [isFormOpen, setIsFormOpen] = useState(layer.traits.length === 0)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [rarity, setRarity] = useState(50)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [aiResult, setAiResult] = useState<ImageAnalysis | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  const previewUrl = useMemo(() => (pendingFile ? URL.createObjectURL(pendingFile) : null), [pendingFile])
  useEffect(() => () => { if (previewUrl) URL.revokeObjectURL(previewUrl) }, [previewUrl])

  const resetForm = () => {
    setPendingFile(null)
    setName('')
    setRarity(50)
    setAiResult(null)
  }

  const handleFile = (file: File | null) => {
    setPendingFile(file)
    setAiResult(null)
  }

  const handleAiSuggest = async () => {
    if (!pendingFile) return
    setIsAnalyzing(true)
    setError(null)
    try {
      const result = await aiTraitsApi.analyzeSingle(token, pendingFile)
      setAiResult(result)
      setRarity(SUGGESTED_WEIGHT[result.suggested_rarity] ?? 50)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'AI analysis failed')
    } finally {
      setIsAnalyzing(false)
    }
  }

  const handleSubmit = async () => {
    if (!pendingFile || !name.trim()) {
      setError('Pick an image and give the trait a name')
      return
    }
    setError(null)
    setIsSubmitting(true)
    try {
      await nftApi.addTrait(token, layer.id, name.trim(), rarity, pendingFile)
      resetForm()
      setIsFormOpen(false)
      onTraitAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not upload trait')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-medium text-ink">{layer.name}</h3>
        <div className="flex items-center gap-2">
          <span className="text-xs text-ink-faint">
            {layer.traits.length} trait{layer.traits.length === 1 ? '' : 's'}
          </span>
          {!isFormOpen && (
            <Button variant="secondary" size="sm" onClick={() => setIsFormOpen(true)}>
              <IconPlus className="h-3 w-3" /> Add
            </Button>
          )}
        </div>
      </div>

      {layer.traits.length > 0 && (
        <div className="mb-2 grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1.5">
          {layer.traits.map((trait) => (
            <div key={trait.id} className="overflow-hidden rounded-md border border-border bg-canvas" title={`${trait.name} · weight ${trait.rarity_weight}`}>
              <img src={uploadUrl(trait.image_path)} alt={trait.name} className="aspect-square w-full object-contain" />
              <p className="truncate px-1 py-0.5 text-[9px] text-ink-faint">{trait.name}</p>
            </div>
          ))}
        </div>
      )}

      {isFormOpen && (
        <div className="rounded-md border border-border bg-canvas p-2">
          <div className="flex flex-wrap items-center gap-2">
            {previewUrl ? (
              <div
                onClick={() => handleFile(null)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' || e.key === ' ') {
                    e.preventDefault()
                    handleFile(null)
                  }
                }}
                role="button"
                tabIndex={0}
                aria-label="Remove selected image"
                className="flex h-9 w-9 shrink-0 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-border bg-canvas"
                title="Click to remove"
              >
                <img src={previewUrl} alt="" className="h-full w-full object-contain" />
              </div>
            ) : (
              <div className="h-9 w-9 shrink-0">
                <Dropzone iconOnly onFiles={(files) => handleFile(files[0] ?? null)} />
              </div>
            )}

            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Trait name"
              aria-label="Trait name"
              className="min-w-[7rem] flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm placeholder:text-ink-faint"
            />

            <div className="flex items-center gap-1.5" title="Rarity weight">
              <input
                type="range"
                min={1}
                max={100}
                value={rarity}
                onChange={(e) => setRarity(Number(e.target.value))}
                aria-label="Rarity weight"
                className="w-16 accent-accent-500"
              />
              <span className="w-6 text-right text-xs text-ink-faint">{rarity}</span>
            </div>

            <button
              onClick={handleAiSuggest}
              disabled={!pendingFile || isAnalyzing}
              title="Suggest rarity from AI image analysis"
              className="flex items-center gap-1 rounded-md border border-accent-500/30 px-2 py-1 text-xs text-accent-300 hover:bg-accent-500/10 disabled:opacity-40"
            >
              {isAnalyzing ? <IconSpinner className="h-3 w-3" /> : <IconSparkles className="h-3 w-3" />}
              AI
            </button>

            <Button variant="primary" size="sm" onClick={handleSubmit} disabled={!pendingFile || !name.trim()} isLoading={isSubmitting}>
              Add
            </Button>

            {layer.traits.length > 0 && (
              <button
                onClick={() => {
                  resetForm()
                  setIsFormOpen(false)
                }}
                className="text-xs text-ink-faint hover:text-ink-muted"
              >
                Cancel
              </button>
            )}
          </div>

          {aiResult && (
            <div className="mt-1.5 flex flex-wrap items-center gap-2 border-t border-border pt-1.5 text-xs">
              <RarityBadge tier={aiResult.suggested_rarity} />
              <span
                className="h-3 w-3 rounded-full border border-border-strong"
                style={{ backgroundColor: COLOR_HEX[aiResult.traits.dominant_color] ?? COLOR_HEX.unknown }}
              />
              <span className="capitalize text-ink-faint">{aiResult.traits.art_style}</span>
              {aiResult.traits.ai_style_classification && (
                <span className="text-ink-faint">· {aiResult.traits.ai_style_classification}</span>
              )}
            </div>
          )}
        </div>
      )}
      {error && <p className="mt-1.5 text-xs text-danger">{error}</p>}
    </div>
  )
}
