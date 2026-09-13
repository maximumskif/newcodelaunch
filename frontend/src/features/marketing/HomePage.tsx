import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '../../components/ui/Badge'
import { buttonClassName } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { IconArrowRight, IconCheck, IconCode, IconCoin, IconLayers, IconShield, IconWallet } from '../../components/ui/icons'

// Every claim on this page maps to something that actually works today
// (see docs/REBUILD_PROGRESS.md). Nothing here is aspirational copy — the
// old app's homepage claimed "world's most advanced platform" for features
// that were partly `random.randint()`; this one only says what's true.
//
// 2026-09 design refresh: visual presentation only — every heading,
// description, badge state, and link target below is byte-for-byte the same
// claim this page already made; nothing here is new or exaggerated copy.

interface CreationPath {
  icon: ReactNode
  title: string
  description: string
  href?: string
  badge: 'live' | 'soon'
}

const CREATION_PATHS: CreationPath[] = [
  {
    icon: <IconCoin />,
    title: 'Launch a Token',
    description: 'Compile a real ERC-20 template, estimate gas, and deploy with your own connected wallet.',
    href: '/tokens',
    badge: 'live',
  },
  {
    icon: <IconLayers />,
    title: 'Build an NFT Collection',
    description: 'Upload trait layers, set rarity weights, composite a real collection, and publish to IPFS.',
    href: '/nft',
    badge: 'live',
  },
  {
    icon: <IconCode />,
    title: 'Smart Contracts Hub',
    description: 'Live network status plus compile/estimate/deploy across every supported template.',
    href: '/contracts',
    badge: 'live',
  },
  {
    icon: <IconLayers />,
    title: 'Mint Site',
    description: 'Launch a real Solana Candy Machine from a published collection, with a shareable public mint page.',
    href: '/mint',
    badge: 'live',
  },
]

const HOW_IT_WORKS = [
  { title: 'Pick what to build', description: 'A token or an NFT collection — each has its own guided form.' },
  { title: 'Configure it', description: 'Name, supply, layers, rarity — whatever the project type needs.' },
  { title: 'Review the real cost', description: 'A live gas estimate from the network, before you commit to anything.' },
  { title: 'Deploy with your wallet', description: 'Your wallet signs and broadcasts. Nothing is ever signed on our servers.' },
  { title: 'Track it', description: 'Deployments and generated collections persist so you can find them again.' },
]

const SECURITY_POINTS = [
  {
    icon: <IconWallet />,
    title: 'Your wallet, your keys',
    description: 'We never receive, log, or store a private key or seed phrase — not once, not ever.',
  },
  {
    icon: <IconShield />,
    title: 'Client-side signing only',
    description: 'The backend compiles and estimates. Your connected wallet is what actually signs and broadcasts.',
  },
  {
    icon: <IconCode />,
    title: 'Contract source is visible',
    description: "Every deployment template's Solidity source is real and inspectable before you deploy it.",
  },
  {
    icon: <IconCheck />,
    title: 'Live network status',
    description: 'See whether a network is actually reachable before you commit to deploying on it.',
  },
]

const SUPPORTED_NETWORKS = ['Ethereum', 'Polygon', 'BSC', 'Solana']

export function HomePage() {
  return (
    <div>
      {/* A faint fixed dot-grid, not a moving/blurred gradient blob — texture
          without the "giant glow" look this project's own design pass
          already corrected away from once. Pure decoration: aria-hidden,
          and the hero's real content underneath needs no adjustment for it. */}
      <section className="relative overflow-hidden border-b border-border px-6 py-24 sm:py-32">
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(color-mix(in_oklab,white_10%,transparent)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_0%,black_40%,transparent_100%)]"
        />
        <div className="relative mx-auto max-w-3xl text-center">
          <Badge tone="neutral">Early build — see what's real below</Badge>
          <h1 className="mt-6 text-5xl font-semibold tracking-tight text-ink sm:text-6xl">
            Launch Web3 projects without writing smart contracts.
          </h1>
          <p className="mx-auto mt-5 max-w-xl text-base text-ink-muted sm:text-lg">
            Configure a token or NFT collection through a guided interface, review a real gas estimate, and deploy
            with your own connected wallet. Nothing is signed on our servers.
          </p>
          <div className="mt-9 flex flex-wrap items-center justify-center gap-3">
            <Link to="/tokens" className={buttonClassName('primary', 'md', 'px-6 py-3 text-base')}>
              Create a Project
              <IconArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/contracts" className={buttonClassName('secondary', 'md', 'px-6 py-3 text-base')}>
              View Live Chain Status
            </Link>
          </div>
          <div className="mt-12 flex flex-wrap items-center justify-center gap-x-6 gap-y-2 text-xs text-ink-faint">
            <span className="uppercase tracking-widest">Supported networks</span>
            <div className="flex flex-wrap items-center justify-center gap-2">
              {SUPPORTED_NETWORKS.map((network) => (
                <span key={network} className="rounded-full border border-border px-3 py-1 text-ink-muted">
                  {network}
                </span>
              ))}
            </div>
          </div>
        </div>
      </section>

      <section id="start-here" className="scroll-mt-20 px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-semibold text-ink">Start here</h2>
          <p className="mt-1 text-sm text-ink-muted">All four of these are real, working flows.</p>
          <div className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CREATION_PATHS.map((path) => {
              const content = (
                <>
                  <div className="flex items-center justify-between">
                    <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-accent-500/10 text-accent-400">
                      {path.icon}
                    </span>
                    <Badge tone={path.badge === 'live' ? 'success' : 'neutral'}>{path.badge === 'live' ? 'Live' : 'Coming soon'}</Badge>
                  </div>
                  <h3 className="mt-4 font-display font-medium text-ink">{path.title}</h3>
                  <p className="mt-1.5 text-sm text-ink-muted">{path.description}</p>
                </>
              )
              return path.href ? (
                <Link key={path.title} to={path.href}>
                  <Card interactive padding="lg" rounded="xl" className="h-full">
                    {content}
                  </Card>
                </Link>
              ) : (
                <Card key={path.title} padding="lg" rounded="xl" className="h-full cursor-not-allowed opacity-60">
                  {content}
                </Card>
              )
            })}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-20 border-t border-border px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-semibold text-ink">How it works today</h2>
          <div className="relative mt-10 grid gap-8 sm:grid-cols-5">
            {/* A connecting line behind the numbered steps — desktop only
                (sm:grid-cols-5 already stacks to one column below that
                breakpoint, where a horizontal line wouldn't track the steps). */}
            <div className="absolute top-4 right-0 left-0 hidden h-px bg-border sm:block" aria-hidden="true" />
            {HOW_IT_WORKS.map((step, index) => (
              <div key={step.title} className="relative">
                <span className="relative flex h-8 w-8 items-center justify-center rounded-full bg-accent-600 text-xs font-semibold text-white ring-4 ring-canvas">
                  {index + 1}
                </span>
                <h3 className="mt-3 text-sm font-medium text-ink">{step.title}</h3>
                <p className="mt-1 text-xs text-ink-muted">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border px-6 py-20">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-2xl font-semibold text-ink">Security & transparency</h2>
          <div className="mt-8 grid gap-4 sm:grid-cols-2">
            {SECURITY_POINTS.map((point) => (
              <Card key={point.title} padding="md" className="flex gap-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-accent-500/10 text-accent-400">
                  {point.icon}
                </span>
                <div>
                  <h3 className="text-sm font-medium text-ink">{point.title}</h3>
                  <p className="mt-1 text-sm text-ink-muted">{point.description}</p>
                </div>
              </Card>
            ))}
          </div>
        </div>
      </section>

      <footer className="border-t border-border px-6 py-8">
        <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3 text-sm text-ink-faint">
          <span>NewCodeLaunch — early build, not production software yet.</span>
          <span>Supported networks: Ethereum, Polygon, BSC, Solana</span>
        </div>
      </footer>
    </div>
  )
}
