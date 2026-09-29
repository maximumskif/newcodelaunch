import { Link, NavLink } from 'react-router-dom'

import { WalletConnect } from '../../features/auth/WalletConnect'
import { PRODUCTS, type ProductLink } from '../../lib/products'
import { Badge } from '../ui/Badge'
import { buttonClassName } from '../ui/Button'
import { Dropdown } from '../ui/Dropdown'
import { IconChevronDown } from '../ui/icons'

function ProductRow({ label, path }: ProductLink) {
  if (path) {
    return (
      <NavLink
        to={path}
        className="block rounded-md px-3 py-2 text-sm text-ink hover:bg-surface-hover"
      >
        {label}
      </NavLink>
    )
  }
  return (
    <div className="flex items-center justify-between rounded-md px-3 py-2 text-sm text-ink-faint">
      <span>{label}</span>
      <Badge tone="neutral">Soon</Badge>
    </div>
  )
}

export function Nav() {
  return (
    <header className="sticky top-0 z-30 border-b border-border bg-canvas/80 px-4 py-3 backdrop-blur-md sm:px-6">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
        <div className="flex items-center gap-6 text-sm">
          <Link to="/" className="flex items-center gap-2 font-display text-base font-semibold tracking-tight text-ink">
            <span aria-hidden className="grid h-7 w-7 place-items-center rounded-lg bg-[image:var(--gradient-accent)] text-xs text-white">N</span>
            NewCodeLaunch
          </Link>
          <nav className="hidden items-center gap-5 text-ink-muted md:flex">
            <Dropdown trigger={<><span>Products</span><IconChevronDown className="h-3.5 w-3.5" /></>}>
              {PRODUCTS.map((item) => (
                <ProductRow key={item.label} {...item} />
              ))}
            </Dropdown>
            <Link to="/#how-it-works" className="hover:text-ink">
              How It Works
            </Link>
          </nav>
        </div>
        <div className="flex items-center gap-3">
          {/* Wallet buttons on wide screens only; on smaller ones the one action is
              opening the app, where connecting happens. */}
          <div className="hidden items-center gap-3 lg:flex">
            <WalletConnect />
          </div>
          <Link to="/dashboard" className={buttonClassName('primary', 'sm')}>
            Open app
          </Link>
        </div>
      </div>
    </header>
  )
}
