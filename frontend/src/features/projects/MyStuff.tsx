import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { Link } from 'react-router-dom'

import { InlineError } from '../../components/ui/InlineError'
import { candyMachineApi, SOLANA_NETWORKS } from '../../lib/candyMachineApi'
import { contractsApi } from '../../lib/contractsApi'
import { nftApi } from '../../lib/nftApi'
import { pillarById, type PillarId } from '../../lib/pillars'
import { solanaTokensApi } from '../../lib/solanaTokensApi'
import { tokenPagePath } from '../../lib/tokenPagesApi'
import { EVM_NETWORKS } from '../network/NetworkContext'

const networkLabel = (id: string) =>
  EVM_NETWORKS.find((n) => n.id === id)?.label ?? SOLANA_NETWORKS.find((n) => n.id === id)?.label ?? id
const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`

interface Row {
  key: string
  title: string
  detail: string
  actions: { label: string; to: string }[]
}

function Section({ pillarId, title, rows }: { pillarId: PillarId; title: string; rows: Row[] }) {
  const pillar = pillarById(pillarId)
  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? rows : rows.slice(0, 5)
  return (
    <section data-pillar={pillar.id} aria-labelledby={`mine-${pillar.id}`} className="rounded-xl border border-border bg-surface">
      <header className="flex items-center justify-between gap-3 border-b border-border px-5 py-3.5">
        <h2 id={`mine-${pillar.id}`} className="flex items-center gap-2.5 font-mono text-sm font-semibold text-accent-400">
          <span aria-hidden className="grid h-7 w-7 place-items-center rounded-md bg-accent-500/15 font-bold">
            {pillar.glyph}
          </span>
          {title}
          <span className="font-normal text-ink-faint">{rows.length}</span>
        </h2>
        <Link to={pillar.path} className="font-mono text-xs text-ink-faint hover:text-accent-400">
          {pillar.short} tools →
        </Link>
      </header>
      <ul className="divide-y divide-border">
        {visible.map((row) => (
          <li key={row.key} className="flex flex-wrap items-center gap-x-4 gap-y-2 px-5 py-3">
            <span className="min-w-0 flex-1">
              <span className="block truncate font-mono text-sm font-semibold text-ink">{row.title}</span>
              <span className="block truncate text-xs text-ink-faint">{row.detail}</span>
            </span>
            <span className="flex flex-wrap gap-3">
              {row.actions.map((action) => (
                <Link key={action.label} to={action.to} className="font-mono text-xs text-accent-400 hover:underline">
                  {action.label} →
                </Link>
              ))}
            </span>
          </li>
        ))}
        {rows.length > 5 && (
          <li className="px-5 py-2.5">
            <button type="button" onClick={() => setShowAll((v) => !v)} className="font-mono text-xs text-ink-faint hover:text-accent-400">
              {showAll ? 'show fewer' : `show all ${rows.length}`}
            </button>
          </li>
        )}
      </ul>
    </section>
  )
}

// Everything this account has made, by area, each with where to go next.
export function MyStuff({ token }: { token: string }) {
  const deployments = useQuery({ queryKey: ['mine-deployments', token], queryFn: () => contractsApi.listDeployments(token) })
  const solana = useQuery({ queryKey: ['mine-solana', token], queryFn: () => solanaTokensApi.list(token) })
  const collections = useQuery({ queryKey: ['mine-collections', token], queryFn: () => nftApi.listCollections(token) })
  const drops = useQuery({ queryKey: ['mine-drops', token], queryFn: () => candyMachineApi.dashboard(token) })

  const all = deployments.data?.deployments ?? []
  const tokenRows: Row[] = [
    ...all
      .filter((d) => d.contract_type === 'erc20')
      .map((d) => ({
        key: d.id,
        title: String(d.parameters?.TOKEN_SYMBOL ?? d.parameters?.TOKEN_NAME ?? d.template_name),
        detail: `${d.template_name} · ${networkLabel(d.network)} · ${short(d.contract_address)}`,
        actions: [
          { label: 'manage', to: '/tokens/create#history' },
          { label: 'public page', to: tokenPagePath(d.network, d.contract_address) },
          { label: 'airdrop', to: `/liquidity/airdrop?network=${d.network}&token=${d.contract_address}` },
          { label: 'holders', to: `/liquidity/snapshot?network=${d.network}&address=${d.contract_address}` },
          { label: 'burn', to: `/tokens/burn?network=${d.network}&token=${d.contract_address}` },
        ],
      })),
    ...(solana.data?.tokens ?? []).map((t) => ({
      key: t.id,
      title: t.symbol,
      detail: `${t.name} · ${networkLabel(t.network)} · ${short(t.mint_address)}`,
      actions: [
        { label: 'manage', to: '/tokens/create?chain=solana#history' },
        { label: 'public page', to: tokenPagePath(t.network, t.mint_address) },
        { label: 'airdrop', to: `/liquidity/airdrop?chain=solana&network=${t.network}&mint=${t.mint_address}` },
        { label: 'holders', to: `/liquidity/snapshot?network=${t.network}&address=${t.mint_address}` },
        { label: 'burn', to: `/tokens/burn?chain=solana&network=${t.network}&mint=${t.mint_address}` },
      ],
    })),
  ]
  const collectionRows: Row[] = (collections.data?.collections ?? []).map((c) => {
    const items = c.item_count ?? 0
    const published = c.published_count ?? 0
    return {
      key: c.id,
      title: c.name,
      detail: items === 0 ? 'nothing generated yet' : `${items} items · ${published} published`,
      actions: [
        { label: items === 0 ? 'continue' : published < items ? 'publish' : 'open', to: `/nfts/generator?collection=${c.id}` },
        ...(published > 0 ? [{ label: 'sell', to: `/drops/launch?collection=${c.id}` }] : []),
      ],
    }
  })
  const contractRows: Row[] = all
    .filter((d) => d.contract_type !== 'erc20')
    .map((d) => ({
      key: d.id,
      title: d.template_name,
      detail: `${networkLabel(d.network)} · ${short(d.contract_address)} · source ${d.verification_status}`,
      actions: [{ label: 'manage', to: '/contracts/deploy#history' }],
    }))
  const dropRows: Row[] = (drops.data?.drops ?? []).map((d) => ({
    key: d.id,
    title: d.collection_name ?? 'Untitled drop',
    detail: `${networkLabel(d.network)} · ${d.items_redeemed ?? '?'} / ${d.items_available} minted · ${d.is_live ? 'live' : 'not live yet'}`,
    actions: [
      { label: 'storefront', to: `/mint/buy/${d.candy_machine}` },
      { label: 'manage', to: '/drops/launch' },
    ],
  }))

  // Only areas with something in them get a section; the start tiles above
  // cover the rest, so empty sections would just repeat those links.
  const sections: { pillarId: PillarId; title: string; rows: Row[] }[] = [
    { pillarId: 'tokens', title: 'tokens', rows: tokenRows },
    { pillarId: 'nfts', title: 'nft collections', rows: collectionRows },
    { pillarId: 'contracts', title: 'contracts', rows: contractRows },
    { pillarId: 'drops', title: 'drops', rows: dropRows },
  ]
  const filled = sections.filter((section) => section.rows.length > 0)
  const failed = [deployments, solana, collections, drops].find((q) => q.error)
  const loading = [deployments, solana, collections, drops].some((q) => q.isLoading)

  return (
    <div className="space-y-4">
      {failed && <InlineError>{(failed.error as Error).message}</InlineError>}
      {loading && <p className="font-mono text-sm text-ink-faint">loading your things…</p>}
      {!loading && !failed && filled.length === 0 && (
        <p className="rounded-xl border border-dashed border-border px-5 py-4 text-sm text-ink-muted">
          Nothing here yet. The tokens, collections, contracts and drops you make will show up here, each with what to do next.
        </p>
      )}
      {!loading && filled.length > 0 && (
        <div className="grid items-start gap-4 xl:grid-cols-2">
          {filled.map((section) => (
            <Section key={section.pillarId} pillarId={section.pillarId} title={section.title} rows={section.rows} />
          ))}
        </div>
      )}
    </div>
  )
}
