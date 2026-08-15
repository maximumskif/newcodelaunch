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
    <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
      <div className="flex flex-wrap items-center gap-6 text-sm">
        <Link to="/" className="font-semibold text-ink">
          NewCodeLaunch
        </Link>
        <nav className="flex flex-wrap items-center gap-5 text-ink-muted">
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
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/#start-here" className={buttonClassName('secondary', 'sm')}>
          Start Building
        </Link>
        <WalletConnect />
      </div>
    </header>
  )
}
