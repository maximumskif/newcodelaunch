import type { ComponentType } from 'react'
import { Link } from 'react-router-dom'

import { buttonClassName } from '../../components/ui/Button'
import {
  IconArrowRight,
  IconCandy,
  IconChart,
  IconCheck,
  IconCode,
  IconCoin,
  IconLayers,
  IconLock,
  IconShield,
  IconWallet,
} from '../../components/ui/icons'

// Every claim on this page maps to something that works today (see
// docs/REBUILD_PROGRESS.md) — the old app's homepage claimed "world's most
// advanced platform" for features that were partly `random.randint()`;
// this one only says what's true. The hero's preview card is labelled as an
// example: it shows what a real public token page reports, not a real token.

type Icon = ComponentType<{ className?: string }>

interface Product {
  icon: Icon
  title: string
  description: string
  points: string[]
  href: string
}

const PRODUCTS: Product[] = [
  {
    icon: IconCoin,
    title: 'Token Launchpad',
    description: 'ERC-20s on Ethereum, Polygon and BSC, or SPL tokens on Solana.',
    points: ['Taxes, limits and a trading switch', 'Revoke mint & freeze authority', 'Source verified on the explorer'],
    href: '/tokens',
  },
  {
    icon: IconLayers,
    title: 'NFT Generator',
    description: 'Stack trait layers and generate a unique collection from your art.',
    points: ['Rarity weights and trait rules', 'Up to 10,000 items', 'Publish to IPFS in one click'],
    href: '/nft',
  },
  {
    icon: IconCandy,
    title: 'Candy Machine drops',
    description: 'Sell a collection on Solana with a shareable mint page.',
    points: ['Allowlist and public phases', 'Per-wallet mint limits', 'Live sales dashboard'],
    href: '/mint',
  },
  {
    icon: IconLock,
    title: 'Liquidity & locks',
    description: 'Open a pool for your token and lock the LP to earn trust.',
    points: ['Uniswap, PancakeSwap and Raydium', 'Time-locks with no admin key', 'Permanent Raydium locks'],
    href: '/tokens',
  },
  {
    icon: IconShield,
    title: 'Public token pages',
    description: 'A page buyers can check, read straight from the chain.',
    points: ['Supply, authorities and taxes', 'How much liquidity is locked', 'Code matched against the template'],
    href: '/tokens',
  },
  {
    icon: IconChart,
    title: 'Market Intelligence',
    description: 'Look up any token and see what is moving across DEXes.',
    points: ['Any address, any chain', 'Trending DEX tokens', 'Top tokens by market cap'],
    href: '/market',
  },
]

const FACTS: [string, string][] = [
  ['8', 'networks, mainnet and testnet'],
  ['4', 'contract templates, plus SPL tokens'],
  ['0', 'private keys ever sent to us'],
  ['100%', 'of transactions signed in your wallet'],
]

const STEPS = [
  { title: 'Configure', description: 'Pick a token, collection or contract and fill in a guided form — no Solidity required.' },
  { title: 'Check the cost', description: 'See a live estimate from the network and exactly what will be deployed before you commit.' },
  { title: 'Sign & launch', description: 'Your own wallet signs and broadcasts. We compile and verify; we never hold keys.' },
]

const SECURITY_POINTS: { icon: Icon; title: string; description: string }[] = [
  { icon: IconWallet, title: 'Your wallet, your keys', description: 'We never receive, log, or store a private key or seed phrase.' },
  { icon: IconShield, title: 'Client-side signing only', description: 'The backend compiles and estimates; your wallet signs and broadcasts.' },
  { icon: IconCode, title: 'Readable contract source', description: 'Every template is real Solidity you can inspect, and verify on the explorer.' },
  { icon: IconCheck, title: 'Checked on-chain', description: 'Deployments are only recorded after the backend reads them back from the chain.' },
]

const EXAMPLE_CHECKS: [string, string][] = [
  ['Supply is fixed', 'Mint authority revoked'],
  ['Can’t freeze wallets', 'Freeze authority revoked'],
  ['62% of liquidity locked', 'Permanently, via Raydium'],
  ['Pool on Raydium', 'Price read from the pool'],
]

// What a public token page reports — an illustrative example, labelled so.
function HeroPreview() {
  return (
    <figure className="relative mx-auto w-full max-w-md">
      <div aria-hidden className="absolute -inset-6 rounded-[2rem] bg-[image:var(--gradient-accent)] opacity-20 blur-3xl" />
      <div className="relative rounded-2xl border border-border-strong bg-[#101012]/90 p-5 shadow-elevated backdrop-blur">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <span aria-hidden className="grid h-10 w-10 place-items-center rounded-full bg-[image:var(--gradient-accent)] font-display font-semibold text-white">
              N
            </span>
            <div>
              <p className="font-medium text-ink">Nova Token</p>
              <p className="font-mono text-xs text-ink-faint">NOVA · Solana</p>
            </div>
          </div>
          <span className="rounded-full border border-border px-2.5 py-0.5 text-[11px] text-ink-faint">Example</span>
        </div>
        <div className="mt-5 grid grid-cols-3 gap-2 text-center">
          {[
            ['Price', '$0.0142'],
            ['Liquidity', '$48.2K'],
            ['Supply', '1B'],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-border bg-canvas px-2 py-2.5">
              <p className="text-[11px] text-ink-faint">{label}</p>
              <p className="mt-0.5 font-mono text-sm text-ink">{value}</p>
            </div>
          ))}
        </div>
        <ul className="mt-4 space-y-2">
          {EXAMPLE_CHECKS.map(([title, detail]) => (
            <li key={title} className="flex items-center gap-3 rounded-lg bg-surface px-3 py-2.5">
              <span className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-success/15 text-success">
                <IconCheck className="h-3.5 w-3.5" />
              </span>
              <div className="min-w-0">
                <p className="text-sm text-ink">{title}</p>
                <p className="text-xs text-ink-faint">{detail}</p>
              </div>
            </li>
          ))}
        </ul>
      </div>
      <figcaption className="relative mt-4 text-center text-xs text-ink-faint">
        An example public token page — every token launched here gets one, read from the chain.
      </figcaption>
    </figure>
  )
}

export function HomePage() {
  return (
    <div>
      {/* Atmosphere behind the hero: two slow, low-opacity radial gradients
          plus a masked dot grid — aria-hidden, and motion is zeroed by
          index.css's prefers-reduced-motion query. */}
      <section className="relative overflow-hidden border-b border-border px-6 py-20 sm:py-28">
        <div
          aria-hidden="true"
          className="animate-gradient-pan pointer-events-none absolute inset-0 opacity-40 [background-image:radial-gradient(ellipse_60%_50%_at_20%_20%,color-mix(in_oklab,var(--color-accent-500)_28%,transparent),transparent_60%),radial-gradient(ellipse_50%_50%_at_80%_60%,color-mix(in_oklab,var(--color-accent2-500)_22%,transparent),transparent_60%)] [background-size:180%_180%]"
        />
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 [background-image:radial-gradient(color-mix(in_oklab,white_10%,transparent)_1px,transparent_1px)] [background-size:28px_28px] [mask-image:radial-gradient(ellipse_60%_60%_at_50%_0%,black_40%,transparent_100%)]"
        />
        <div className="relative mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1.1fr_1fr]">
          <div className="text-center lg:text-left">
            <span className="animate-fade-up inline-flex items-center gap-2 rounded-full border border-border bg-surface px-3 py-1 text-xs text-ink-muted">
              <span className="h-1.5 w-1.5 rounded-full bg-success" /> Live on Ethereum, Polygon, BSC and Solana
            </span>
            <h1 className="animate-fade-up mt-6 text-4xl font-semibold tracking-tight text-ink [animation-delay:80ms] sm:text-5xl lg:text-6xl">
              Launch tokens and NFTs{' '}
              <span className="bg-[image:var(--gradient-accent)] bg-clip-text text-transparent">without writing code.</span>
            </h1>
            <p className="animate-fade-up mx-auto mt-5 max-w-xl text-base text-ink-muted [animation-delay:160ms] sm:text-lg lg:mx-0">
              Create a token, generate an NFT collection, open a liquidity pool and lock it — all from guided forms, signed
              by your own wallet. Nothing is ever signed on our servers.
            </p>
            <div className="animate-fade-up mt-9 flex flex-wrap items-center justify-center gap-3 [animation-delay:240ms] lg:justify-start">
              <Link to="/tokens" className={buttonClassName('primary', 'md', 'px-6 py-3 text-base')}>
                Launch a token
                <IconArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/nft" className={buttonClassName('secondary', 'md', 'px-6 py-3 text-base')}>
                Build an NFT collection
              </Link>
            </div>
          </div>
          <div className="animate-fade-up [animation-delay:200ms]">
            <HeroPreview />
          </div>
        </div>
      </section>

      <section aria-label="At a glance" className="border-b border-border px-6 py-10">
        <dl className="mx-auto grid max-w-6xl grid-cols-2 gap-6 lg:grid-cols-4">
          {FACTS.map(([value, label]) => (
            <div key={label} className="flex flex-col-reverse text-center lg:text-left">
              <dt className="mt-1 text-sm text-ink-muted">{label}</dt>
              <dd className="font-display text-3xl font-semibold text-ink">{value}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section id="start-here" className="scroll-mt-20 px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-400">Products</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">Everything to launch, in one place</h2>
          <p className="mt-2 max-w-2xl text-ink-muted">Each of these is a working flow on real networks — try any of them on a testnet first.</p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {PRODUCTS.map(({ icon: ProductIcon, title, description, points, href }) => (
              <Link
                key={title}
                to={href}
                aria-label={title}
                className="group flex flex-col rounded-2xl border border-border bg-surface p-6 transition-all duration-200 hover:-translate-y-1 hover:border-accent-500/40 hover:bg-surface-hover"
              >
                <span className="grid h-11 w-11 place-items-center rounded-xl bg-[image:var(--gradient-accent-soft)] text-accent-300 transition-transform duration-200 group-hover:scale-110">
                  <ProductIcon className="h-5 w-5" />
                </span>
                <h3 className="mt-5 font-display text-lg font-semibold text-ink">{title}</h3>
                <p className="mt-1.5 text-sm text-ink-muted">{description}</p>
                <ul className="mt-4 space-y-1.5">
                  {points.map((point) => (
                    <li key={point} className="flex items-center gap-2 text-sm text-ink-muted">
                      <IconCheck className="h-3.5 w-3.5 shrink-0 text-accent-300" />
                      {point}
                    </li>
                  ))}
                </ul>
                <span className="mt-6 inline-flex items-center gap-1.5 text-sm font-medium text-accent-300">
                  Open <IconArrowRight className="h-3.5 w-3.5 transition-transform duration-200 group-hover:translate-x-1" />
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-20 border-t border-border px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-400">How it works</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">From idea to on-chain in three steps</h2>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {STEPS.map((step, index) => (
              <li key={step.title} className="rounded-2xl border border-border bg-surface p-6">
                <span aria-hidden className="font-display text-5xl font-semibold text-transparent [-webkit-text-stroke:1px_var(--color-border-strong)]">
                  0{index + 1}
                </span>
                <h3 className="mt-3 font-display text-lg font-semibold text-ink">{step.title}</h3>
                <p className="mt-1.5 text-sm text-ink-muted">{step.description}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      <section className="border-t border-border px-6 py-20">
        <div className="mx-auto max-w-6xl">
          <p className="text-xs font-semibold uppercase tracking-widest text-accent-400">Security</p>
          <h2 className="mt-2 text-3xl font-semibold tracking-tight text-ink">You stay in control</h2>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {SECURITY_POINTS.map(({ icon: PointIcon, title, description }) => (
              <div key={title} className="rounded-2xl border border-border bg-surface p-5">
                <span className="grid h-9 w-9 place-items-center rounded-lg bg-[image:var(--gradient-accent-soft)] text-accent-300">
                  <PointIcon className="h-4 w-4" />
                </span>
                <h3 className="mt-4 text-sm font-semibold text-ink">{title}</h3>
                <p className="mt-1 text-sm text-ink-muted">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="relative mx-auto max-w-6xl overflow-hidden rounded-3xl border border-accent-500/30 px-8 py-14 text-center">
          <div aria-hidden className="absolute inset-0 bg-[image:var(--gradient-accent)] opacity-15" />
          <div className="relative">
            <h2 className="text-3xl font-semibold tracking-tight text-ink sm:text-4xl">Ready to launch?</h2>
            <p className="mx-auto mt-3 max-w-lg text-ink-muted">Connect a wallet and try it on a testnet — it costs nothing but test tokens.</p>
            <div className="mt-8 flex flex-wrap justify-center gap-3">
              <Link to="/projects/new" className={buttonClassName('primary', 'md', 'px-6 py-3 text-base')}>
                Start a project
                <IconArrowRight className="h-4 w-4" />
              </Link>
              <Link to="/contracts" className={buttonClassName('secondary', 'md', 'px-6 py-3 text-base')}>
                View live network status
              </Link>
            </div>
          </div>
        </div>
      </section>

      <footer className="border-t border-border px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-3 text-sm text-ink-faint">
          <span>NewCodeLaunch — beta. Try things on a testnet first.</span>
          <span>Ethereum · Polygon · BSC · Solana</span>
        </div>
      </footer>
    </div>
  )
}
