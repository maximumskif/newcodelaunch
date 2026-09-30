import type { ReactNode } from 'react'
import { useLocation } from 'react-router-dom'

import { pillarForPath, toolForPath } from '../../lib/pillars'

interface Props {
  eyebrow: string
  title: string
  description: string
  // Optional content under the description (e.g. a live status strip).
  children?: ReactNode
}

// A tool page's header, terminal style: the tool's glyph in its area's
// color, the title in mono, one plain-language line under it. The area and
// tool come from the URL (lib/pillars.ts), so every tool page gets the right
// glyph without passing it; `eyebrow` is the fallback label elsewhere.
export function PageHero({ eyebrow, title, description, children }: Props) {
  const { pathname } = useLocation()
  const pillar = pillarForPath(pathname)
  const tool = toolForPath(pathname)
  return (
    <header className="animate-fade-up border-b border-border pb-6">
      <div className="flex items-start gap-4">
        {pillar && (
          <span
            aria-hidden
            className="grid h-12 w-12 shrink-0 place-items-center rounded-lg bg-accent-500/15 font-mono text-xl font-bold text-accent-400"
          >
            {tool?.glyph ?? pillar.glyph}
          </span>
        )}
        <div className="min-w-0 space-y-1.5">
          <p className="font-mono text-xs font-semibold text-accent-400">
            {pillar ? `${pillar.short}${tool ? ` / ${tool.name.toLowerCase()}` : ''}` : eyebrow.toLowerCase()}
          </p>
          <h1 className="text-3xl font-bold text-ink sm:text-4xl">{title}</h1>
          <p className="max-w-3xl leading-relaxed text-ink-muted">{description}</p>
        </div>
      </div>
      {children && <div className="mt-6">{children}</div>}
    </header>
  )
}
