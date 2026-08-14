import { useState } from 'react'

import { nftApi, type NFTCollection } from '../../lib/nftApi'
import { IconLayers, IconPlus, IconSpinner } from './ui/icons'

interface Props {
  token: string
  collections: NFTCollection[]
  selectedId: string | null
  isLoading: boolean
  onSelect: (id: string) => void
  onCreated: (collection: NFTCollection) => void
}

const STATUS_DOT: Record<string, string> = {
  draft: 'bg-white/30',
  generated: 'bg-violet-400',
  published: 'bg-emerald-400',
}

export function CollectionSidebar({ token, collections, selectedId, isLoading, onSelect, onCreated }: Props) {
  const [isCreating, setIsCreating] = useState(false)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [size, setSize] = useState('100')
  const [imageSize, setImageSize] = useState('1024')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreate = async () => {
    if (!name.trim()) {
      setError('Give your collection a name')
      return
    }
    setError(null)
    setIsSubmitting(true)
    try {
      const { collection } = await nftApi.createCollection(token, {
        name: name.trim(),
        description: description.trim(),
        collection_size: Number(size) || 100,
        image_size: Number(imageSize) || 1024,
      })
      onCreated(collection)
      setIsCreating(false)
      setName('')
      setDescription('')
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not create collection')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <div className="flex flex-col gap-3 rounded-2xl border border-white/10 bg-white/[0.03] p-4">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-white/80">
          <IconLayers className="h-4 w-4 text-white/40" />
          Your Collections
        </h2>
        <button
          onClick={() => setIsCreating((v) => !v)}
          className="flex h-6 w-6 items-center justify-center rounded-md text-white/50 hover:bg-white/10 hover:text-white"
          aria-label="New collection"
        >
          <IconPlus className="h-3.5 w-3.5" />
        </button>
      </div>

      {isCreating && (
        <div className="space-y-2 rounded-xl border border-white/10 bg-black/20 p-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Collection name"
            className="w-full rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm placeholder:text-white/30"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            rows={2}
            className="w-full resize-none rounded-md border border-white/10 bg-white/5 px-2.5 py-1.5 text-sm placeholder:text-white/30"
          />
          <div className="flex gap-2">
            <label className="flex-1 text-xs text-white/50">
              Size
              <input
                type="number"
                min={1}
                value={size}
                onChange={(e) => setSize(e.target.value)}
                className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-sm"
              />
            </label>
            <label className="flex-1 text-xs text-white/50">
              Image px
              <input
                type="number"
                min={64}
                step={64}
                value={imageSize}
                onChange={(e) => setImageSize(e.target.value)}
                className="mt-1 w-full rounded-md border border-white/10 bg-white/5 px-2 py-1 text-sm"
              />
            </label>
          </div>
          {error && <p className="text-xs text-red-400">{error}</p>}
          <button
            onClick={handleCreate}
            disabled={isSubmitting}
            className="flex w-full items-center justify-center gap-1.5 rounded-md bg-gradient-to-r from-purple-600 to-violet-600 py-1.5 text-sm font-medium hover:from-purple-500 hover:to-violet-500 disabled:opacity-50"
          >
            {isSubmitting && <IconSpinner className="h-3.5 w-3.5" />}
            Create
          </button>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {isLoading && <p className="px-1 py-2 text-xs text-white/40">Loading…</p>}
        {!isLoading && collections.length === 0 && (
          <p className="px-1 py-2 text-xs text-white/40">No collections yet — create your first one above.</p>
        )}
        {collections.map((collection) => (
          <button
            key={collection.id}
            onClick={() => onSelect(collection.id)}
            className={`flex items-center gap-2 rounded-lg px-2.5 py-2 text-left text-sm transition-colors ${
              collection.id === selectedId ? 'bg-purple-500/15 text-white ring-1 ring-purple-400/30' : 'text-white/70 hover:bg-white/5'
            }`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[collection.status] ?? STATUS_DOT.draft}`} />
            <span className="flex-1 truncate">{collection.name}</span>
          </button>
        ))}
      </div>
    </div>
  )
}
