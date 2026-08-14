import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'

import { Nav } from './components/layout/Nav'
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

// react-router's BrowserRouter doesn't scroll to `#hash` targets on its own —
// this is what makes the nav's "How It Works" / "Start Building" links land
// on the right homepage section instead of just changing the URL.
function ScrollToHash() {
  const { hash } = useLocation()
  useEffect(() => {
    if (!hash) return
    const element = document.getElementById(hash.slice(1))
    element?.scrollIntoView({ behavior: 'smooth' })
  }, [hash])
  return null
}

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
      <ScrollToHash />
      <Nav />
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
