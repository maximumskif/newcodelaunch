import { NavLink, Route, Routes } from 'react-router-dom'

import { WalletConnect } from './features/auth/WalletConnect'
import { ContractsPage } from './features/contracts/ContractsPage'
import { HomePage } from './features/marketing/HomePage'
import { NFTGeneratorPage } from './features/nft/NFTGeneratorPage'
import { TokenLaunchpadPage } from './features/tokens/TokenLaunchpadPage'

const NAV_ITEMS = [
  { path: '/tokens', label: 'Token Launchpad' },
  { path: '/nft', label: 'NFT Generator' },
  { path: '/contracts', label: 'Smart Contracts Hub' },
  { path: '/defi', label: 'DeFi Scanner' },
  { path: '/market', label: 'Market Intelligence' },
  { path: '/marketplace', label: 'Template Marketplace' },
  { path: '/mint', label: 'Candy Machine' },
]

function ComingSoon({ title }: { title: string }) {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold text-ink">{title}</h1>
      <p className="mt-2 text-ink-muted">Not built yet — see docs/REBUILD_PROGRESS.md for real status.</p>
    </div>
  )
}

export default function App() {
  return (
    <div className="min-h-screen bg-canvas text-ink">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-border px-6 py-4">
        <nav className="flex flex-wrap items-center gap-4 text-sm text-ink-muted">
          <NavLink to="/" className="font-semibold text-ink">
            NewCodeLaunch
          </NavLink>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => (isActive ? 'text-accent-400' : 'hover:text-ink')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <WalletConnect />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/contracts" element={<ContractsPage />} />
          <Route path="/tokens" element={<TokenLaunchpadPage />} />
          <Route path="/nft" element={<NFTGeneratorPage />} />
          {NAV_ITEMS.filter((item) => !['/contracts', '/tokens', '/nft'].includes(item.path)).map((item) => (
            <Route key={item.path} path={item.path} element={<ComingSoon title={item.label} />} />
          ))}
        </Routes>
      </main>
    </div>
  )
}
