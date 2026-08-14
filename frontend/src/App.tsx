import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'

import { AppShell } from './components/layout/AppShell'
import { MarketingLayout } from './components/layout/MarketingLayout'
import { ContractsPage } from './features/contracts/ContractsPage'
import { HomePage } from './features/marketing/HomePage'
import { NFTGeneratorPage } from './features/nft/NFTGeneratorPage'
import { TokenLaunchpadPage } from './features/tokens/TokenLaunchpadPage'

// Not-yet-built features get an honest placeholder route rather than a 404
// or a link that goes nowhere. Nothing in the nav or sidebar links to these
// anymore (both show a "Soon" badge instead) — these routes only matter if
// someone hits the URL directly.
const COMING_SOON_ROUTES = [
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
    <>
      <ScrollToHash />
      <Routes>
        <Route element={<MarketingLayout />}>
          <Route path="/" element={<HomePage />} />
          {COMING_SOON_ROUTES.map((item) => (
            <Route key={item.path} path={item.path} element={<ComingSoon title={item.label} />} />
          ))}
        </Route>
        <Route element={<AppShell />}>
          <Route path="/contracts" element={<ContractsPage />} />
          <Route path="/tokens" element={<TokenLaunchpadPage />} />
          <Route path="/nft" element={<NFTGeneratorPage />} />
        </Route>
      </Routes>
    </>
  )
}
