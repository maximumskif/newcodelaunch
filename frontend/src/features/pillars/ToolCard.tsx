import { Link } from 'react-router-dom'

import type { Pillar, Tool } from '../../lib/pillars'

// A tool's glyph in its area's color. `data-pillar` scopes the accent, so
// the tile is correct even when it sits on another area's page.
export function ToolGlyph({ pillar, glyph, size = 'md' }: { pillar: Pillar; glyph: string; size?: 'md' | 'lg' }) {
  return (
    <span
      data-pillar={pillar.id}
      aria-hidden
      className={`grid shrink-0 place-items-center rounded-md bg-accent-500/15 font-mono font-bold text-accent-400 ${size === 'lg' ? 'h-12 w-12 text-xl' : 'h-8 w-8 text-sm'}`}
    >
      {glyph}
    </span>
  )
}

function StatusTag({ status }: { status: Tool['status'] }) {
  if (status === 'live') return null
  return (
    <span className={`font-mono text-[11px] ${status === 'new' ? 'text-accent-300' : 'text-ink-faint'}`}>
      {status === 'new' ? 'new' : 'soon'}
    </span>
  )
}

// One tool, as a card. A "soon" tool isn't a link — there's nothing there yet.
export function ToolCard({ tool, pillar }: { tool: Tool; pillar: Pillar }) {
  const body = (
    <>
      <span className="flex items-center justify-between">
        <ToolGlyph pillar={pillar} glyph={tool.glyph} />
        <StatusTag status={tool.status} />
      </span>
      <span className="font-mono text-sm font-semibold text-ink">{tool.name}</span>
      <span className="text-sm leading-snug text-ink-muted">{tool.description}</span>
    </>
  )
  const className = 'flex h-full flex-col gap-2.5 rounded-lg border border-border bg-surface p-4 transition-colors duration-150'
  if (!tool.path) {
    return (
      // Dashed, not faded: dimming with opacity drops the text below
      // accessible contrast (axe caught it on the area pages).
      <div className={`${className} border-dashed bg-transparent`} aria-label={`${tool.name} — coming soon`}>
        {body}
      </div>
    )
  }
  return (
    <Link to={tool.path} data-pillar={pillar.id} className={`${className} hover:border-accent-500/50 hover:bg-surface-hover`}>
      {body}
    </Link>
  )
}
