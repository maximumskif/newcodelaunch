import { Link, Outlet, useLocation } from 'react-router-dom'

import { SolanaWalletButton } from '../../features/auth/SolanaWalletButton'

// Pages meant for buyers, not creators (a drop's mint page, a token's public
// page): no creator sidebar or account menu — just the brand, and a Solana
// wallet button where one is needed to mint.
export function PublicLayout() {
  const { pathname } = useLocation()
  const needsWallet = pathname.startsWith('/mint/buy/')
  return (
    <div className="flex min-h-screen flex-col bg-canvas text-ink">
      <header className="border-b border-border px-4 py-3 sm:px-6">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <Link to="/" className="flex items-center gap-2 font-display text-sm font-semibold tracking-tight text-ink">
            <span aria-hidden className="grid h-6 w-6 place-items-center rounded-md bg-[image:var(--gradient-accent)] text-xs text-white">
              N
            </span>
            NewCodeLaunch
          </Link>
          {needsWallet && <SolanaWalletButton />}
        </div>
      </header>
      <main className="flex-1">
        <Outlet />
      </main>
      <footer className="border-t border-border px-4 py-6 text-center text-xs text-ink-faint sm:px-6">
        Powered by NewCodeLaunch · Every transaction is signed in your own wallet.
      </footer>
    </div>
  )
}
