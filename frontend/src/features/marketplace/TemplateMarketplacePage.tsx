import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { Dialog } from '../../components/ui/Dialog'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageHero } from '../../components/ui/PageHero'
import { InlineError } from '../../components/ui/InlineError'
import { contractsApi, type ContractTemplateSummary } from '../../lib/contractsApi'
import { templateMeta } from '../contracts/templateMeta'

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
  const [viewing, setViewing] = useState<ContractTemplateSummary | null>(null)

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
    const path = template.type === 'erc20' ? '/tokens/create' : '/contracts/deploy'
    navigate(`${path}?template=${template.id}`)
  }

  return (
    <div className="space-y-5 p-4 sm:p-8">
      <PageHero
        eyebrow="Marketplace"
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
                <TemplateIcon id={template.id} />
                <Badge tone="accent">{template.type === 'erc20' ? 'ERC-20' : template.type === 'lock' ? 'Time-lock' : 'ERC-721'}</Badge>
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

              <div className="mt-auto grid grid-cols-2 gap-2">
                <Button variant="secondary" size="sm" onClick={() => setViewing(template)}>
                  View source
                </Button>
                <Button variant="primary" size="sm" onClick={() => selectTemplate(template)}>
                  Use this template
                </Button>
              </div>
            </Card>
          ))}
        </div>
      )}

      {viewing && <SourceDialog template={viewing} onClose={() => setViewing(null)} />}
    </div>
  )
}

function TemplateIcon({ id }: { id: string }) {
  const { icon: Icon } = templateMeta(id)
  return (
    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-500/15 text-accent-300">
      <Icon className="h-5 w-5" />
    </span>
  )
}

// The template's Solidity, exactly as it's compiled (parameters appear as
// {{PLACEHOLDERS}} until you fill them in on the deploy page).
function SourceDialog({ template, onClose }: { template: ContractTemplateSummary; onClose: () => void }) {
  const { data, error, isLoading } = useQuery({
    queryKey: ['template-source', template.id],
    queryFn: () => contractsApi.getTemplate(template.id),
  })
  return (
    <Dialog open onClose={onClose} title={`${template.name} — source`} description="The Solidity this template compiles. Values in {{BRACES}} are filled in from the deploy form." size="lg">
      {isLoading && <p className="text-sm text-ink-muted">Loading source…</p>}
      {error && <InlineError>{(error as Error).message}</InlineError>}
      {data && (
        <pre className="mt-3 max-h-[60vh] overflow-auto rounded-lg border border-border bg-canvas p-4 font-mono text-xs leading-relaxed text-ink-muted">
          <code>{data.template.solidity_code}</code>
        </pre>
      )}
      <div className="mt-4 flex justify-end">
        <Button variant="secondary" size="sm" onClick={onClose}>
          Close
        </Button>
      </div>
    </Dialog>
  )
}
