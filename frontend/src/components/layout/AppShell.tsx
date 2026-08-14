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
    <div className="flex items-center gap-0.5 rounded-md border border-border p-0.5 text-xs">
      {EVM_NETWORKS.map((item) => (
        <button
          key={item.id}
          type="button"
          onClick={() => setNetwork(item.id)}
          className={`rounded px-2 py-1 transition-colors duration-150 ${
            network === item.id ? 'bg-accent-500/10 text-ink' : 'text-ink-muted hover:text-ink'
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

// Wraps the live product pages (tokens/nft/contracts/dashboard) with a
// persistent sidebar + top bar, distinct from the marketing site's top nav.
export function AppShell() {
  const location = useLocation()
  const [isCollapsed, setIsCollapsed] = useState(() => localStorage.getItem(COLLAPSE_STORAGE_KEY) === '1')

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
      <aside className={`flex shrink-0 flex-col border-r border-border transition-[width] duration-150 ${isCollapsed ? 'w-16' : 'w-60'}`}>
        <div className="flex items-center justify-between gap-2 border-b border-border px-4 py-4">
          {!isCollapsed && (
            <Link to="/" className="text-sm font-semibold text-ink">
              NewCodeLaunch
            </Link>
          )}
          <button
            type="button"
            onClick={toggleCollapsed}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            className="rounded-md p-1 text-ink-faint hover:bg-surface-hover hover:text-ink"
          >
            <IconArrowRight className={`h-4 w-4 transition-transform duration-150 ${isCollapsed ? '' : 'rotate-180'}`} />
          </button>
        </div>

        <nav className="flex-1 space-y-0.5 px-2 py-3">
          <NavLink
            to="/dashboard"
            title={isCollapsed ? 'Dashboard' : undefined}
            className={({ isActive }) =>
              `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ${
                isActive ? 'bg-accent-500/10 text-ink' : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
              }`
            }
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
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-md px-2.5 py-2 text-sm ${
                    isActive ? 'bg-accent-500/10 text-ink' : 'text-ink-muted hover:bg-surface-hover hover:text-ink'
                  }`
                }
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

      <div className="flex flex-1 flex-col">
        <header className="flex items-center justify-end gap-3 border-b border-border px-6 py-3">
          {NETWORK_AWARE_PATHS.has(location.pathname) && <NetworkSelector />}
          <WalletConnect />
        </header>
        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
