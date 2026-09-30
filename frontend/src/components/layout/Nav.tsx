import { Link } from 'react-router-dom'

import { PILLARS } from '../../lib/pillars'
import { buttonClassName } from '../ui/Button'
import { Dropdown } from '../ui/Dropdown'
import { IconChevronDown } from '../ui/icons'
import { CommandPalette, useCommandPalette } from './CommandPalette'

// The marketing site's top bar: the six areas under "products", the full
// directory, search, and a way into the app.
export function Nav() {
  const palette = useCommandPalette()
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-canvas/85 px-4 py-3 backdrop-blur-md sm:px-6">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <div className="flex items-center gap-8">
          <Link to="/" className="font-mono text-base font-bold text-ink">
            ~/newcodelaunch<span className="animate-blink text-p-tokens">_</span>
          </Link>
          <nav aria-label="Main" className="hidden items-center gap-6 font-mono text-sm text-ink-muted md:flex">
            <Dropdown trigger={<><span>products</span><IconChevronDown className="h-3.5 w-3.5" /></>}>
              <div className="w-80 space-y-0.5 p-1">
                {PILLARS.map((pillar) => (
                  <Link key={pillar.id} to={pillar.path} data-pillar={pillar.id} className="flex gap-3 rounded-md px-3 py-2.5 hover:bg-surface-hover">
                    <span aria-hidden className="grid h-8 w-8 shrink-0 place-items-center rounded-md bg-accent-500/15 font-mono text-sm font-bold text-accent-400">
                      {pillar.glyph}
                    </span>
                    <span>
                      <span className="block font-mono text-sm text-accent-300">{pillar.name}</span>
                      <span className="block font-sans text-xs text-ink-muted">{pillar.tagline}</span>
                    </span>
                  </Link>
                ))}
              </div>
            </Dropdown>
            <Link to="/tools" className="hover:text-ink">
              all tools
            </Link>
            <Link to="/dashboard" className="hover:text-ink">
              my stuff
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => palette.setOpen(true)}
            className="hidden h-9 items-center gap-2 rounded-md border border-border px-3 font-mono text-xs text-ink-faint hover:text-ink sm:flex"
          >
            <span aria-hidden>&gt;</span> search tools <kbd className="rounded border border-border px-1">ctrl k</kbd>
          </button>
          {/* One action: into the app, where connecting a wallet happens. */}
          <Link to="/tools" className={buttonClassName('primary', 'md')}>
            open app →
          </Link>
        </div>
      </div>
      <CommandPalette open={palette.open} onClose={() => palette.setOpen(false)} />
    </header>
  )
}
