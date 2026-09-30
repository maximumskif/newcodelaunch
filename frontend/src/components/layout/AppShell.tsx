import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { WalletConnect } from '../../features/auth/WalletConnect'
import { EVM_NETWORKS, useNetwork } from '../../features/network/NetworkContext'
import { PILLARS, pillarForPath, toolForPath, type Pillar } from '../../lib/pillars'
import { IconArrowRight, IconGrid } from '../ui/icons'
import { CommandPalette, useCommandPalette } from './CommandPalette'

// Only these routes actually consume the selected EVM network today — the
// NFT generator's flow (traits/rarity/IPFS) has no network concept at all,
// so the selector would be a control with no effect there.
const NETWORK_AWARE_PATHS = new Set(['/tokens/create', '/contracts/deploy'])
const COLLAPSE_STORAGE_KEY = 'newcodelaunch.sidebar-collapsed'

function NetworkSelector() {
  const { network, setNetwork } = useNetwork()
  const selected = EVM_NETWORKS.find((item) => item.id === network)
  // One compact control: eight networks as pills pushed the wallet buttons
  // onto a second header row even at desktop width.
  return (
    <label className={`flex h-9 items-center gap-2 rounded-md border px-2 font-mono text-xs ${selected?.isTestnet === false ? 'border-warning/60' : 'border-border'}`}>
      <span className="text-ink-faint">network</span>
      <select value={network} onChange={(event) => setNetwork(event.target.value)} className="bg-transparent text-ink focus:outline-none">
        <optgroup label="Testnets">
          {EVM_NETWORKS.filter((item) => item.isTestnet).map((item) => (
            <option key={item.id} value={item.id} className="bg-canvas">
              {item.label}
            </option>
          ))}
        </optgroup>
        <optgroup label="Mainnets — real funds">
          {EVM_NETWORKS.filter((item) => !item.isTestnet).map((item) => (
            <option key={item.id} value={item.id} className="bg-canvas">
              {item.label}
            </option>
          ))}
        </optgroup>
      </select>
      {selected?.isTestnet === false && <span className="text-warning">mainnet</span>}
    </label>
  )
}

// Shared active/inactive treatment for every sidebar link — a left accent
// bar on the active item (instead of only a background tint) is a small,
// common cue in dense product sidebars (Linear/Vercel-style) that makes the
// current page legible even at a glance, not just on close inspection.
function sidebarLinkClassName({ isActive }: { isActive: boolean }): string {
  return `flex items-center gap-2.5 rounded-md border-l-2 px-2.5 py-2 text-sm transition-colors duration-150 ${
    isActive
      ? 'border-l-accent-500 bg-accent-500/10 font-medium text-ink'
      : 'border-l-transparent text-ink-muted hover:bg-surface-hover hover:text-ink'
  }`
}

// Wraps the live product pages (tokens/nft/contracts/dashboard) with a
// persistent sidebar + top bar, distinct from the marketing site's top nav.
export function AppShell() {
  const location = useLocation()
  const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1')
  // Desktop-only "narrow to icons" state (isCollapsed, persisted) and this
  // mobile-only "open the off-canvas drawer" state are deliberately
  // separate — at phone width the sidebar used to stay permanently visible
  // at its full 240px, eating well over half of a 390px-wide screen and
  // squeezing every real page into a narrow leftover column. Below the
  // md breakpoint the sidebar is now closed by default and slides in as an
  // overlay; at md and up this state is simply never read.
  const [isMobileOpen, setIsMobileOpen] = useState(false)
  const menuButtonRef = useRef<HTMLButtonElement>(null)

  // Found via a real keyboard-only pass (not caught by axe, which doesn't
  // exercise interaction behavior): the backdrop and every nav link already
  // closed this drawer on click, but Escape — the near-universal expected
  // way to dismiss any open overlay, and the same convention Dialog.tsx
  // already follows — did nothing. Also returns focus to the toggle button
  // that opened it, so a keyboard user doesn't lose their place once the
  // drawer closes.
  useEffect(() => {
    if (!isMobileOpen) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsMobileOpen(false)
        menuButtonRef.current?.focus()
      }
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isMobileOpen])

  const toggleCollapsed = () => {
    setIsCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0')
      return next
    })
  }

  const pillar = pillarForPath(location.pathname)
  const tool = toolForPath(location.pathname, location.search, location.hash)
  const palette = useCommandPalette()
  const closeMobile = () => setIsMobileOpen(false)

  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      {isMobileOpen && <div className="fixed inset-0 z-30 bg-black/60 md:hidden" aria-hidden="true" onClick={closeMobile} />}

      <aside
        // bg-surface + a shadow while the mobile drawer is open, so it reads
        // as a panel over its dimmed backdrop; flat canvas on desktop.
        className={`fixed inset-y-0 left-0 z-40 flex w-64 shrink-0 flex-col border-r border-border bg-[#10120e] shadow-elevated transition-transform duration-200 ease-out md:static md:translate-x-0 md:bg-canvas md:shadow-none md:transition-[width] ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${isCollapsed ? 'md:w-16' : 'md:w-64'}`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-4">
          {!isCollapsed && (
            <Link to="/" className="font-mono text-sm font-bold text-ink">
              ~/newcodelaunch<span className="animate-blink text-p-tokens">_</span>
            </Link>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="hidden rounded-md p-1 text-ink-faint hover:bg-surface-hover hover:text-ink md:block"
          >
            <IconArrowRight className={`h-4 w-4 transition-transform duration-150 ${isCollapsed ? '' : 'rotate-180'}`} />
          </button>
          <button type="button" onClick={closeMobile} aria-label="Close menu" className="rounded-md p-1 text-ink-faint hover:bg-surface-hover hover:text-ink md:hidden">
            <IconArrowRight className="h-4 w-4 rotate-180" />
          </button>
        </div>

        <nav aria-label="Main" className="flex-1 space-y-4 overflow-y-auto px-2 py-3 font-mono text-sm">
          <div className="space-y-0.5">
            <NavLink to="/dashboard" title={isCollapsed ? 'My stuff' : undefined} className={sidebarLinkClassName} onClick={closeMobile}>
              <IconGrid className="h-4 w-4 shrink-0" />
              {!isCollapsed && <span>My stuff</span>}
            </NavLink>
            <NavLink to="/tools" title={isCollapsed ? 'All tools' : undefined} className={sidebarLinkClassName} onClick={closeMobile}>
              <span aria-hidden className="w-4 shrink-0 text-center">≡</span>
              {!isCollapsed && <span>All tools</span>}
            </NavLink>
          </div>
          <div className="space-y-1">
            {!isCollapsed && <p className="px-2.5 pb-1 text-[11px] text-ink-faint">tools/</p>}
            {PILLARS.map((item) => (
              <PillarTree key={item.id} pillar={item} expanded={!isCollapsed && pillar?.id === item.id} collapsed={isCollapsed} onNavigate={closeMobile} />
            ))}
          </div>
        </nav>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center gap-3 border-b border-border px-4 py-3 sm:px-6">
          <button
            ref={menuButtonRef}
            type="button"
            onClick={() => setIsMobileOpen(true)}
            aria-label="Open menu"
            className="rounded-md p-1.5 text-ink-faint hover:bg-surface-hover hover:text-ink md:hidden"
          >
            <IconGrid className="h-5 w-5" />
          </button>
          <nav aria-label="Breadcrumb" className="mr-auto hidden min-w-0 font-mono text-sm text-ink-faint sm:block">
            <ol className="flex items-center gap-1.5">
              <li>
                <Link to="/" className="hover:text-ink">~</Link>
              </li>
              {pillar && (
                <li className="flex items-center gap-1.5" data-pillar={pillar.id}>
                  <span aria-hidden>/</span>
                  <Link to={pillar.path} className="text-accent-400 hover:underline" aria-current={tool ? undefined : 'page'}>
                    {pillar.name.toLowerCase()}
                  </Link>
                </li>
              )}
              {tool && (
                <li className="flex items-center gap-1.5 truncate">
                  <span aria-hidden>/</span>
                  <span className="text-ink" aria-current="page">{tool.name.toLowerCase()}</span>
                </li>
              )}
              {!pillar && location.pathname === '/tools' && <li className="text-ink">/ all tools</li>}
              {!pillar && location.pathname === '/dashboard' && <li className="text-ink">/ my stuff</li>}
            </ol>
          </nav>
          <button
            type="button"
            onClick={() => palette.setOpen(true)}
            className="flex h-9 items-center gap-2 rounded-md border border-border px-3 font-mono text-xs text-ink-faint hover:border-border-strong hover:text-ink"
          >
            <span aria-hidden>&gt;</span> search tools
            <kbd className="hidden rounded border border-border px-1 sm:inline">ctrl k</kbd>
          </button>
          {NETWORK_AWARE_PATHS.has(location.pathname) && <NetworkSelector />}
          <WalletConnect />
        </header>
        <main className="min-w-0 flex-1" data-pillar={pillar?.id}>
          <Outlet />
        </main>
      </div>
      <CommandPalette open={palette.open} onClose={() => palette.setOpen(false)} />
    </div>
  )
}

// One area in the sidebar: its name (linking to its home page) and, when
// it's the current area, its tools as a tree. Tools sharing a destination
// are listed once; "soon" tools are shown but not linked.
function PillarTree({ pillar, expanded, collapsed, onNavigate }: { pillar: Pillar; expanded: boolean; collapsed: boolean; onNavigate: () => void }) {
  const location = useLocation()
  // One highlighted tool: the one this page resolves to.
  const current = toolForPath(location.pathname, location.search, location.hash)
  const seen = new Set<string>()
  const tools = pillar.tools.filter((tool) => {
    const key = tool.path ?? tool.id
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
  return (
    <div data-pillar={pillar.id}>
      <NavLink
        to={pillar.path}
        end
        title={collapsed ? pillar.name : undefined}
        onClick={onNavigate}
        className={({ isActive }) =>
          `flex items-center gap-2.5 rounded-md px-2.5 py-1.5 transition-colors ${isActive ? 'bg-accent-500/15 text-accent-300' : 'text-accent-400 hover:bg-surface-hover'}`
        }
      >
        <span aria-hidden className="w-4 shrink-0 text-center font-bold">{pillar.glyph}</span>
        {!collapsed && <span className="truncate">{pillar.short}/</span>}
      </NavLink>
      {expanded && (
        <ul className="mt-0.5 space-y-px">
          {tools.map((tool, index) => {
            const branch = index === tools.length - 1 ? '└─' : '├─'
            if (!tool.path) {
              return (
                <li key={tool.id} className="flex items-center gap-1.5 px-2.5 py-1 text-ink-faint">
                  <span aria-hidden className="text-border-strong">{branch}</span>
                  <span className="truncate">{tool.name.toLowerCase()}</span>
                  <span className="ml-auto text-[10px]">soon</span>
                </li>
              )
            }
            const active = current?.path === tool.path
            return (
              <li key={tool.id}>
                <Link
                  to={tool.path}
                  onClick={onNavigate}
                  aria-current={active ? 'page' : undefined}
                  className={`flex items-center gap-1.5 rounded-md px-2.5 py-1 transition-colors ${active ? 'bg-accent-500 text-canvas' : 'text-ink-muted hover:bg-surface-hover hover:text-ink'}`}
                >
                  <span aria-hidden className={active ? 'text-canvas/60' : 'text-border-strong'}>{branch}</span>
                  <span className="truncate">{tool.name.toLowerCase()}</span>
                </Link>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
