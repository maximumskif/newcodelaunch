import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'

import { AppShell } from './components/layout/AppShell'
import { MarketingLayout } from './components/layout/MarketingLayout'
import { ContractsPage } from './features/contracts/ContractsPage'
import { HomePage } from './features/marketing/HomePage'
import { DefiScannerPage } from './features/market/DefiScannerPage'
import { MarketIntelligencePage } from './features/market/MarketIntelligencePage'
import { TemplateMarketplacePage } from './features/marketplace/TemplateMarketplacePage'
import { MintLaunchPage } from './features/mint/MintLaunchPage'
import { NFTGeneratorPage } from './features/nft/NFTGeneratorPage'
import { NewProjectWizard } from './features/projects/NewProjectWizard'
import { ProjectsDashboard } from './features/projects/ProjectsDashboard'
import { TokenLaunchpadPage } from './features/tokens/TokenLaunchpadPage'

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
          <Route path="/contracts" element={<ContractsPage />} />
          <Route path="/tokens" element={<TokenLaunchpadPage />} />
          <Route path="/nft" element={<NFTGeneratorPage />} />
          <Route path="/market" element={<MarketIntelligencePage />} />
          <Route path="/defi" element={<DefiScannerPage />} />
          <Route path="/marketplace" element={<TemplateMarketplacePage />} />
          <Route path="/mint" element={<MintLaunchPage />} />
        </Route>
      </Routes>
    </>
  )
}
