import { useState } from 'react'
import { Link } from 'react-router-dom'

import { PILLARS, type PillarId } from '../../lib/pillars'
import { ToolCard } from './ToolCard'

// Every tool in one place, a row per area, with search and area filters.
export function AllToolsPage() {
  const [query, setQuery] = useState('')
  const [only, setOnly] = useState<PillarId | null>(null)
  const needle = query.trim().toLowerCase()
  const matches = (text: string) => text.toLowerCase().includes(needle)
  const rows = PILLARS.filter((pillar) => !only || pillar.id === only)
    .map((pillar) => ({
      pillar,
      tools: pillar.tools.filter(
        (tool) => !needle || matches(tool.name) || matches(tool.description) || (tool.keywords ?? []).some(matches) || matches(pillar.name),
      ),
    }))
    .filter((row) => row.tools.length > 0)
  const total = PILLARS.reduce((sum, pillar) => sum + pillar.tools.length, 0)

  return (
    <div className="space-y-8 p-4 sm:p-8">
      <header className="flex flex-wrap items-end justify-between gap-6">
        <div className="space-y-2">
          <p className="font-mono text-sm text-ink-faint">$ ls ~/tools</p>
          <h1 className="text-4xl font-bold text-ink">All tools</h1>
          <p className="text-ink-muted">
            {total} tools across six areas. Pick one, or search.
          </p>
        </div>
        <label className="flex h-11 w-full items-center gap-2.5 rounded-md border border-border px-3 font-mono text-sm text-ink-faint focus-within:border-accent-500 sm:w-96">
          <span aria-hidden>&gt;</span>
          <input
            aria-label="Search tools"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="what do you want to do?"
            className="min-w-0 flex-1 bg-transparent text-ink placeholder:text-ink-faint focus:outline-none"
          />
        </label>
      </header>

      <div role="group" aria-label="Filter by area" className="flex flex-wrap gap-2">
        {[null, ...PILLARS.map((pillar) => pillar.id)].map((id) => {
          const pillar = PILLARS.find((item) => item.id === id)
          return (
            <button
              key={id ?? 'all'}
              type="button"
              aria-pressed={only === id}
              onClick={() => setOnly(id)}
              data-pillar={id ?? undefined}
              className={`flex h-9 items-center gap-2 rounded-full border px-3.5 font-mono text-xs transition-colors ${
                only === id ? 'border-ink bg-surface-raised text-ink' : 'border-border text-ink-muted hover:text-ink'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${id ? 'bg-accent-500' : 'bg-ink'}`} aria-hidden />
              {pillar ? pillar.short : 'all'}
            </button>
          )
        })}
      </div>

      {rows.length === 0 && <p className="text-ink-muted">No tool matches “{query}”.</p>}
      <div className="space-y-6">
        {rows.map(({ pillar, tools }) => (
          <section key={pillar.id} data-pillar={pillar.id} aria-labelledby={`tools-${pillar.id}`} className="grid gap-4 lg:grid-cols-[200px_1fr]">
            <Link to={pillar.path} className="self-start border-t-2 border-accent-500 pt-3">
              <h2 id={`tools-${pillar.id}`} className="font-mono text-base font-bold text-accent-400">
                {pillar.name.toLowerCase()}
              </h2>
              <span className="text-sm text-ink-faint">{pillar.tools.length} tools · overview →</span>
            </Link>
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3 2xl:grid-cols-4">
              {tools.map((tool) => (
                <ToolCard key={tool.id} tool={tool} pillar={pillar} />
              ))}
            </div>
          </section>
        ))}
      </div>
    </div>
  )
}
