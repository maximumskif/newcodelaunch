import { useState } from 'react'

import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { InlineError } from '../../components/ui/InlineError'
import { nftApi, type NFTCollection, type NFTTraitRule } from '../../lib/nftApi'

const selectClass = 'mt-1 w-full rounded-md border border-border bg-surface px-2 py-1.5 text-sm text-ink'

type Kind = NFTTraitRule['kind']

// Rules the generator honors between traits on different layers — "this
// hat never appears with that background", "this accessory requires that
// body". The server enforces them (nft_generation.py) and refuses rules
// that can't mean anything (same layer), repeat, or contradict each other.
export function TraitRules({ token, collection, onChange }: { token: string; collection: NFTCollection; onChange: () => void }) {
  const layers = collection.layers ?? []
  const rules = collection.rules ?? []
  const [traitId, setTraitId] = useState('')
  const [kind, setKind] = useState<Kind>('exclude')
  const [otherTraitId, setOtherTraitId] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)

  const traitLabel = (id: string) => {
    for (const layer of layers) {
      const trait = layer.traits.find((candidate) => candidate.id === id)
      if (trait) return `${trait.name} (${layer.name})`
    }
    return 'a deleted trait'
  }
  const layerOf = (id: string) => layers.find((layer) => layer.traits.some((trait) => trait.id === id))?.id

  if (layers.filter((layer) => layer.traits.length > 0).length < 2) return null

  const add = async () => {
    setError(null)
    setIsSaving(true)
    try {
      await nftApi.addRule(token, collection.id, { kind, trait_id: traitId, other_trait_id: otherTraitId })
      setTraitId('')
      setOtherTraitId('')
      onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Adding the rule failed')
    } finally {
      setIsSaving(false)
    }
  }

  const remove = async (ruleId: string) => {
    setError(null)
    try {
      await nftApi.deleteRule(token, ruleId)
      onChange()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Removing the rule failed')
    }
  }

  const traitOptions = (excludeLayerOf?: string) =>
    layers
      .filter((layer) => layer.traits.length > 0 && layer.id !== (excludeLayerOf ? layerOf(excludeLayerOf) : undefined))
      .map((layer) => (
        <optgroup key={layer.id} label={layer.name}>
          {layer.traits.map((trait) => (
            <option key={trait.id} value={trait.id}>
              {trait.name}
            </option>
          ))}
        </optgroup>
      ))

  return (
    <Card padding="lg" className="space-y-3">
      <div>
        <h3 className="text-base font-medium text-ink">Trait rules</h3>
        <p className="text-sm text-ink-muted">
          Keep traits apart, or make one bring another along. Generation only ever produces combinations that follow
          every rule.
        </p>
      </div>

      {rules.length > 0 && (
        <ul className="space-y-1.5 text-sm">
          {rules.map((rule) => (
            <li key={rule.id} className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-1.5">
              <span className="text-ink">
                {traitLabel(rule.trait_id)} <span className="text-ink-muted">{rule.kind === 'exclude' ? 'never appears with' : 'requires'}</span>{' '}
                {traitLabel(rule.other_trait_id)}
              </span>
              <Button variant="ghost" size="sm" aria-label={`Remove rule: ${traitLabel(rule.trait_id)} ${rule.kind} ${traitLabel(rule.other_trait_id)}`} onClick={() => void remove(rule.id)}>
                Remove
              </Button>
            </li>
          ))}
        </ul>
      )}

      <div className="grid gap-2 sm:grid-cols-[1fr_auto_1fr_auto] sm:items-end">
        <label className="block text-xs text-ink-muted">
          Trait
          <select value={traitId} onChange={(e) => setTraitId(e.target.value)} className={selectClass}>
            <option value="">Choose…</option>
            {traitOptions()}
          </select>
        </label>
        <label className="block text-xs text-ink-muted">
          Rule
          <select value={kind} onChange={(e) => setKind(e.target.value as Kind)} className={selectClass}>
            <option value="exclude">never appears with</option>
            <option value="require">requires</option>
          </select>
        </label>
        <label className="block text-xs text-ink-muted">
          Other trait
          <select value={otherTraitId} onChange={(e) => setOtherTraitId(e.target.value)} className={selectClass} disabled={!traitId}>
            <option value="">Choose…</option>
            {traitId && traitOptions(traitId)}
          </select>
        </label>
        <Button variant="secondary" size="sm" disabled={!traitId || !otherTraitId} isLoading={isSaving} onClick={() => void add()}>
          Add rule
        </Button>
      </div>

      {error && <InlineError>{error}</InlineError>}
    </Card>
  )
}
