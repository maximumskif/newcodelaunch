import { useState } from 'react'

import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { IconLayers, IconPlus } from '../../components/ui/icons'
import { nftApi, type NFTCollection } from '../../lib/nftApi'

interface Props {
  token: string
  collections: NFTCollection[]
  selectedId: string | null
  isLoading: boolean
  onSelect: (id: string) => void
  onCreated: (collection: NFTCollection) => void
  projectId?: string | null
  initialName?: string
}

const STATUS_DOT: Record<string, string> = {
  draft: 'bg-ink-faint',
  generated: 'bg-accent-400',
  published: 'bg-success',
}

export function CollectionSidebar({
  token,
  collections,
  selectedId,
  isLoading,
  onSelect,
  onCreated,
  projectId,
  initialName,
}: Props) {
  // Arriving from the new-project wizard with a not-yet-created collection —
  // open the create form pre-filled with the name already chosen there.
  const [isCreating, setIsCreating] = useState(Boolean(projectId && initialName))
  const [name, setName] = useState(initialName ?? '')
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
        project_id: projectId ?? undefined,
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
    <Card padding="sm" className="flex flex-col gap-3">
      <div className="flex items-center justify-between">
        <h2 className="flex items-center gap-1.5 text-sm font-medium text-ink">
          <IconLayers className="h-4 w-4 text-ink-faint" />
          Your Collections
        </h2>
        <Button variant="ghost" size="sm" className="!p-0 h-6 w-6" onClick={() => setIsCreating((v) => !v)} aria-label="New collection">
          <IconPlus className="h-3.5 w-3.5" />
        </Button>
      </div>

      {isCreating && (
        <div className="space-y-2 rounded-md border border-border bg-canvas p-3">
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Collection name"
            className="w-full rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm placeholder:text-ink-faint"
          />
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Description"
            rows={2}
            className="w-full resize-none rounded-md border border-border bg-surface px-2.5 py-1.5 text-sm placeholder:text-ink-faint"
          />
          <div className="flex gap-2">
            <label className="flex-1 text-xs text-ink-muted">
              Size
              <input
                type="number"
                min={1}
                value={size}
                onChange={(e) => setSize(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1 text-sm"
              />
            </label>
            <label className="flex-1 text-xs text-ink-muted">
              Image px
              <input
                type="number"
                min={64}
                step={64}
                value={imageSize}
                onChange={(e) => setImageSize(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-surface px-2 py-1 text-sm"
              />
            </label>
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <Button variant="primary" size="sm" className="w-full" onClick={handleCreate} isLoading={isSubmitting}>
            Create
          </Button>
        </div>
      )}

      <div className="flex flex-col gap-1">
        {isLoading && <p className="px-1 py-2 text-xs text-ink-faint">Loading…</p>}
        {!isLoading && collections.length === 0 && (
          <p className="px-1 py-2 text-xs text-ink-faint">No collections yet — create your first one above.</p>
        )}
        {collections.map((collection) => (
          <button
            key={collection.id}
            onClick={() => onSelect(collection.id)}
            className={`flex items-center gap-2 rounded-md px-2.5 py-2 text-left text-sm transition-colors duration-150 ${
              collection.id === selectedId
                ? 'bg-accent-500/15 text-ink ring-1 ring-accent-400/30'
                : 'text-ink-muted hover:bg-surface-hover'
            }`}
          >
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${STATUS_DOT[collection.status] ?? STATUS_DOT.draft}`} />
            <span className="flex-1 truncate">{collection.name}</span>
          </button>
        ))}
      </div>
    </Card>
  )
}
