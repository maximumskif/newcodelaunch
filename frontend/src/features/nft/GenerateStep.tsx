import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'

import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconChevronDown, IconCode, IconLink, IconSparkles, IconSpinner } from '../../components/ui/icons'
import { InlineError } from '../../components/ui/InlineError'
import {
  ipfsGatewayUrl,
  maxPossibleCombinations,
  nftApi,
  uploadUrl,
  type NFTCollection,
  type NFTGeneratedItem,
  type NFTGenerationJob,
} from '../../lib/nftApi'
import { RarityDistribution } from './RarityDistribution'

interface Props {
  token: string
  collection: NFTCollection
  projectId?: string | null
}

// Mirrors nft_generation.py's MAX_ITEMS_PER_GENERATE_CALL — generation now
// runs as a background job (nft_generation_jobs.py), so this is a sanity
// ceiling against a runaway request, not "how much fits in one blocking
// call" the way it used to be when this was 200.
const MAX_GENERATE_COUNT = 10_000

interface MetadataPreview {
  published: boolean
  metadata: Record<string, unknown>
}

// Real browser download, not an upload/share action — just saves the exact
// JSON the preview is already showing so it can be reviewed outside the app
// before (or instead of) ever publishing to IPFS.
function downloadJson(filename: string, data: unknown) {
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = filename
  link.click()
  URL.revokeObjectURL(url)
}

export function GenerateStep({ token, collection, projectId }: Props) {
  const layers = collection.layers ?? []
  const ready = layers.length > 0 && layers.every((layer) => layer.traits.length > 0)
  const maxCombinations = maxPossibleCombinations(layers)

  const [items, setItems] = useState<NFTGeneratedItem[]>([])
  const [isLoadingItems, setIsLoadingItems] = useState(false)
  const [count, setCount] = useState('10')
  const [isGenerating, setIsGenerating] = useState(false)
  const [generationJob, setGenerationJob] = useState<NFTGenerationJob | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [publishingId, setPublishingId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)
  const [previewLoadingId, setPreviewLoadingId] = useState<string | null>(null)
  const [previews, setPreviews] = useState<Record<string, MetadataPreview>>({})
  const [showDistribution, setShowDistribution] = useState(false)

  // Same reasoning as NFTGeneratorPage.tsx's refreshCollection: a ref
  // tracking the latest *requested* collection id, so an out-of-order
  // response (e.g. this component re-rendering for a different collection
  // — collection.id changing — before the previous one's listItems() call
  // resolves) can't overwrite `items` with the wrong collection's data.
  const latestItemsRequestRef = useRef<string | null>(null)

  const refreshItems = async () => {
    const requestId = collection.id
    latestItemsRequestRef.current = requestId
    setIsLoadingItems(true)
    try {
      const { items: fetched } = await nftApi.listItems(token, requestId)
      if (latestItemsRequestRef.current !== requestId) return
      setItems(fetched)
    } finally {
      if (latestItemsRequestRef.current === requestId) setIsLoadingItems(false)
    }
  }

  useEffect(() => {
    void refreshItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection.id])

  // Guards the poll loop below the same way latestItemsRequestRef guards
  // refreshItems: if the user starts a second generate (or this component
  // unmounts — a project switch, navigating away) while an earlier job is
  // still being polled, the stale loop must stop touching state rather than
  // racing the newer one or updating after unmount.
  const latestJobIdRef = useRef<string | null>(null)

  useEffect(() => {
    return () => {
      latestJobIdRef.current = null
    }
  }, [])

  const handleGenerate = async () => {
    setError(null)
    setIsGenerating(true)
    setGenerationJob(null)
    try {
      const { job } = await nftApi.generate(token, collection.id, Number(count) || 0)
      latestJobIdRef.current = job.id
      setGenerationJob(job)
      await pollJob(job)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
      setIsGenerating(false)
    }
  }

  // Generation runs as a background job (nft_generation_jobs.py) rather
  // than blocking the initial POST — this polls until it's done or failed,
  // updating live progress along the way instead of leaving the user
  // staring at a spinner with no feedback for however long a large
  // collection takes to composite.
  const pollJob = async (job: NFTGenerationJob) => {
    if (job.status === 'done' || job.status === 'failed') {
      if (latestJobIdRef.current !== job.id) return
      setGenerationJob(job)
      setIsGenerating(false)
      if (job.status === 'failed') {
        setError(job.error ?? 'Generation failed')
      } else {
        await refreshItems()
      }
      return
    }

    await new Promise((resolve) => setTimeout(resolve, 700))
    if (latestJobIdRef.current !== job.id) return

    try {
      const { job: updated } = await nftApi.getGenerationJob(token, job.id)
      if (latestJobIdRef.current !== job.id) return
      setGenerationJob(updated)
      await pollJob(updated)
    } catch (err) {
      if (latestJobIdRef.current !== job.id) return
      setError(err instanceof Error ? err.message : 'Lost track of the generation job')
      setIsGenerating(false)
    }
  }

  const refreshPreview = async (itemId: string) => {
    setPreviewLoadingId(itemId)
    try {
      const result = await nftApi.getItemMetadata(token, itemId)
      setPreviews((prev) => ({ ...prev, [itemId]: result }))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not load metadata preview')
    } finally {
      setPreviewLoadingId(null)
    }
  }

  const handlePublish = async (itemId: string) => {
    setPublishingId(itemId)
    try {
      const { item } = await nftApi.publishItem(token, itemId)
      setItems((prev) => prev.map((existing) => (existing.id === item.id ? item : existing)))
      // The cached preview (if any) showed the unpublished placeholder —
      // drop it so a later "Preview metadata" click refetches the real,
      // now-published content instead of the stale image:null version.
      setPreviews((prev) => {
        if (!(itemId in prev)) return prev
        const next = { ...prev }
        delete next[itemId]
        return next
      })
      if (expandedId === itemId) await refreshPreview(itemId)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed')
    } finally {
      setPublishingId(null)
    }
  }

  const handleTogglePreview = async (itemId: string) => {
    if (expandedId === itemId) {
      setExpandedId(null)
      return
    }
    setExpandedId(itemId)
    if (previews[itemId]) return
    await refreshPreview(itemId)
  }

  return (
    <Card rounded="xl">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-medium text-ink">
            <IconSparkles className="h-4 w-4 text-accent-400" />
            Generate & Publish
          </h2>
          <p className="mt-1 text-sm text-ink-muted">
            {ready
              ? `Up to ${maxCombinations.toLocaleString()} unique combinations possible from your current traits.`
              : 'Add at least one trait to every layer before generating.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="number"
            min={1}
            max={Math.min(MAX_GENERATE_COUNT, maxCombinations || MAX_GENERATE_COUNT)}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            aria-label="Number of items to generate"
            className="w-24 rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
          />
          <Button variant="primary" onClick={handleGenerate} disabled={!ready} isLoading={isGenerating}>
            Generate
          </Button>
        </div>
      </div>

      {isGenerating && generationJob && (
        // aria-live="polite" (not "alert" — this isn't urgent/interruptive,
        // and the element stays mounted with its text updating on each
        // 700ms poll, exactly the case aria-live is for): without it, a
        // screen reader user got no feedback at all for however long a
        // large batch takes, unlike a sighted user watching the number
        // climb in real time.
        <p aria-live="polite" className="mt-3 flex items-center gap-1.5 text-sm text-ink-muted">
          <IconSpinner className="h-3.5 w-3.5" />
          Generating {generationJob.items_generated} / {generationJob.requested_count}…
        </p>
      )}

      {error && <InlineError className="mt-3 text-sm text-danger">{error}</InlineError>}

      {items.length > 0 && (
        <div className="mt-4">
          <button
            onClick={() => setShowDistribution((v) => !v)}
            className="flex items-center gap-1 text-xs text-ink-faint hover:text-ink"
          >
            <IconChevronDown className={`h-3 w-3 transition-transform duration-150 ${showDistribution ? '' : '-rotate-90'}`} />
            {showDistribution ? 'Hide' : 'Show'} rarity distribution
          </button>
          {showDistribution && (
            <div className="mt-2">
              <RarityDistribution items={items} />
            </div>
          )}
        </div>
      )}

      <div className="mt-5">
        {isLoadingItems && <p className="text-sm text-ink-faint">Loading items…</p>}
        {!isLoadingItems && items.length === 0 && <EmptyState title="Nothing generated yet." />}
        {items.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map((item) => {
              const isPublished = Boolean(item.ipfs_image_hash)
              return (
                <div
                  key={item.id}
                  className="overflow-hidden rounded-xl border border-border bg-canvas transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-border-strong hover:shadow-elevated"
                >
                  <img src={uploadUrl(item.image_path)} alt={`#${item.token_index}`} className="aspect-square w-full object-cover" />
                  <div className="p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium text-ink">#{item.token_index}</p>
                      {isPublished ? (
                        <a
                          href={ipfsGatewayUrl(item.ipfs_image_hash!)}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-xs text-success hover:underline"
                        >
                          <IconLink className="h-3 w-3" /> IPFS
                        </a>
                      ) : (
                        <button
                          onClick={() => handlePublish(item.id)}
                          disabled={publishingId === item.id}
                          className="flex items-center gap-1 rounded border border-border px-2 py-0.5 text-xs text-ink-muted hover:bg-surface-hover disabled:opacity-40"
                        >
                          {publishingId === item.id ? <IconSpinner className="h-3 w-3" /> : <IconLink className="h-3 w-3" />}
                          Publish
                        </button>
                      )}
                    </div>
                    <div className="mt-1.5 flex flex-wrap gap-1">
                      {item.attributes.slice(0, 3).map((attribute) => (
                        <span
                          key={attribute.trait_type}
                          className="truncate rounded-full bg-surface-raised px-2 py-0.5 text-[10px] text-ink-muted"
                          title={`${attribute.trait_type}: ${attribute.value}`}
                        >
                          {attribute.value}
                        </span>
                      ))}
                    </div>

                    <button
                      onClick={() => void handleTogglePreview(item.id)}
                      className="mt-2 flex items-center gap-1 text-[11px] text-ink-faint hover:text-ink"
                    >
                      {previewLoadingId === item.id ? (
                        <IconSpinner className="h-3 w-3" />
                      ) : (
                        <IconCode className="h-3 w-3" />
                      )}
                      {expandedId === item.id ? 'Hide metadata' : 'Preview metadata'}
                    </button>

                    {expandedId === item.id && previews[item.id] && (
                      <div className="mt-2 space-y-1.5">
                        <p className="text-[10px] text-ink-faint">
                          {previews[item.id].published
                            ? 'Real content pinned to IPFS.'
                            : "Preview only — image and created_at are assigned when you publish."}
                        </p>
                        <pre className="max-h-40 overflow-auto rounded bg-surface-hover p-2 text-[10px] text-ink-muted">
                          {JSON.stringify(previews[item.id].metadata, null, 2)}
                        </pre>
                        <button
                          onClick={() => downloadJson(`${collection.name}-${item.token_index}-metadata.json`, previews[item.id].metadata)}
                          className="text-[11px] text-accent-400 hover:underline"
                        >
                          Download JSON
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )
            })}
          </div>
        )}

        {items.some((item) => item.ipfs_image_hash) && (
          <div className="mt-5 flex items-center justify-between rounded-md border border-border bg-canvas p-3">
            <p className="text-sm text-ink-muted">Ready to sell this collection as a real Solana mint?</p>
            <Link to={`/mint?collection=${collection.id}${projectId ? `&project=${projectId}` : ''}`}>
              <Button variant="secondary" size="sm">
                Launch Mint Site
              </Button>
            </Link>
          </div>
        )}
      </div>
    </Card>
  )
}
