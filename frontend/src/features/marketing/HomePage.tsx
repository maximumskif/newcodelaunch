import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { Badge } from '../../components/ui/Badge'
import { buttonClassName } from '../../components/ui/Button'
import { IconArrowRight, IconCheck, IconCode, IconCoin, IconLayers, IconShield, IconWallet } from '../../components/ui/icons'

// Every claim on this page maps to something that actually works today
// (see docs/REBUILD_PROGRESS.md). Nothing here is aspirational copy — the
// old app's homepage claimed "world's most advanced platform" for features
// that were partly `random.randint()`; this one only says what's true.

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

export function HomePage() {
  return (
    <div>
      <section className="border-b border-border px-6 py-20 sm:py-28">
        <div className="mx-auto max-w-3xl text-center">
          <Badge tone="neutral">Early build — see what's real below</Badge>
          <h1 className="mt-5 text-4xl font-semibold tracking-tight text-ink sm:text-5xl">
            Launch Web3 projects without writing smart contracts.
          </h1>
          <p className="mx-auto mt-4 max-w-xl text-ink-muted">
            Configure a token or NFT collection through a guided interface, review a real gas estimate, and deploy
            with your own connected wallet. Nothing is signed on our servers.
          </p>
          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link to="/tokens" className={buttonClassName('primary', 'md', 'px-5 py-2.5 text-base')}>
              Create a Project
              <IconArrowRight className="h-4 w-4" />
            </Link>
            <Link to="/contracts" className={buttonClassName('secondary', 'md', 'px-5 py-2.5 text-base')}>
              View Live Chain Status
            </Link>
          </div>
        </div>
      </section>

      <section id="start-here" className="scroll-mt-20 px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-xl font-semibold text-ink">Start here</h2>
          <p className="mt-1 text-sm text-ink-muted">All four of these are real, working flows.</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {CREATION_PATHS.map((path) => {
              const content = (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-ink-faint">{path.icon}</span>
                    <Badge tone={path.badge === 'live' ? 'success' : 'neutral'}>{path.badge === 'live' ? 'Live' : 'Coming soon'}</Badge>
                  </div>
                  <h3 className="mt-3 font-medium text-ink">{path.title}</h3>
                  <p className="mt-1 text-sm text-ink-muted">{path.description}</p>
                </>
              )
              return path.href ? (
                <Link
                  key={path.title}
                  to={path.href}
                  className="rounded-lg border border-border bg-surface p-5 transition-colors duration-150 hover:border-border-strong hover:bg-surface-hover"
                >
                  {content}
                </Link>
              ) : (
                <div key={path.title} className="cursor-not-allowed rounded-lg border border-border bg-surface p-5 opacity-60">
                  {content}
                </div>
              )
            })}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-20 border-t border-border px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-xl font-semibold text-ink">How it works today</h2>
          <div className="mt-6 grid gap-4 sm:grid-cols-5">
            {HOW_IT_WORKS.map((step, index) => (
              <div key={step.title}>
                <span className="flex h-7 w-7 items-center justify-center rounded-full bg-accent-600 text-xs font-semibold text-white">
                  {index + 1}
                </span>
                <h3 className="mt-2 text-sm font-medium text-ink">{step.title}</h3>
                <p className="mt-1 text-xs text-ink-muted">{step.description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="border-t border-border px-6 py-16">
        <div className="mx-auto max-w-5xl">
          <h2 className="text-xl font-semibold text-ink">Security & transparency</h2>
          <div className="mt-6 grid gap-6 sm:grid-cols-2">
            {SECURITY_POINTS.map((point) => (
              <div key={point.title} className="flex gap-3">
                <span className="mt-0.5 text-accent-400">{point.icon}</span>
                <div>
                  <h3 className="text-sm font-medium text-ink">{point.title}</h3>
                  <p className="mt-1 text-sm text-ink-muted">{point.description}</p>
                </div>
              </div>
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
