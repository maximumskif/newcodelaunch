import { Link, Navigate, useLocation } from 'react-router-dom'

import { buttonClassName } from '../../components/ui/Button'
import { pillarById, type PillarId } from '../../lib/pillars'
import { ToolCard, ToolGlyph } from './ToolCard'

// Where an old /tokens or /contracts link with a query was meant to go
// (project resume links, ?template= links) — those pages moved.
const QUERY_TARGETS: Partial<Record<PillarId, string>> = {
  tokens: '/tokens/create',
  contracts: '/contracts/deploy',
}

// An area's home page: what the area is for, how to get started, and every
// tool in it. One template for all six, driven by lib/pillars.ts.
export function PillarHubPage({ pillarId }: { pillarId: PillarId }) {
  const { search, hash } = useLocation()
  const pillar = pillarById(pillarId)
  const target = QUERY_TARGETS[pillarId]
  if (target && search) return <Navigate replace to={`${target}${search}${hash}`} />

  const firstTool = pillar.tools.find((tool) => tool.path)
  const next = pillar.next ? pillarById(pillar.next.pillar) : null

  return (
    <div className="space-y-10 p-4 sm:p-8">
      <header className="flex flex-wrap items-end justify-between gap-6 border-b border-border pb-8">
        <div className="max-w-3xl space-y-4">
          <div className="flex items-center gap-4">
            <ToolGlyph pillar={pillar} glyph={pillar.glyph} size="lg" />
            <h1 className="text-4xl font-bold text-ink sm:text-5xl">{pillar.name}</h1>
          </div>
          <p className="text-lg leading-relaxed text-ink-muted">{pillar.summary}</p>
        </div>
        {firstTool?.path && (
          <Link to={firstTool.path} className={buttonClassName('primary', 'lg')}>
            [ {firstTool.name.toLowerCase()} ]
          </Link>
        )}
      </header>

      <section aria-labelledby="start-heading" className="space-y-4">
        <h2 id="start-heading" className="font-mono text-sm font-semibold text-ink-faint">
          start here
        </h2>
        <ol className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {pillar.steps.map((step, index) => (
            <li key={step.title} className="space-y-2 rounded-lg border border-border bg-surface p-5">
              <span className="font-mono text-2xl font-bold text-accent-400">{String(index + 1).padStart(2, '0')}</span>
              <p className="font-mono font-semibold text-ink">{step.title}</p>
              <p className="text-sm leading-snug text-ink-muted">{step.description}</p>
            </li>
          ))}
        </ol>
      </section>

      <section aria-labelledby="tools-heading" className="space-y-4">
        <h2 id="tools-heading" className="font-mono text-sm font-semibold text-ink-faint">
          {pillar.name.toLowerCase()} tools
        </h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {pillar.tools.map((tool) => (
            <ToolCard key={tool.id} tool={tool} pillar={pillar} />
          ))}
        </div>
      </section>

      {next && pillar.next && (
        <Link
          to={next.path}
          data-pillar={next.id}
          className="flex flex-wrap items-center justify-between gap-4 rounded-xl border border-accent-500/40 bg-accent-500/5 p-6 transition-colors hover:bg-accent-500/10"
        >
          <span className="space-y-1">
            <span className="block font-mono text-sm font-semibold text-accent-400">
              {next.glyph} next: {next.name.toLowerCase()}
            </span>
            <span className="block text-ink">{pillar.next.pitch}</span>
          </span>
          <span className="font-mono text-sm text-accent-400">open {next.name.toLowerCase()} →</span>
        </Link>
      )}
    </div>
  )
}
