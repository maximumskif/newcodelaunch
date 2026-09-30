import { useQuery } from '@tanstack/react-query'
import { useState, type FormEvent } from 'react'
import { Link, useSearchParams } from 'react-router-dom'

import { Button } from '../../components/ui/Button'
import { InlineError } from '../../components/ui/InlineError'
import { PageHero } from '../../components/ui/PageHero'
import { fromBaseUnits } from '../../lib/airdrop'
import { SOLANA_NETWORKS } from '../../lib/candyMachineApi'
import { holdersCsv, snapshotFileName } from '../../lib/snapshot'
import { tokenPagesApi } from '../../lib/tokenPagesApi'
import { EVM_NETWORKS } from '../network/NetworkContext'

const SHOWN = 100

function download(name: string, text: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'text/csv' }))
  const link = document.createElement('a')
  link.href = url
  link.download = name
  link.click()
  URL.revokeObjectURL(url)
}

// Every holder of a token, largest first, as a table and a CSV. Solana: any
// SPL token, as of now. EVM: tokens launched here, at the latest block or a
// past one. The URL holds the query, so a snapshot can be shared.
export function HolderSnapshotPage() {
  const [params, setParams] = useSearchParams()
  const address = params.get('address') ?? ''
  const network = params.get('network') ?? ''
  const block = params.get('block') ?? ''
  const [input, setInput] = useState(address)
  const [blockInput, setBlockInput] = useState(block)
  const [chosen, setChosen] = useState(network)
  const [showAll, setShowAll] = useState(false)
  const [copied, setCopied] = useState(false)
  const evmInput = input.trim().startsWith('0x')
  const networkChoices = evmInput ? EVM_NETWORKS.map((n) => ({ id: n.id, label: n.label })) : SOLANA_NETWORKS.map((n) => ({ id: n.id, label: n.label }))
  const selectedNetwork = networkChoices.some((n) => n.id === chosen) ? chosen : evmInput ? 'sepolia' : 'solana_devnet'

  const { data, error, isFetching } = useQuery({
    queryKey: ['holders', network, address, block],
    queryFn: () => tokenPagesApi.holders(network, address, block || undefined),
    enabled: Boolean(address && network),
    retry: false,
  })

  const submit = (event: FormEvent) => {
    event.preventDefault()
    if (!input.trim()) return
    setShowAll(false)
    setParams({ network: selectedNetwork, address: input.trim(), ...(evmInput && blockInput.trim() ? { block: blockInput.trim() } : {}) })
  }

  const copyAddresses = async () => {
    if (!data) return
    await navigator.clipboard.writeText(data.holders.map((h) => h.address).join('\n'))
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const burn = new Set(data?.burn_addresses.map((a) => a.toLowerCase()) ?? [])
  const rows = data ? (showAll ? data.holders : data.holders.slice(0, SHOWN)) : []
  const networkName = (id: string) => EVM_NETWORKS.find((n) => n.id === id)?.label ?? SOLANA_NETWORKS.find((n) => n.id === id)?.label ?? id

  return (
    <div className="space-y-8 p-4 sm:p-8">
      <PageHero
        eyebrow="Liquidity & distribution"
        title="Holder snapshot"
        description="Every wallet holding a token and how much, largest first — download it as a CSV for rewards or airdrops. Solana: any token. EVM: tokens launched here, now or at a past block."
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
          <select value={selectedNetwork} onChange={(event) => setChosen(event.target.value)} className="h-11 rounded-md border border-border bg-canvas px-3 font-mono text-sm text-ink">
            {networkChoices.map((n) => (
              <option key={n.id} value={n.id}>
                {n.label}
              </option>
            ))}
          </select>
        </label>
        {evmInput && (
          <label className="flex flex-col gap-1.5 text-sm">
            <span className="font-mono text-xs text-ink-faint">at block (optional)</span>
            <input
              value={blockInput}
              onChange={(event) => setBlockInput(event.target.value.replace(/\D/g, ''))}
              placeholder="latest"
              inputMode="numeric"
              className="h-11 w-36 rounded-md border border-border bg-canvas px-3 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-accent-500 focus:outline-none"
            />
          </label>
        )}
        <Button type="submit" size="lg" isLoading={isFetching} disabled={!input.trim()}>
          [ snapshot ]
        </Button>
      </form>

      {isFetching && !data && <p role="status" className="text-sm text-ink-muted">Reading every holder from the chain — big tokens can take a while…</p>}
      {error && <InlineError>{(error as Error).message}</InlineError>}

      {data && (
        <div className="space-y-5" data-testid="snapshot-result">
          <dl className="grid grid-cols-2 gap-3 md:grid-cols-4">
            {[
              ['Holders', data.holder_count.toLocaleString('en-US')],
              ['Total supply', `${fromBaseUnits(BigInt(data.total_supply), data.decimals)}${data.symbol ? ` ${data.symbol}` : ''}`],
              ['Network', networkName(data.network)],
              ['As of', data.as_of.block !== null ? `block ${data.as_of.block.toLocaleString('en-US')}${data.as_of.latest ? ' (latest)' : ''}` : 'now'],
            ].map(([label, value]) => (
              <div key={label} className="rounded-lg border border-border bg-surface p-4">
                <dt className="text-xs text-ink-faint">{label}</dt>
                <dd className="mt-1 truncate font-mono text-lg text-ink">{value}</dd>
              </div>
            ))}
          </dl>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="primary" onClick={() => download(snapshotFileName(data), holdersCsv(data))} disabled={!data.holders.length}>
              download csv ({data.holders.length.toLocaleString('en-US')})
            </Button>
            <Button size="sm" onClick={copyAddresses} disabled={!data.holders.length}>
              {copied ? 'copied ✓' : 'copy addresses'}
            </Button>
            <Link
              to={data.chain === 'solana' ? '/liquidity/airdrop?chain=solana' : `/liquidity/airdrop?network=${data.network}`}
              className="font-mono text-xs text-accent-300 hover:underline"
            >
              airdrop to them →
            </Link>
          </div>
          {data.truncated && (
            <p className="text-sm text-warning">
              Listing the largest {data.holders.length.toLocaleString('en-US')} of {data.holder_count.toLocaleString('en-US')} holders.
            </p>
          )}
          {data.chain === 'solana' && <p className="text-xs text-ink-faint">Owners, not token accounts: a wallet's accounts for this token are added together. A pool or exchange shows up as one holder.</p>}

          {data.holders.length === 0 ? (
            <p className="text-sm text-ink-muted">Nobody holds this token{data.as_of.latest ? '' : ' at that block'}.</p>
          ) : (
            <div
              // Focusable: on a phone the table scrolls sideways.
              tabIndex={0} role="region" aria-label="Holders" className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full min-w-[36rem] font-mono text-xs">
                <thead className="text-left text-ink-faint">
                  <tr className="border-b border-border">
                    <th scope="col" className="px-4 py-2 font-normal">#</th>
                    <th scope="col" className="px-4 py-2 font-normal">address</th>
                    <th scope="col" className="px-4 py-2 text-right font-normal">balance</th>
                    <th scope="col" className="w-40 px-4 py-2 font-normal">share</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((holder, index) => (
                    <tr key={holder.address} className="border-b border-border/50 last:border-0">
                      <td className="px-4 py-1.5 text-ink-faint">{index + 1}</td>
                      <td className="px-4 py-1.5 break-all text-ink">
                        {holder.address}
                        {burn.has(holder.address.toLowerCase()) && <span className="ml-2 text-ink-faint">(burn address)</span>}
                      </td>
                      <td className="px-4 py-1.5 text-right text-ink">{fromBaseUnits(BigInt(holder.balance), data.decimals)}</td>
                      <td className="px-4 py-1.5">
                        <span className="flex items-center gap-2">
                          <span className="relative h-2 flex-1 overflow-hidden rounded bg-surface-raised">
                            <span className="absolute inset-y-0 left-0 bg-accent-500/60" style={{ width: `${Math.max(holder.share * 100, 0.5)}%` }} />
                          </span>
                          <span className="w-14 text-right text-ink">{(holder.share * 100).toFixed(2)}%</span>
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {!showAll && data.holders.length > SHOWN && (
            <Button size="sm" onClick={() => setShowAll(true)}>
              show all {data.holders.length.toLocaleString('en-US')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
