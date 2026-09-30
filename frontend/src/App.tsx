import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { AppShell } from './components/layout/AppShell'
import { PublicLayout } from './components/layout/PublicLayout'
import { MarketingLayout } from './components/layout/MarketingLayout'
import { ContractsPage } from './features/contracts/ContractsPage'
import { HomePage } from './features/marketing/HomePage'
import { DefiScannerPage } from './features/market/DefiScannerPage'
import { MarketIntelligencePage } from './features/market/MarketIntelligencePage'
import { TemplateMarketplacePage } from './features/marketplace/TemplateMarketplacePage'
import { MintBuyPage } from './features/mint/MintBuyPage'
import { TokenPage } from './features/tokens/TokenPage'
import { MintLaunchPage } from './features/mint/MintLaunchPage'
import { NftEvmDeployPage } from './features/nft/NftEvmDeployPage'
import { NFTGeneratorPage } from './features/nft/NFTGeneratorPage'
import { NewProjectWizard } from './features/projects/NewProjectWizard'
import { ProjectsDashboard } from './features/projects/ProjectsDashboard'
import { TokenLaunchpadPage } from './features/tokens/TokenLaunchpadPage'
import { AllToolsPage } from './features/pillars/AllToolsPage'
import { PillarHubPage } from './features/pillars/PillarHubPage'
import { LEGACY_REDIRECTS, PILLARS } from './lib/pillars'

// react-router's BrowserRouter doesn't scroll to `#hash` targets on its own —
// this is what makes the nav's "How It Works" link land
// on the right homepage section instead of just changing the URL.
function ScrollToHash() {
  const { hash, pathname } = useLocation()
  useEffect(() => {
    if (!hash) return
    // Targets like #history render after their data loads, so keep looking
    // for a couple of seconds instead of giving up on the first frame.
    let tries = 0
    const timer = setInterval(() => {
      const element = document.getElementById(hash.slice(1))
      if (element || ++tries > 20) {
        clearInterval(timer)
        element?.scrollIntoView({ behavior: 'smooth' })
      }
    }, 100)
    return () => clearInterval(timer)
  }, [hash, pathname])
  return null
}

// An old URL, redirected with its query string and hash kept.
function Redirect({ to }: { to: string }) {
  const { search, hash } = useLocation()
  return <Navigate replace to={`${to}${search}${hash}`} />
}

export default function App() {
  return (
    <>
      <ScrollToHash />
      <Routes>
        <Route element={<MarketingLayout />}>
          <Route path="/" element={<HomePage />} />
        </Route>
        <Route element={<AppShell />}>
          <Route path="/dashboard" element={<ProjectsDashboard />} />
          <Route path="/projects/new" element={<NewProjectWizard />} />
          <Route path="/tools" element={<AllToolsPage />} />
          {PILLARS.map((pillar) => (
            <Route key={pillar.id} path={pillar.path} element={<PillarHubPage pillarId={pillar.id} />} />
          ))}
          <Route path="/tokens/create" element={<TokenLaunchpadPage />} />
          <Route path="/nfts/generator" element={<NFTGeneratorPage />} />
          <Route path="/nfts/deploy-evm" element={<NftEvmDeployPage />} />
          <Route path="/contracts/deploy" element={<ContractsPage />} />
          <Route path="/contracts/templates" element={<TemplateMarketplacePage />} />
          <Route path="/drops/launch" element={<MintLaunchPage />} />
          <Route path="/research/market" element={<MarketIntelligencePage />} />
          <Route path="/research/defi" element={<DefiScannerPage />} />
          {Object.entries(LEGACY_REDIRECTS).map(([from, to]) => (
            <Route key={from} path={from} element={<Redirect to={to} />} />
          ))}
        </Route>
        <Route element={<PublicLayout />}>
          <Route path="/mint/buy/:candyMachineId" element={<MintBuyPage />} />
          <Route path="/token/:network/:address" element={<TokenPage />} />
        </Route>
      </Routes>
    </>
  )
}
