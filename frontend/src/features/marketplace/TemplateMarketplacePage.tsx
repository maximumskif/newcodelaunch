import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageHero } from '../../components/ui/PageHero'
import { IconCoin, IconLayers } from '../../components/ui/icons'
import { contractsApi, type ContractTemplateSummary } from '../../lib/contractsApi'

// Browse-only gallery over the templates that actually exist — no fake
// authors, ratings, or download counts like the legacy Template Marketplace.
// The 3 templates here are the same real, complete ones the Token Launchpad
// and Contracts Hub already deploy from (contract_templates.py); this page
// is a discovery front-end over that same real data, not a new backend model.
export function TemplateMarketplacePage() {
  const navigate = useNavigate()
  const [templates, setTemplates] = useState<ContractTemplateSummary[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    // Regression: this had no .catch() — a failed request left `templates`
    // as `[]` with `isLoading` flipped to `false` via `finally`, rendering
    // a blank grid with zero indication anything went wrong (indistinguishable
    // from "no templates exist").
    contractsApi
      .listTemplates()
      .then(({ templates: fetched }) => setTemplates(fetched))
      .catch((err) => setError(err instanceof Error ? err.message : 'Could not load templates'))
      .finally(() => setIsLoading(false))
  }, [])

  const selectTemplate = (template: ContractTemplateSummary) => {
    const path = template.type === 'erc20' ? '/tokens' : '/contracts'
    navigate(`${path}?template=${template.id}`)
  }

  return (
    <div className="space-y-5 p-8">
      <PageHero
        eyebrow="Phase 6"
        title="Template Marketplace"
        description="Every deployable template's Solidity source is real and inspectable before you deploy it — browse them here, then deploy from the Token Launchpad or Contracts Hub."
      />

      {isLoading && <p className="text-ink-muted">Loading templates…</p>}

      {!isLoading && error && (
        <EmptyState title="Could not load templates" description={error} />
      )}

      {!isLoading && !error && (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {templates.map((template) => (
            <Card key={template.id} padding="lg" rounded="xl" interactive className="flex flex-col gap-3">
              <div className="flex items-start justify-between gap-2">
                <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-500/10 text-accent-400">
                  {template.type === 'erc20' ? <IconCoin /> : <IconLayers />}
                </span>
                <Badge tone="accent">{template.type === 'erc20' ? 'ERC-20' : 'ERC-721'}</Badge>
              </div>

              <h3 className="font-display font-medium text-ink">{template.name}</h3>
              <p className="text-sm text-ink-muted">{template.description}</p>

              <div className="flex flex-wrap gap-1.5">
                {template.features.map((feature) => (
                  <span key={feature} className="rounded-full bg-surface-raised px-2.5 py-0.5 text-[11px] text-ink-faint">
                    {feature}
                  </span>
                ))}
              </div>

              <p className="text-xs text-ink-faint">~{template.gas_estimate.toLocaleString()} gas to deploy</p>

              <Button variant="secondary" size="sm" className="mt-auto" onClick={() => selectTemplate(template)}>
                Use this template
              </Button>
            </Card>
          ))}
        </div>
      )}
    </div>
  )
}
