import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'

import { Button } from '../../components/ui/Button'
import { EmptyState } from '../../components/ui/EmptyState'
import { InlineError } from '../../components/ui/InlineError'
import { PageHero } from '../../components/ui/PageHero'
import { SkeletonTableRow } from '../../components/ui/Skeleton'
import { marketApi, type DexPair } from '../../lib/marketApi'

function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  return value >= 1
    ? `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
    : `$${value.toPrecision(4)}`
}

function formatLarge(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}

function Change({ value }: { value: number | null | undefined }) {
  if (value === null || value === undefined) return <span className="text-ink-faint">—</span>
  return (
    <span className={value >= 0 ? 'text-success' : 'text-danger'}>
      {`${value >= 0 ? '+' : ''}${value.toFixed(2)}%`}
    </span>
  )
}

// A token's logo, or its initial when there's none (or it fails to load).
function TokenIcon({ src, symbol }: { src: string | null; symbol: string }) {
  const [failed, setFailed] = useState(false)
  if (src && !failed) return <img src={src} alt="" className="h-6 w-6 shrink-0 rounded-full" onError={() => setFailed(true)} />
  return (
    <span aria-hidden className="grid h-6 w-6 shrink-0 place-items-center rounded-full bg-surface-hover text-[10px] font-semibold text-ink-muted">
      {symbol.slice(0, 1).toUpperCase()}
    </span>
  )
}

function age(createdAt: number | null): string {
  if (!createdAt) return '—'
  const hours = (Date.now() - createdAt) / 3_600_000
  if (hours < 1) return `${Math.max(1, Math.round(hours * 60))}m`
  if (hours < 48) return `${Math.round(hours)}h`
  return `${Math.round(hours / 24)}d`
}

function TokenLookup() {
  const [input, setInput] = useState('')
  const [address, setAddress] = useState('')
  const { data, isFetching, error } = useQuery({
    queryKey: ['market-lookup', address],
    queryFn: () => marketApi.lookupToken(address),
    enabled: address !== '',
    retry: false,
  })
  const submit = (event: FormEvent) => {
    event.preventDefault()
    setAddress(input.trim())
  }
  const best = data?.pairs[0]
  // The same address can exist on several chains (forks like PulseChain
  // copied Ethereum's state, so WETH's address has pools there at unrelated
  // prices). Show the most liquid pool's chain; name the others.
  const pairs = best ? data.pairs.filter((pair) => pair.chain === best.chain) : []
  const otherChains = best ? [...new Set(data.pairs.map((pair) => pair.chain))].filter((chain) => chain !== best.chain) : []

  return (
    <section aria-labelledby="lookup-heading" className="space-y-3 rounded-xl border border-border bg-surface p-5">
      <div>
        <h2 id="lookup-heading" className="font-display text-lg font-semibold text-ink">Token lookup</h2>
        <p className="text-sm text-ink-muted">Any token's price, liquidity and pools, on every chain DexScreener tracks — paste a contract address or Solana mint.</p>
      </div>
      <form onSubmit={submit} className="flex flex-col gap-2 sm:flex-row">
        <label htmlFor="lookup-address" className="sr-only">Token address</label>
        <input
          id="lookup-address"
          value={input}
          onChange={(event) => setInput(event.target.value)}
          placeholder="0x… or a Solana mint"
          spellCheck={false}
          className="w-full rounded-md border border-border bg-canvas px-3 py-2 font-mono text-sm text-ink placeholder:text-ink-faint"
        />
        <Button type="submit" isLoading={isFetching} disabled={!input.trim()}>Look up</Button>
      </form>
      {error && <InlineError>{(error as Error).message}</InlineError>}
      {data && data.pairs.length === 0 && <p className="text-sm text-ink-muted">No trading pairs found for this token on any DEX DexScreener tracks.</p>}
      {best && (
        <div className="space-y-3" data-testid="lookup-result">
          <div className="flex flex-wrap items-center gap-3">
            <TokenIcon src={best.image} symbol={best.base_token.symbol} />
            <span className="text-lg font-semibold text-ink">{best.base_token.name}</span>
            <span className="text-ink-faint">{best.base_token.symbol}</span>
            <span className="font-mono text-lg text-ink">{formatPrice(best.price_usd)}</span>
            <Change value={best.price_change_24h} />
          </div>
          <dl className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            {[
              ['Liquidity (top pool)', formatLarge(best.liquidity_usd)],
              ['Volume 24h (top pool)', formatLarge(best.volume_24h)],
              ['Market cap', formatLarge(best.market_cap ?? best.fdv)],
              [`Pools on ${best.chain}`, String(pairs.length)],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-canvas p-3">
                <dt className="text-xs text-ink-faint">{label}</dt>
                <dd className="font-mono text-ink">{value}</dd>
              </div>
            ))}
          </dl>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="text-left text-xs text-ink-muted">
                <tr>
                  <th className="py-2 pr-4 font-medium">Pool</th>
                  <th className="py-2 pr-4 font-medium">Chain · DEX</th>
                  <th className="py-2 pr-4 text-right font-medium">Price</th>
                  <th className="py-2 pr-4 text-right font-medium">Liquidity</th>
                  <th className="py-2 pr-4 text-right font-medium">Volume 24h</th>
                  <th className="py-2 text-right font-medium">Age</th>
                </tr>
              </thead>
              <tbody className="font-mono">
                {pairs.map((pair) => (
                  <tr key={`${pair.chain}-${pair.pair_address}`} className="border-t border-border">
                    <td className="py-2 pr-4 font-sans">
                      {pair.url ? (
                        <a href={pair.url} target="_blank" rel="noreferrer" className="text-accent-300 hover:underline">
                          {pair.base_token.symbol}/{pair.quote_symbol}
                        </a>
                      ) : (
                        `${pair.base_token.symbol}/${pair.quote_symbol}`
                      )}
                    </td>
                    <td className="py-2 pr-4 font-sans capitalize text-ink-muted">{pair.chain} · {pair.dex}</td>
                    <td className="py-2 pr-4 text-right text-ink">{formatPrice(pair.price_usd)}</td>
                    <td className="py-2 pr-4 text-right text-ink-muted">{formatLarge(pair.liquidity_usd)}</td>
                    <td className="py-2 pr-4 text-right text-ink-muted">{formatLarge(pair.volume_24h)}</td>
                    <td className="py-2 text-right text-ink-faint">{age(pair.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {otherChains.length > 0 && (
            <p className="text-xs text-ink-faint">
              The same address also has pools on {otherChains.join(', ')} — a different token there, not shown.
            </p>
          )}
        </div>
      )}
    </section>
  )
}

function TrendingCard({ token }: { token: DexPair }) {
  return (
    <a
      href={token.url ?? undefined}
      target="_blank"
      rel="noreferrer"
      className="block space-y-2 rounded-lg border border-border bg-canvas p-3 transition-colors hover:border-border-strong hover:bg-surface-hover"
    >
      <div className="flex items-center gap-2">
        <TokenIcon src={token.image} symbol={token.base_token.symbol} />
        <span className="truncate font-medium text-ink">{token.base_token.symbol}</span>
        <span className="ml-auto rounded bg-surface-hover px-1.5 py-0.5 text-[10px] capitalize text-ink-muted">{token.chain}</span>
      </div>
      <div className="flex items-baseline justify-between font-mono text-sm">
        <span className="text-ink">{formatPrice(token.price_usd)}</span>
        <Change value={token.price_change_24h} />
      </div>
      <div className="flex justify-between text-xs text-ink-faint">
        <span>Liq {formatLarge(token.liquidity_usd)}</span>
        <span>Vol {formatLarge(token.volume_24h)}</span>
      </div>
    </a>
  )
}

function Trending() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['market-trending'],
    queryFn: marketApi.trending,
    refetchInterval: 120_000,
    retry: 1,
  })
  return (
    <section aria-labelledby="trending-heading" className="space-y-3">
      <div>
        <h2 id="trending-heading" className="font-display text-lg font-semibold text-ink">Trending on DEXes</h2>
        <p className="text-sm text-ink-muted">Tokens with the most paid promotion on DexScreener right now — attention, not an endorsement.</p>
      </div>
      {error && <InlineError>{(error as Error).message}</InlineError>}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
        {isLoading && Array.from({ length: 8 }).map((_, index) => <div key={index} className="h-24 animate-pulse rounded-lg border border-border bg-surface" />)}
        {data?.tokens.map((token) => <TrendingCard key={`${token.chain}-${token.pair_address}`} token={token} />)}
      </div>
    </section>
  )
}

function TopTokens() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['market-tokens'],
    queryFn: () => marketApi.listTokens(25),
    refetchInterval: 60_000,
    retry: 1,
  })
  return (
    <section aria-labelledby="top-heading" className="space-y-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 id="top-heading" className="font-display text-lg font-semibold text-ink">Top tokens by market cap</h2>
        {data && <span className="text-xs text-ink-faint">Source: {data.source} · refreshed every minute</span>}
      </div>
      {error && <InlineError>{(error as Error).message}</InlineError>}
      {data && data.tokens.length === 0 && <EmptyState title="No market data available." />}
      {(isLoading || (data && data.tokens.length > 0)) && (
        <div className="overflow-x-auto rounded-xl border border-border bg-surface">
          <table className="w-full text-sm">
            <thead className="border-b border-border text-left text-xs text-ink-muted">
              <tr>
                <th className="px-4 py-3 font-medium">#</th>
                <th className="px-4 py-3 font-medium">Token</th>
                <th className="px-4 py-3 text-right font-medium">Price</th>
                <th className="px-4 py-3 text-right font-medium">24h</th>
                <th className="px-4 py-3 text-right font-medium">Market Cap</th>
                <th className="px-4 py-3 text-right font-medium">Volume (24h)</th>
              </tr>
            </thead>
            <tbody className="font-mono">
              {isLoading && Array.from({ length: 8 }).map((_, index) => <SkeletonTableRow key={index} columns={6} />)}
              {data?.tokens.map((token) => (
                <tr key={token.id} className="border-b border-border transition-colors duration-150 last:border-0 hover:bg-surface-hover">
                  <td className="px-4 py-3 font-sans text-ink-faint">{token.market_cap_rank ?? '—'}</td>
                  <td className="px-4 py-3 font-sans">
                    <div className="flex items-center gap-2">
                      <TokenIcon src={token.image} symbol={token.symbol ?? '?'} />
                      <span className="font-medium text-ink">{token.name}</span>
                      <span className="text-ink-faint">{token.symbol}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-right text-ink">{formatPrice(token.current_price)}</td>
                  <td className="px-4 py-3 text-right"><Change value={token.price_change_percentage_24h} /></td>
                  <td className="px-4 py-3 text-right text-ink-muted">{formatLarge(token.market_cap)}</td>
                  <td className="px-4 py-3 text-right text-ink-muted">{formatLarge(token.total_volume)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </section>
  )
}

export function MarketIntelligencePage() {
  return (
    <div className="space-y-8 p-8">
      <PageHero
        eyebrow="Live Data"
        title="Market Intelligence"
        description="Look up any token, see what's moving on DEXes, and track the majors — live data, never a simulated number."
      />
      <TokenLookup />
      <Trending />
      <TopTokens />
    </div>
  )
}
