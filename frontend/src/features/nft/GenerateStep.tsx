import { useEffect, useState } from 'react'

import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconLink, IconSparkles, IconSpinner } from '../../components/ui/icons'
import { ipfsGatewayUrl, maxPossibleCombinations, nftApi, uploadUrl, type NFTCollection, type NFTGeneratedItem } from '../../lib/nftApi'

interface Props {
  token: string
  collection: NFTCollection
}

export function GenerateStep({ token, collection }: Props) {
  const layers = collection.layers ?? []
  const ready = layers.length > 0 && layers.every((layer) => layer.traits.length > 0)
  const maxCombinations = maxPossibleCombinations(layers)

  const [items, setItems] = useState<NFTGeneratedItem[]>([])
  const [isLoadingItems, setIsLoadingItems] = useState(false)
  const [count, setCount] = useState('10')
  const [isGenerating, setIsGenerating] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [publishingId, setPublishingId] = useState<string | null>(null)

  const refreshItems = async () => {
    setIsLoadingItems(true)
    try {
      const { items: fetched } = await nftApi.listItems(token, collection.id)
      setItems(fetched)
    } finally {
      setIsLoadingItems(false)
    }
  }

  useEffect(() => {
    void refreshItems()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection.id])

  const handleGenerate = async () => {
    setError(null)
    setIsGenerating(true)
    try {
      await nftApi.generate(token, collection.id, Number(count) || 0)
      await refreshItems()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Generation failed')
    } finally {
      setIsGenerating(false)
    }
  }

  const handlePublish = async (itemId: string) => {
    setPublishingId(itemId)
    try {
      const { item } = await nftApi.publishItem(token, itemId)
      setItems((prev) => prev.map((existing) => (existing.id === item.id ? item : existing)))
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Publish failed')
    } finally {
      setPublishingId(null)
    }
  }

  return (
    <Card>
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
            max={Math.min(200, maxCombinations || 200)}
            value={count}
            onChange={(e) => setCount(e.target.value)}
            className="w-24 rounded-md border border-border bg-surface px-3 py-1.5 text-sm"
          />
          <Button variant="primary" onClick={handleGenerate} disabled={!ready} isLoading={isGenerating}>
            Generate
          </Button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-danger">{error}</p>}

      <div className="mt-5">
        {isLoadingItems && <p className="text-sm text-ink-faint">Loading items…</p>}
        {!isLoadingItems && items.length === 0 && <EmptyState title="Nothing generated yet." />}
        {items.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map((item) => {
              const isPublished = Boolean(item.ipfs_image_hash)
              return (
                <div key={item.id} className="overflow-hidden rounded-md border border-border bg-canvas">
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
                          className="truncate rounded bg-surface-hover px-1.5 py-0.5 text-[10px] text-ink-muted"
                          title={`${attribute.trait_type}: ${attribute.value}`}
                        >
                          {attribute.value}
                        </span>
                      ))}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>
    </Card>
  )
}
