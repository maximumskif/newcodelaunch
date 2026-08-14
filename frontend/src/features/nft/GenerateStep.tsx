import { useEffect, useState } from 'react'

import { ipfsGatewayUrl, maxPossibleCombinations, nftApi, uploadUrl, type NFTCollection, type NFTGeneratedItem } from '../../lib/nftApi'
import { IconLink, IconSparkles, IconSpinner } from './ui/icons'

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
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="flex items-center gap-1.5 text-lg font-medium">
            <IconSparkles className="h-4 w-4 text-purple-400" />
            Generate & Publish
          </h2>
          <p className="mt-1 text-sm text-white/60">
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
            className="w-24 rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm"
          />
          <button
            onClick={handleGenerate}
            disabled={!ready || isGenerating}
            className="flex items-center gap-1.5 rounded-md bg-gradient-to-r from-purple-600 to-violet-600 px-4 py-1.5 text-sm font-medium hover:from-purple-500 hover:to-violet-500 disabled:opacity-40"
          >
            {isGenerating && <IconSpinner className="h-3.5 w-3.5" />}
            Generate
          </button>
        </div>
      </div>

      {error && <p className="mt-3 text-sm text-red-400">{error}</p>}

      <div className="mt-5">
        {isLoadingItems && <p className="text-sm text-white/40">Loading items…</p>}
        {!isLoadingItems && items.length === 0 && (
          <p className="rounded-xl border border-dashed border-white/10 py-8 text-center text-sm text-white/40">
            Nothing generated yet.
          </p>
        )}
        {items.length > 0 && (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
            {items.map((item) => {
              const isPublished = Boolean(item.ipfs_image_hash)
              return (
                <div key={item.id} className="overflow-hidden rounded-xl border border-white/10 bg-black/20">
                  <img src={uploadUrl(item.image_path)} alt={`#${item.token_index}`} className="aspect-square w-full object-cover" />
                  <div className="p-3">
                    <div className="flex items-center justify-between">
                      <p className="text-sm font-medium">#{item.token_index}</p>
                      {isPublished ? (
                        <a
                          href={ipfsGatewayUrl(item.ipfs_image_hash!)}
                          target="_blank"
                          rel="noreferrer"
                          className="flex items-center gap-1 text-xs text-emerald-400 hover:underline"
                        >
                          <IconLink className="h-3 w-3" /> IPFS
                        </a>
                      ) : (
                        <button
                          onClick={() => handlePublish(item.id)}
                          disabled={publishingId === item.id}
                          className="flex items-center gap-1 rounded border border-white/10 px-2 py-0.5 text-xs hover:bg-white/5 disabled:opacity-40"
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
                          className="truncate rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-white/50"
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
    </div>
  )
}
