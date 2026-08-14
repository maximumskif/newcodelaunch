import { NavLink, Route, Routes } from 'react-router-dom'

import { WalletConnect } from './features/auth/WalletConnect'
import { ContractsPage } from './features/contracts/ContractsPage'
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
      <h1 className="text-2xl font-semibold">{title}</h1>
      <p className="mt-2 text-white/60">Scaffolded — real functionality lands in a later phase of the rebuild.</p>
    </div>
  )
}

function Home() {
  return (
    <div className="p-8">
      <h1 className="text-2xl font-semibold">NoCode Launchpad</h1>
      <p className="mt-2 text-white/60">
        Phase 1 scaffold. Connect a wallet above to authenticate against the new backend, or check the Smart
        Contracts Hub for live chain status.
      </p>
    </div>
  )
}

export default function App() {
  return (
    <div className="min-h-screen bg-black text-white">
      <header className="flex flex-wrap items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
        <nav className="flex flex-wrap items-center gap-4 text-sm text-white/70">
          <NavLink to="/" className="font-semibold text-white">
            NoCode Launchpad
          </NavLink>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              className={({ isActive }) => (isActive ? 'text-purple-400' : 'hover:text-white')}
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <WalletConnect />
      </header>
      <main>
        <Routes>
          <Route path="/" element={<Home />} />
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
