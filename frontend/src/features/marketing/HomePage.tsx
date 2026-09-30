import type { ReactNode } from 'react'
import { Link } from 'react-router-dom'

import { buttonClassName } from '../../components/ui/Button'
import { PILLARS, pillarById, type Pillar } from '../../lib/pillars'

// Every claim on this page maps to something that works today (see
// docs/REBUILD_PROGRESS.md). Previews are labelled as examples; counts come
// from lib/pillars.ts, the same list the app's menus use.

// Opens the command bar (components/layout/CommandPalette.tsx listens for
// ctrl+k on the document) from a click.
function openCommandBar() {
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', ctrlKey: true, bubbles: true }))
}

function liveCount(pillar: Pillar) {
  return pillar.tools.filter((tool) => tool.path).length
}

function PillarTile({ pillar }: { pillar: Pillar }) {
  return (
    <Link
      to={pillar.path}
      data-pillar={pillar.id}
      className="group flex flex-col gap-2.5 rounded-lg border border-border bg-surface p-4 transition-colors hover:border-accent-500/50 hover:bg-surface-hover"
    >
      <span className="flex items-center justify-between">
        <span className="flex items-center gap-2.5 font-mono text-sm font-semibold text-accent-400">
          <span aria-hidden className="grid h-8 w-8 place-items-center rounded-md bg-accent-500/15 font-bold">
            {pillar.glyph}
          </span>
          {pillar.short}
        </span>
        <span className="font-mono text-xs text-ink-faint">{liveCount(pillar)} tools</span>
      </span>
      <span className="text-sm leading-snug text-ink-muted">{pillar.tagline}</span>
    </Link>
  )
}

function Feature({ pillarId, index, children }: { pillarId: Pillar['id']; index: number; children: ReactNode }) {
  const pillar = pillarById(pillarId)
  return (
    <section data-pillar={pillar.id} className="flex flex-col overflow-hidden rounded-xl border border-border bg-surface">
      <div className="h-[3px] bg-accent-500" aria-hidden />
      <div className="flex flex-1 flex-col gap-4 p-6">
        <span className="font-mono text-sm font-semibold text-accent-400">
          0{index} · {pillar.name.toLowerCase()}
        </span>
        <h3 className="text-2xl font-bold leading-tight text-ink">{pillar.tagline}</h3>
        <p className="text-[15px] leading-relaxed text-ink-muted">{pillar.summary}</p>
        <div className="mt-auto space-y-4">
          {children}
          <Link to={pillar.path} className="inline-block font-mono text-sm text-accent-400 hover:underline">
            open {pillar.short} →
          </Link>
        </div>
      </div>
    </section>
  )
}

const NFT_TILES = [
  ['#3b1633', '#ff6ad5'], ['#16283b', '#7aa7ff'], ['#2a3b16', '#a6ff4d'], ['#3b2a16', '#ffb547'],
  ['#16353b', '#4de8ff'], ['#2b163b', '#c79bff'], ['#3b1616', '#ff8a7a'], ['#1e3b16', '#9dff8a'],
]

export function HomePage() {
  const totalTools = PILLARS.reduce((sum, pillar) => sum + liveCount(pillar), 0)
  return (
    <div>
      <section className="border-b border-border px-6 py-20 sm:py-24">
        <div className="mx-auto grid max-w-6xl items-center gap-14 lg:grid-cols-[1fr_minmax(0,560px)]">
          <div className="space-y-6">
            <p className="font-mono text-sm text-ink-faint">$ ncl --help</p>
            <h1 className="text-5xl font-bold leading-[1.05] text-ink sm:text-6xl">
              Build anything
              <br />
              on-chain.
              <span aria-hidden className="ml-2 inline-block h-[0.85em] w-[0.45em] animate-blink bg-p-tokens align-[-0.1em]" />
            </h1>
            <p className="max-w-xl text-lg leading-relaxed text-ink-muted sm:text-xl">
              Tokens, NFT collections, smart contracts, mint pages, liquidity and more — {totalTools} Web3 building tools in one place. No
              code, and every transaction signed in your own wallet.
            </p>
            <div className="flex flex-wrap gap-3">
              <Link to="/tools" className={buttonClassName('primary', 'lg')}>
                [ explore all tools ]
              </Link>
              <Link to="/tokens/create" className={buttonClassName('secondary', 'lg')}>
                create a token →
              </Link>
            </div>
            <p className="font-mono text-xs text-ink-faint">solana · ethereum · polygon · bnb chain — testnets and mainnets</p>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            {PILLARS.map((pillar) => (
              <PillarTile key={pillar.id} pillar={pillar} />
            ))}
          </div>
        </div>
      </section>

      <section id="start-here" aria-labelledby="areas-heading" className="scroll-mt-20 px-6 py-20">
        <div className="mx-auto max-w-6xl space-y-10">
          <div className="space-y-2">
            <p className="font-mono text-sm text-ink-faint">$ ls ~/</p>
            <h2 id="areas-heading" className="text-3xl font-bold text-ink">
              Everything to build and launch, in one place
            </h2>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Feature pillarId="tokens" index={1}>
              <div className="space-y-2 rounded-lg border border-border bg-canvas p-4 font-mono text-[13px]">
                <p className="flex items-center gap-2.5 text-ink">
                  <span aria-hidden className="grid h-7 w-7 place-items-center rounded-full bg-accent-500 font-bold text-canvas">N</span>
                  Nova <span className="text-ink-faint">$NOVA · example</span>
                </p>
                <p><span className="text-success">✓</span> supply fixed</p>
                <p><span className="text-success">✓</span> 62% of liquidity locked</p>
                <p><span className="text-success">✓</span> source verified</p>
              </div>
            </Feature>
            <Feature pillarId="nfts" index={2}>
              <div className="grid grid-cols-4 gap-2 rounded-lg border border-border bg-canvas p-4" aria-label="Example generated collection" role="img">
                {NFT_TILES.map(([bg, fg]) => (
                  <span key={bg} className="flex aspect-square items-end justify-center rounded-md" style={{ background: bg }}>
                    <span className="h-[55%] w-[55%] rounded-t-full rounded-b-lg" style={{ background: fg }} />
                  </span>
                ))}
              </div>
            </Feature>
            <Feature pillarId="contracts" index={3}>
              <pre className="whitespace-pre-wrap rounded-lg border border-border bg-canvas p-4 font-mono text-[12.5px] leading-relaxed text-ink-muted">
                <span className="text-accent-400">contract</span> TokenTimeLock {'{'}
                {'\n  '}
                <span className="text-ink-faint">// no owner, no early exit</span>
                {'\n  '}
                <span className="text-accent-400">function</span> release() external {'{'}
                {'\n    '}require(block.timestamp &gt;= releaseTime);
                {'\n    '}token.transfer(beneficiary, …);
                {'\n  }\n}'}
              </pre>
            </Feature>
          </div>
          <div className="grid gap-4 lg:grid-cols-3">
            <Link to="/drops" data-pillar="drops" className="space-y-3 rounded-xl border border-border bg-surface p-6 transition-colors hover:border-accent-500/50">
              <span className="font-mono text-sm font-semibold text-accent-400">04 · drops</span>
              <span className="block font-mono text-xl font-bold text-ink">Sell with a mint page</span>
              <span className="block text-sm leading-relaxed text-ink-muted">Candy Machine storefronts with allowlist phases, per-wallet limits and live sales.</span>
              <span className="block space-y-1.5 font-mono text-xs text-ink-faint">
                312 / 1,000 minted · example
                <span className="block h-1.5 overflow-hidden rounded-full bg-surface-raised">
                  <span className="block h-full w-[31%] bg-accent-500" />
                </span>
              </span>
            </Link>
            <Link to="/liquidity" data-pillar="liquidity" className="space-y-3 rounded-xl border border-border bg-surface p-6 transition-colors hover:border-accent-500/50">
              <span className="font-mono text-sm font-semibold text-accent-400">05 · liquidity &amp; distribution</span>
              <span className="block font-mono text-xl font-bold text-ink">Pools and locks</span>
              <span className="block text-sm leading-relaxed text-ink-muted">
                Uniswap, PancakeSwap and Raydium pools, and LP locks buyers can verify. Airdrops and snapshots are coming.
              </span>
              <span className="block font-mono text-xs text-accent-400">[██████████░░░░░] 62% locked · example</span>
            </Link>
            <Link to="/research" data-pillar="research" className="space-y-3 rounded-xl border border-border bg-surface p-6 transition-colors hover:border-accent-500/50">
              <span className="font-mono text-sm font-semibold text-accent-400">06 · research</span>
              <span className="block font-mono text-xl font-bold text-ink">Look up any token</span>
              <span className="block text-sm leading-relaxed text-ink-muted">
                Price, liquidity and pools for any address on any chain, what's trending on DEXes, and DeFi at a glance.
              </span>
              <span className="block font-mono text-xs text-ink-faint">$ ncl lookup &lt;address&gt;</span>
            </Link>
          </div>
        </div>
      </section>

      <section id="how-it-works" className="scroll-mt-20 px-6 pb-20">
        <div className="mx-auto flex max-w-6xl flex-col gap-10 rounded-xl border border-border bg-surface p-8 lg:flex-row lg:items-center lg:p-10">
          <div className="flex-1 space-y-3">
            <p className="font-mono text-sm text-ink-faint">every tool, one keystroke away</p>
            <h2 className="text-3xl font-bold leading-tight text-ink">Press ctrl k and type what you want to do.</h2>
            <p className="leading-relaxed text-ink-muted">
              Or click — every tool is also in the menu, on its area's page and in the full directory, whichever way you think.
            </p>
            <button type="button" onClick={openCommandBar} className={buttonClassName('secondary', 'md')}>
              &gt; try it
            </button>
          </div>
          <div className="w-full overflow-hidden rounded-lg border border-border-strong bg-canvas font-mono text-sm lg:w-[520px]" aria-hidden>
            <p className="border-b border-border px-4 py-3 text-ink">
              &gt; pool<span className="ml-0.5 inline-block h-4 w-2 animate-blink bg-ink align-[-2px]" />
            </p>
            {[
              ['Pool on Uniswap / PancakeSwap', 'liquidity', 'liquidity'],
              ['Pool on Raydium', 'liquidity', 'liquidity'],
              ['Lock liquidity', 'liquidity', 'liquidity'],
              ['Market & token lookup', 'research', 'research'],
            ].map(([label, area, id], index) => (
              <p key={label} data-pillar={id} className={`flex items-center gap-3 px-4 py-2.5 ${index === 0 ? 'bg-surface-raised' : ''}`}>
                <span className="h-2 w-2 rounded-full bg-accent-500" />
                <span className="flex-1 text-ink">{label}</span>
                <span className="text-xs text-ink-faint">{area}</span>
              </p>
            ))}
          </div>
        </div>
      </section>

      <section className="px-6 pb-20">
        <div className="mx-auto grid max-w-6xl gap-4 md:grid-cols-3">
          {[
            ['non-custodial', 'Your wallet signs every transaction. We never see a private key.'],
            ['checked on-chain', 'Deployments are recorded only after the backend reads them back from the chain — including the contract code.'],
            ['no fake volume', "We don't sell volume or bundler bots. What's built here is what it looks like."],
          ].map(([title, text]) => (
            <div key={title} className="space-y-2 border-t-2 border-border-strong pt-5">
              <h3 className="text-base font-bold text-ink">{title}</h3>
              <p className="leading-relaxed text-ink-muted">{text}</p>
            </div>
          ))}
        </div>
      </section>

      <footer className="border-t border-border px-6 py-8">
        <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 font-mono text-xs text-ink-faint">
          <span>~/newcodelaunch — beta. Try things on a testnet first.</span>
          <nav aria-label="Areas" className="flex flex-wrap gap-4">
            {PILLARS.map((pillar) => (
              <Link key={pillar.id} to={pillar.path} className="hover:text-ink">
                {pillar.short}
              </Link>
            ))}
            <Link to="/tools" className="hover:text-ink">
              all tools
            </Link>
          </nav>
        </div>
      </footer>
    </div>
  )
}
