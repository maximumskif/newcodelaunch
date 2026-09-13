import { useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'

import { WalletConnect } from '../../features/auth/WalletConnect'
import { EVM_NETWORKS, useNetwork } from '../../features/network/NetworkContext'
import { PRODUCTS } from '../../lib/products'
import { Badge } from '../ui/Badge'
import { IconArrowRight, IconGrid } from '../ui/icons'

// Only these routes actually consume the selected EVM network today — the
// NFT generator's flow (traits/rarity/IPFS) has no network concept at all,
// so the selector would be a control with no effect there.
const NETWORK_AWARE_PATHS = new Set(['/tokens', '/contracts'])
const COLLAPSE_STORAGE_KEY = 'newcodelaunch.sidebar-collapsed'

function NetworkSelector() {
  const { network, setNetwork } = useNetwork()
  return (
    // overflow-x-auto + flex-nowrap: at 6 real networks this doesn't fit a
    // phone-width screen next to the wallet-connect buttons — scrolls
    // horizontally instead of wrapping each pill's own label mid-row.
    <div className="flex max-w-full items-center gap-0.5 overflow-x-auto rounded-md border border-border p-0.5 text-xs">
      {EVM_NETWORKS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => setNetwork(item.id)}
          title={item.isTestnet ? undefined : 'Mainnet — deploys cost real funds'}
          className={`flex shrink-0 items-center gap-1 rounded px-2 py-1 whitespace-nowrap transition-colors duration-150 ${
            network === item.id
              ? item.isTestnet
                ? 'bg-accent-500/10 text-ink'
                : 'bg-warning/10 text-ink'
              : 'text-ink-muted hover:text-ink'
          }`}
        >
          {!item.isTestnet && <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-warning" aria-hidden />}
          {item.label}
        </button>
      ))}
    </div>
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

  const toggleCollapsed = () => {
    setIsCollapsed((prev) => {
      const next = !prev
      localStorage.setItem(COLLAPSE_STORAGE_KEY, next ? '1' : '0')
      return next
    })
  }

  const liveProducts = PRODUCTS.filter((item) => item.path)
  const soonProducts = PRODUCTS.filter((item) => !item.path)

  return (
    <div className="flex min-h-screen bg-canvas text-ink">
      {isMobileOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/60 md:hidden"
          aria-hidden="true"
          onClick={() => setIsMobileOpen(false)}
        />
      )}

      <aside
        className={`fixed inset-y-0 left-0 z-40 flex w-60 shrink-0 flex-col border-r border-border bg-canvas transition-transform duration-200 ease-out md:static md:translate-x-0 md:transition-[width] ${
          isMobileOpen ? 'translate-x-0' : '-translate-x-full'
        } ${isCollapsed ? 'md:w-16' : 'md:w-60'}`}
      >
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-4">
          {!isCollapsed && (
            <Link to="/" className="font-display text-sm font-semibold tracking-tight text-ink">
              NewCodeLaunch
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
          <button
            type="button"
            onClick={() => setIsMobileOpen(false)}
            aria-label="Close menu"
            className="rounded-md p-1 text-ink-faint hover:bg-surface-hover hover:text-ink md:hidden"
          >
            <IconArrowRight className="h-4 w-4 rotate-180" />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 px-2 py-3">
          <NavLink
            to="/dashboard"
            title={isCollapsed ? 'Dashboard' : undefined}
            className={sidebarLinkClassName}
            onClick={() => setIsMobileOpen(false)}
          >
            <IconGrid className="h-4 w-4 shrink-0" />
            {!isCollapsed && <span>Dashboard</span>}
          </NavLink>
          <div className="my-2 border-t border-border" />
          {liveProducts.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.path}
                to={item.path!}
                title={isCollapsed ? item.label : undefined}
                className={sidebarLinkClassName}
                onClick={() => setIsMobileOpen(false)}
              >
                {Icon && <Icon className="h-4 w-4 shrink-0" />}
                {!isCollapsed && <span>{item.label}</span>}
              </NavLink>
            )
          })}
        </nav>

        {!isCollapsed && (
          <div className="space-y-0.5 border-t border-border px-2 py-3">
            {soonProducts.map((item) => (
              <div key={item.label} className="flex items-center justify-between rounded-md px-2.5 py-2 text-sm text-ink-faint">
                <span>{item.label}</span>
                <Badge tone="neutral">Soon</Badge>
              </div>
            ))}
          </div>
        )}
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex flex-wrap items-center justify-end gap-3 border-b border-border px-4 py-3 sm:px-6">
          <button
            type="button"
            onClick={() => setIsMobileOpen(true)}
            aria-label="Open menu"
            className="mr-auto rounded-md p-1.5 text-ink-faint hover:bg-surface-hover hover:text-ink md:hidden"
          >
            <IconGrid className="h-5 w-5" />
          </button>
          {NETWORK_AWARE_PATHS.has(location.pathname) && <NetworkSelector />}
          <WalletConnect />
        </header>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
