import { useState } from 'react'

import { nftApi, type NFTCollection } from '../../lib/nftApi'
import { LayerCard } from './LayerCard'
import { IconPlus, IconSpinner } from './ui/icons'

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
    <div className="rounded-2xl border border-white/10 bg-white/[0.03] p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-medium">Layers & Traits</h2>
          <p className="mt-0.5 text-sm text-white/60">
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
            className="rounded-md border border-white/10 bg-white/5 px-3 py-1.5 text-sm placeholder:text-white/30"
          />
          <button
            onClick={handleAddLayer}
            disabled={isSubmitting || !newLayerName.trim()}
            className="flex items-center gap-1.5 rounded-md border border-white/10 px-3 py-1.5 text-sm hover:bg-white/5 disabled:opacity-40"
          >
            {isSubmitting ? <IconSpinner className="h-3.5 w-3.5" /> : <IconPlus className="h-3.5 w-3.5" />}
            Add layer
          </button>
        </div>
      </div>
      {error && <p className="mt-2 text-sm text-red-400">{error}</p>}

      <div className="mt-4 space-y-2.5">
        {layers.length === 0 && (
          <p className="rounded-xl border border-dashed border-white/10 py-6 text-center text-sm text-white/40">
            No layers yet. Add one to start uploading trait images.
          </p>
        )}
        {layers.map((layer) => (
          <LayerCard key={layer.id} token={token} layer={layer} onTraitAdded={onChange} />
        ))}
      </div>
    </div>
  )
}
