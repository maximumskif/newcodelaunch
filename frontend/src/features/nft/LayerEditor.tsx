import { useState } from 'react'

import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { IconPlus } from '../../components/ui/icons'
import { nftApi, type NFTCollection } from '../../lib/nftApi'
import { LayerCard } from './LayerCard'

interface Props {
  token: string
  collection: NFTCollection
  onChange: () => void
}

export function LayerEditor({ token, collection, onChange }: Props) {
  const [newLayerName, setNewLayerName] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const layers = collection.layers ?? []

  const handleAddLayer = async () => {
    if (!newLayerName.trim()) return
    setError(null)
    setIsSubmitting(true)
    try {
      await nftApi.addLayer(token, collection.id, { name: newLayerName.trim(), order_index: layers.length })
      setNewLayerName('')
      onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not add layer')
    } finally {
      setIsSubmitting(false)
    }
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium text-ink">Layers & Traits</h2>
          <p className="mt-0.5 text-sm text-ink-muted">
            Layers stack bottom-to-top. Every layer needs at least one trait — use AI to suggest a rarity while
            you upload.
          </p>
        </div>
        <div className="flex gap-2">
          <input
            value={newLayerName}
            onChange={(e) => setNewLayerName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleAddLayer()}
            placeholder="New layer name (e.g. Background)"
            aria-label="New layer name"
            className="rounded-md border border-border bg-surface px-3 py-1.5 text-sm placeholder:text-ink-faint"
          />
          <Button variant="secondary" onClick={handleAddLayer} disabled={!newLayerName.trim()} isLoading={isSubmitting}>
            <IconPlus className="h-3.5 w-3.5" />
            Add layer
          </Button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-danger">{error}</p>}

      <div className="mt-4 space-y-2.5">
        {layers.length === 0 && <EmptyState compact title="No layers yet." description="Add one to start uploading trait images." />}
        {layers.map((layer) => (
          <LayerCard key={layer.id} token={token} layer={layer} onTraitAdded={onChange} />
        ))}
      </div>
    </Card>
  )
}
