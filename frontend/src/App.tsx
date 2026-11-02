import { useEffect } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'

import { AppShell } from './components/layout/AppShell'
import { PublicLayout } from './components/layout/PublicLayout'
import { MarketingLayout } from './components/layout/MarketingLayout'
import { HomePage } from './features/marketing/HomePage'
import { AllToolsPage } from './features/pillars/AllToolsPage'
import { PillarHubPage } from './features/pillars/PillarHubPage'
import { lazyPage } from './lib/lazyPage'
import { LEGACY_REDIRECTS, PILLARS } from './lib/pillars'

// Pages load when first visited (lib/lazyPage.ts); the landing page and the
// light hub pages stay in the main bundle so they paint at once.
const ContractsPage = lazyPage(() => import('./features/contracts/ContractsPage').then((m) => m.ContractsPage))
const DefiScannerPage = lazyPage(() => import('./features/market/DefiScannerPage').then((m) => m.DefiScannerPage))
const MarketIntelligencePage = lazyPage(() => import('./features/market/MarketIntelligencePage').then((m) => m.MarketIntelligencePage))
const TemplateMarketplacePage = lazyPage(() => import('./features/marketplace/TemplateMarketplacePage').then((m) => m.TemplateMarketplacePage))
const MintBuyPage = lazyPage(() => import('./features/mint/MintBuyPage').then((m) => m.MintBuyPage))
const TokenPage = lazyPage(() => import('./features/tokens/TokenPage').then((m) => m.TokenPage))
const MintLaunchPage = lazyPage(() => import('./features/mint/MintLaunchPage').then((m) => m.MintLaunchPage))
const NftEvmDeployPage = lazyPage(() => import('./features/nft/NftEvmDeployPage').then((m) => m.NftEvmDeployPage))
const NFTGeneratorPage = lazyPage(() => import('./features/nft/NFTGeneratorPage').then((m) => m.NFTGeneratorPage))
const NewProjectWizard = lazyPage(() => import('./features/projects/NewProjectWizard').then((m) => m.NewProjectWizard))
const ProjectsDashboard = lazyPage(() => import('./features/projects/ProjectsDashboard').then((m) => m.ProjectsDashboard))
const TokenLaunchpadPage = lazyPage(() => import('./features/tokens/TokenLaunchpadPage').then((m) => m.TokenLaunchpadPage))
const TokenCheckerPage = lazyPage(() => import('./features/research/TokenCheckerPage').then((m) => m.TokenCheckerPage))
const AirdropPage = lazyPage(() => import('./features/distribute/AirdropPage').then((m) => m.AirdropPage))
const HolderSnapshotPage = lazyPage(() => import('./features/distribute/HolderSnapshotPage').then((m) => m.HolderSnapshotPage))
const VestingPage = lazyPage(() => import('./features/distribute/VestingPage').then((m) => m.VestingPage))
const BurnPage = lazyPage(() => import('./features/tokens/BurnPage').then((m) => m.BurnPage))
const CurveLaunchPage = lazyPage(() => import('./features/tokens/CurveLaunchPage').then((m) => m.CurveLaunchPage))
const LaunchesPage = lazyPage(() => import('./features/tokens/LaunchesPage').then((m) => m.LaunchesPage))

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
          <Route path="/research/check" element={<TokenCheckerPage />} />
          <Route path="/liquidity/airdrop" element={<AirdropPage />} />
          <Route path="/tokens/burn" element={<BurnPage />} />
          <Route path="/tokens/curve" element={<CurveLaunchPage />} />
          <Route path="/liquidity/snapshot" element={<HolderSnapshotPage />} />
          <Route path="/liquidity/vesting" element={<VestingPage />} />
          {Object.entries(LEGACY_REDIRECTS).map(([from, to]) => (
            <Route key={from} path={from} element={<Redirect to={to} />} />
          ))}
        </Route>
        <Route element={<PublicLayout />}>
          <Route path="/mint/buy/:candyMachineId" element={<MintBuyPage />} />
          <Route path="/token/:network/:address" element={<TokenPage />} />
          <Route path="/launches" element={<LaunchesPage />} />
        </Route>
      </Routes>
    </>
  )
}
