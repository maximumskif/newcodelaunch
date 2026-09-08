import { useEffect, useMemo, useState } from 'react'

import { Button } from '../../components/ui/Button'
import { Dropzone } from '../../components/ui/Dropzone'
import { IconChevronDown, IconPlus, IconSparkles, IconSpinner, IconTrash } from '../../components/ui/icons'
import { aiTraitsApi, nftApi, uploadUrl, type ImageAnalysis, type NFTLayer, type NFTTrait } from '../../lib/nftApi'
import { RarityBadge } from './ui/RarityBadge'
import { COLOR_HEX } from './ui/colorHex'

interface Props {
  token: string
  layer: NFTLayer
  onTraitAdded: () => void
  onRename: (name: string) => void
  onDelete: () => void
  onMoveUp?: () => void
  onMoveDown?: () => void
}

// Suggested starting rarity_weight per AI-detected tier — common traits should
// show up often, rare ones rarely. Just a starting point; the slider stays editable.
const SUGGESTED_WEIGHT: Record<string, number> = { common: 70, uncommon: 40, rare: 15 }

// Bulk-uploaded traits skip the name/rarity form entirely (see handleFiles) —
// this is the starting weight they get, editable afterward via the same
// click-to-edit flow single-uploaded traits already use.
const DEFAULT_BULK_RARITY_WEIGHT = 50

function nameFromFilename(filename: string): string {
  const withoutExtension = filename.replace(/\.[^/.]+$/, '')
  const spaced = withoutExtension.replace(/[-_]+/g, ' ').trim()
  return spaced || 'Untitled'
}

export function LayerCard({ token, layer, onTraitAdded, onRename, onDelete, onMoveUp, onMoveDown }: Props) {
  const [isFormOpen, setIsFormOpen] = useState(layer.traits.length === 0)
  const [pendingFile, setPendingFile] = useState<File | null>(null)
  const [name, setName] = useState('')
  const [rarity, setRarity] = useState(50)
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const [aiResult, setAiResult] = useState<ImageAnalysis | null>(null)
  const [isAnalyzing, setIsAnalyzing] = useState(false)

  const [bulkProgress, setBulkProgress] = useState<{ done: number; total: number } | null>(null)

  const [isEditingName, setIsEditingName] = useState(false)
  const [nameDraft, setNameDraft] = useState(layer.name)
  useEffect(() => setNameDraft(layer.name), [layer.name])

  const [editingTrait, setEditingTrait] = useState<NFTTrait | null>(null)
  const [editName, setEditName] = useState('')
  const [editRarity, setEditRarity] = useState(50)
  const [isSavingTrait, setIsSavingTrait] = useState(false)
  const [isDeletingTrait, setIsDeletingTrait] = useState(false)

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

  const handleFiles = (files: File[]) => {
    if (files.length <= 1) {
      handleFile(files[0] ?? null)
      return
    }
    void handleBulkUpload(files)
  }

  // Multiple files dropped at once: skip the per-trait name/rarity form —
  // name is derived from the filename, rarity starts at a default — and
  // upload sequentially (not Promise.all) so a slow/failing item shows real
  // progress instead of all-or-nothing, and doesn't hammer the backend with
  // concurrent multipart requests for what's likely a whole layer's worth of
  // traits at once. Fine-tune name/weight afterward with the same
  // click-to-edit flow every trait already gets.
  const handleBulkUpload = async (files: File[]) => {
    setError(null)
    setBulkProgress({ done: 0, total: files.length })
    let failure: string | null = null
    for (const file of files) {
      try {
        await nftApi.addTrait(token, layer.id, nameFromFilename(file.name), DEFAULT_BULK_RARITY_WEIGHT, file)
      } catch (err) {
        failure = err instanceof Error ? err.message : 'Bulk upload failed'
        break
      }
      setBulkProgress((prev) => (prev ? { ...prev, done: prev.done + 1 } : prev))
    }
    setBulkProgress(null)
    if (failure) setError(`${failure} — traits uploaded before this point were kept.`)
    onTraitAdded()
  }

  const commitLayerRename = () => {
    const trimmed = nameDraft.trim()
    if (trimmed && trimmed !== layer.name) onRename(trimmed)
    else setNameDraft(layer.name)
    setIsEditingName(false)
  }

  const startEditTrait = (trait: NFTTrait) => {
    setIsFormOpen(false)
    setError(null)
    setEditingTrait(trait)
    setEditName(trait.name)
    setEditRarity(trait.rarity_weight)
  }

  const handleSaveTraitEdit = async () => {
    if (!editingTrait || !editName.trim()) return
    setIsSavingTrait(true)
    setError(null)
    try {
      await nftApi.updateTrait(token, editingTrait.id, { name: editName.trim(), rarity_weight: editRarity })
      setEditingTrait(null)
      onTraitAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not update trait')
    } finally {
      setIsSavingTrait(false)
    }
  }

  const handleDeleteTrait = async () => {
    if (!editingTrait) return
    setIsDeletingTrait(true)
    setError(null)
    try {
      await nftApi.deleteTrait(token, editingTrait.id)
      setEditingTrait(null)
      onTraitAdded()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not delete trait')
    } finally {
      setIsDeletingTrait(false)
    }
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
      <div className="mb-2 flex items-center justify-between gap-2">
        {isEditingName ? (
          <input
            autoFocus
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={commitLayerRename}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitLayerRename()
              if (e.key === 'Escape') {
                setNameDraft(layer.name)
                setIsEditingName(false)
              }
            }}
            aria-label="Layer name"
            className="min-w-0 flex-1 rounded-md border border-border bg-surface px-1.5 py-0.5 text-sm font-medium text-ink"
          />
        ) : (
          <button
            onClick={() => setIsEditingName(true)}
            title="Click to rename"
            className="truncate text-sm font-medium text-ink hover:underline"
          >
            {layer.name}
          </button>
        )}
        <div className="flex shrink-0 items-center gap-1">
          {(onMoveUp || onMoveDown) && (
            <div className="flex items-center">
              <button
                onClick={onMoveUp}
                disabled={!onMoveUp}
                aria-label="Move layer up"
                title="Move layer up"
                className="rounded p-1 text-ink-faint hover:bg-surface-hover hover:text-ink disabled:opacity-30"
              >
                <IconChevronDown className="h-3.5 w-3.5 rotate-180" />
              </button>
              <button
                onClick={onMoveDown}
                disabled={!onMoveDown}
                aria-label="Move layer down"
                title="Move layer down"
                className="rounded p-1 text-ink-faint hover:bg-surface-hover hover:text-ink disabled:opacity-30"
              >
                <IconChevronDown className="h-3.5 w-3.5" />
              </button>
            </div>
          )}
          <span className="text-xs text-ink-faint">
            {layer.traits.length} trait{layer.traits.length === 1 ? '' : 's'}
          </span>
          {!isFormOpen && (
            <Button
              variant="secondary"
              size="sm"
              onClick={() => {
                setEditingTrait(null)
                setIsFormOpen(true)
              }}
            >
              <IconPlus className="h-3 w-3" /> Add
            </Button>
          )}
          <button
            onClick={onDelete}
            aria-label="Delete layer"
            title="Delete layer"
            className="rounded p-1 text-ink-faint hover:bg-danger/10 hover:text-danger"
          >
            <IconTrash className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      {layer.traits.length > 0 && (
        <div className="mb-2 grid grid-cols-[repeat(auto-fill,minmax(44px,1fr))] gap-1.5">
          {layer.traits.map((trait) => (
            <button
              key={trait.id}
              onClick={() => startEditTrait(trait)}
              title={`${trait.name} · weight ${trait.rarity_weight} · click to edit`}
              className="overflow-hidden rounded-md border border-border bg-canvas text-left transition-shadow duration-150 hover:ring-1 hover:ring-accent-400/40"
            >
              <img src={uploadUrl(trait.image_path)} alt={trait.name} className="aspect-square w-full object-contain" />
              <p className="truncate px-1 py-0.5 text-[9px] text-ink-faint">{trait.name}</p>
            </button>
          ))}
        </div>
      )}

      {bulkProgress && (
        <p className="mb-2 text-xs text-ink-faint">
          Uploading trait {bulkProgress.done + 1} of {bulkProgress.total}…
        </p>
      )}

      {editingTrait && (
        <div className="mb-2 rounded-md border border-accent-400/30 bg-canvas p-2">
          <div className="flex flex-wrap items-center gap-2">
            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-md border border-border bg-canvas">
              <img src={uploadUrl(editingTrait.image_path)} alt="" className="h-full w-full object-contain" />
            </div>
            <input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              placeholder="Trait name"
              aria-label="Edit trait name"
              className="min-w-[7rem] flex-1 rounded-md border border-border bg-surface px-2 py-1 text-sm placeholder:text-ink-faint"
            />
            <div className="flex items-center gap-1.5" title="Rarity weight">
              <input
                type="range"
                min={1}
                max={100}
                value={editRarity}
                onChange={(e) => setEditRarity(Number(e.target.value))}
                aria-label="Edit rarity weight"
                className="w-16 accent-accent-500"
              />
              <span className="w-6 text-right text-xs text-ink-faint">{editRarity}</span>
            </div>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSaveTraitEdit}
              disabled={!editName.trim()}
              isLoading={isSavingTrait}
            >
              Save
            </Button>
            <Button
              variant="danger"
              size="sm"
              onClick={handleDeleteTrait}
              isLoading={isDeletingTrait}
              aria-label="Delete trait"
            >
              <IconTrash className="h-3 w-3" /> Delete
            </Button>
            <button onClick={() => setEditingTrait(null)} className="text-xs text-ink-faint hover:text-ink-muted">
              Cancel
            </button>
          </div>
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
                <Dropzone iconOnly multiple onFiles={handleFiles} />
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
