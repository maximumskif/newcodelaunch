import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'

import { ALL_TOOLS, PILLARS } from '../../lib/pillars'

interface Entry {
  id: string
  label: string
  detail: string
  path: string
  pillarId?: string
  soon?: boolean
  haystack: string
}

const ENTRIES: Entry[] = [
  { id: 'home', label: 'Home', detail: 'page', path: '/', haystack: 'home start' },
  { id: 'tools', label: 'All tools', detail: 'page', path: '/tools', haystack: 'all tools directory list' },
  { id: 'dashboard', label: 'My stuff', detail: 'page', path: '/dashboard', haystack: 'my stuff dashboard projects mine' },
  ...PILLARS.map((pillar) => ({
    id: `pillar-${pillar.id}`,
    label: pillar.name,
    detail: 'area overview',
    path: pillar.path,
    pillarId: pillar.id,
    haystack: `${pillar.name} ${pillar.tagline}`.toLowerCase(),
  })),
  ...ALL_TOOLS.map((tool) => ({
    id: tool.id,
    label: tool.name,
    detail: tool.pillar.name.toLowerCase(),
    path: tool.path ?? '',
    pillarId: tool.pillar.id,
    soon: !tool.path,
    haystack: `${tool.name} ${tool.description} ${(tool.keywords ?? []).join(' ')} ${tool.pillar.name}`.toLowerCase(),
  })),
]

// Opens on ctrl+k / cmd+k from anywhere, or from the header's search button.
export function useCommandPalette() {
  const [open, setOpen] = useState(false)
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen((current) => !current)
      }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [])
  return { open, setOpen }
}

// A searchable jump-to for every page, area and tool. "Soon" tools are
// listed (so people learn they're coming) but can't be chosen.
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  // Mounted only while open, so every opening starts with an empty search.
  return open ? <PaletteDialog onClose={onClose} /> : null
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const listId = useId()

  const results = useMemo(() => {
    const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean)
    const hits = words.length ? ENTRIES.filter((entry) => words.every((word) => entry.haystack.includes(word) || entry.label.toLowerCase().includes(word))) : ENTRIES
    return hits.slice(0, 12)
  }, [query])

  // Focus the search on open; give focus back to whatever had it on close.
  useEffect(() => {
    returnFocus.current = document.activeElement as HTMLElement | null
    requestAnimationFrame(() => inputRef.current?.focus())
    return () => returnFocus.current?.focus?.()
  }, [])

  const choose = (entry: Entry | undefined) => {
    if (!entry || entry.soon) return
    onClose()
    navigate(entry.path)
  }

  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Escape') {
      event.preventDefault()
      onClose()
    } else if (event.key === 'ArrowDown') {
      event.preventDefault()
      setActive((index) => Math.min(index + 1, results.length - 1))
    } else if (event.key === 'ArrowUp') {
      event.preventDefault()
      setActive((index) => Math.max(index - 1, 0))
    } else if (event.key === 'Enter') {
      event.preventDefault()
      choose(results[active])
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/60 px-4 pt-[12vh]" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Search tools and pages"
        className="w-full max-w-xl overflow-hidden rounded-lg border border-border-strong bg-canvas shadow-elevated"
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={onKeyDown}
      >
        <div className="flex items-center gap-3 border-b border-border px-4 font-mono">
          <span className="text-accent-400" aria-hidden>
            &gt;
          </span>
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActive(0)
            }}
            placeholder="what do you want to do?"
            role="combobox"
            aria-expanded="true"
            aria-controls={listId}
            aria-activedescendant={results[active] ? `${listId}-${results[active].id}` : undefined}
            aria-label="Search tools and pages"
            className="h-14 min-w-0 flex-1 bg-transparent text-base text-ink placeholder:text-ink-faint focus:outline-none"
          />
          <kbd className="rounded border border-border px-1.5 py-0.5 text-[11px] text-ink-faint">esc</kbd>
        </div>
        <ul id={listId} role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto py-1">
          {results.length === 0 && <li className="px-4 py-3 text-sm text-ink-muted">Nothing matches “{query}”.</li>}
          {results.map((entry, index) => (
            <li
              key={entry.id}
              id={`${listId}-${entry.id}`}
              role="option"
              aria-selected={index === active}
              aria-disabled={entry.soon || undefined}
              data-pillar={entry.pillarId}
              onMouseEnter={() => setActive(index)}
              onClick={() => choose(entry)}
              className={`flex cursor-pointer items-center gap-3 px-4 py-2.5 font-mono text-sm ${index === active ? 'bg-surface-raised' : ''} ${entry.soon ? 'cursor-default' : ''}`}
            >
              <span className={`h-2 w-2 shrink-0 rounded-full ${entry.pillarId ? 'bg-accent-500' : 'bg-ink'}`} aria-hidden />
              <span className={`flex-1 ${entry.soon ? 'text-ink-faint' : 'text-ink'}`}>{entry.label}</span>
              <span className="text-xs text-ink-faint">{entry.soon ? 'soon' : entry.detail}</span>
            </li>
          ))}
        </ul>
        <div className="flex gap-4 border-t border-border px-4 py-2 font-mono text-[11px] text-ink-faint">
          <span>↑↓ move</span>
          <span>⏎ open</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  )
}
