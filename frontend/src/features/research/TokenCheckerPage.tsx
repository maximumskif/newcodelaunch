import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Button } from '../../components/ui/Button'
import { InlineError } from '../../components/ui/InlineError'
import { PageHero } from '../../components/ui/PageHero'
import { SOLANA_NETWORKS } from '../../lib/candyMachineApi'
import { formatLarge, formatPrice } from '../../lib/marketFormat'
import { formatTokenAmount } from '../../lib/solanaTokensApi'
import { tokenPagesApi, type TokenCheck } from '../../lib/tokenPagesApi'
import { EVM_NETWORKS } from '../network/NetworkContext'

function CheckTile({ check }: { check: TokenCheck }) {
  const mark = check.ok === true ? '✓' : check.ok === false ? '!' : '·'
  const tone = check.ok === true ? 'bg-success/15 text-success' : check.ok === false ? 'bg-warning/15 text-warning' : 'bg-surface-raised text-ink-faint'
  return (
    <li className="flex gap-3 rounded-lg border border-border bg-surface px-4 py-3">
      <span aria-hidden className={`grid h-7 w-7 shrink-0 place-items-center rounded-full font-mono text-sm font-bold ${tone}`}>
        {mark}
      </span>
      <span className="min-w-0">
        <span className="sr-only">{check.ok === true ? 'Good: ' : check.ok === false ? 'Caution: ' : 'Unknown: '}</span>
        <span className="block text-ink">{check.label}</span>
        {check.detail && <span className="block break-words text-sm text-ink-muted">{check.detail}</span>}
      </span>
    </li>
  )
}

// Check any token before buying it: who can still mint, freeze or change
// it, and how much liquidity it has. The URL holds what was checked, so a
// result can be shared.
export function TokenCheckerPage() {
  const [params, setParams] = useSearchParams()
  const address = params.get('address') ?? ''
  const network = params.get('network') ?? ''
  const [input, setInput] = useState(address)
  const evmInput = input.trim().startsWith('0x')
  const [chosen, setChosen] = useState(network)
  const networkChoices = evmInput
    ? EVM_NETWORKS.map((n) => ({ id: n.id, label: n.label }))
    : SOLANA_NETWORKS.map((n) => ({ id: n.id, label: n.label }))
  const selectedNetwork = networkChoices.some((n) => n.id === chosen) ? chosen : evmInput ? 'ethereum' : 'solana'

  const { data, error, isFetching } = useQuery({
    queryKey: ['token-check', network, address],
    queryFn: () => tokenPagesApi.check(network, address),
    enabled: Boolean(address && network),
    retry: false,
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!input.trim()) return
    setParams({ network: selectedNetwork, address: input.trim() })
  }

  const networkName = (id: string) => EVM_NETWORKS.find((n) => n.id === id)?.label ?? SOLANA_NETWORKS.find((n) => n.id === id)?.label ?? id

  return (
    <div className="space-y-8 p-4 sm:p-8">
      <PageHero
        eyebrow="Research"
        title="Token checker"
        description="Check any token before you buy it: who can still mint, freeze or change it, how concentrated it is, and how much liquidity it has — read from the chain."
      />

      <form onSubmit={submit} className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 lg:flex-row lg:items-end">
        <label className="flex min-w-0 flex-1 flex-col gap-1.5 text-sm">
          <span className="font-mono text-xs text-ink-faint">token address or mint</span>
          <input
            value={input}
            onChange={(event) => setInput(event.target.value)}
            placeholder="0x… or a Solana mint"
            spellCheck={false}
            className="h-11 rounded-md border border-border bg-canvas px-3 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-accent-500 focus:outline-none"
          />
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="font-mono text-xs text-ink-faint">network</span>
          <select
            value={selectedNetwork}
            onChange={(event) => setChosen(event.target.value)}
            className="h-11 rounded-md border border-border bg-canvas px-3 font-mono text-sm text-ink"
          >
            {networkChoices.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
        <Button type="submit" size="lg" isLoading={isFetching} disabled={!input.trim()}>
          [ check ]
        </Button>
      </form>

      {error && <InlineError>{(error as Error).message}</InlineError>}

      {data && (
        <div className="space-y-6" data-testid="check-result">
          <div className="flex flex-wrap items-center gap-4">
            <span aria-hidden className="grid h-12 w-12 place-items-center rounded-full bg-accent-500 font-mono text-xl font-bold text-canvas">
              {(data.symbol ?? '?').slice(0, 1).toUpperCase()}
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="text-2xl font-bold text-ink">
                {data.name ?? 'Unnamed token'} {data.symbol && <span className="text-ink-faint">({data.symbol})</span>}
              </h2>
              <p className="truncate font-mono text-xs text-ink-faint">
                {networkName(data.network)} · {data.address}
              </p>
            </div>
            <div className="flex flex-wrap gap-2 font-mono text-xs">
              <a href={data.explorer_url} target="_blank" rel="noreferrer" className="rounded-md border border-border px-3 py-1.5 text-accent-300 hover:bg-surface-hover">
                explorer ↗
              </a>
              {data.launched_here && (
                <Link to={data.launched_here} className="rounded-md border border-accent-500/50 px-3 py-1.5 text-accent-300 hover:bg-surface-hover">
                  launched here — full page →
                </Link>
              )}
            </div>
          </div>

          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['Total supply', formatTokenAmount(data.total_supply, data.decimals)],
              ['Price', formatPrice(data.liquidity?.top.price_usd)],
              ['Liquidity', data.liquidity ? formatLarge(data.liquidity.total_liquidity_usd) : '—'],
              ['Pools', data.liquidity ? String(data.liquidity.pools) : '0'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-surface p-4">
                <dt className="text-xs text-ink-faint">{label}</dt>
                <dd className="mt-1 truncate font-mono text-lg text-ink">{value}</dd>
              </div>
            ))}
          </dl>

          <section aria-labelledby="checks-heading" className="space-y-3">
            <h3 id="checks-heading" className="font-mono text-sm font-semibold text-ink-faint">
              what the chain says
            </h3>
            <ul className="grid gap-2 lg:grid-cols-2">
              {data.checks.map((check) => (
                <CheckTile key={check.id} check={check} />
              ))}
            </ul>
          </section>

          {data.largest_holders && data.largest_holders.length > 0 && (
            <section aria-labelledby="holders-heading" className="space-y-3">
              <h3 id="holders-heading" className="font-mono text-sm font-semibold text-ink-faint">
                largest accounts
              </h3>
              <ol className="space-y-1.5 rounded-lg border border-border bg-surface p-4">
                {data.largest_holders.map((holder, index) => (
                  <li key={holder.address} className="grid grid-cols-[2rem_minmax(0,1fr)_4rem] items-center gap-3 font-mono text-xs">
                    <span className="text-ink-faint">{index + 1}</span>
                    <span className="relative h-5 overflow-hidden rounded bg-surface-raised">
                      <span className="absolute inset-y-0 left-0 bg-accent-500/40" style={{ width: `${Math.max(holder.share * 100, 0.5)}%` }} />
                      <span className="relative px-2 leading-5 text-ink">
                        {holder.address.slice(0, 6)}…{holder.address.slice(-4)}
                      </span>
                    </span>
                    <span className="text-right text-ink">{(holder.share * 100).toFixed(1)}%</span>
                  </li>
                ))}
              </ol>
            </section>
          )}

          <p className="text-xs text-ink-faint">On-chain facts, not financial advice. A clean result removes some risks, not all of them.</p>
        </div>
      )}
    </div>
  )
}
