import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { Card } from '../../components/ui/Card'
import { EmptyState } from '../../components/ui/EmptyState'
import { PageHero } from '../../components/ui/PageHero'
import { SOLANA_NETWORKS } from '../../lib/candyMachineApi'
import { formatTokenAmount } from '../../lib/solanaTokensApi'
import { tokenPagesApi, type TokenPage as TokenPageData } from '../../lib/tokenPagesApi'
import { EVM_NETWORKS } from '../network/NetworkContext'

const percentOf = (part: bigint, whole: bigint) => (whole > 0n ? `${((Number(part) / Number(whole)) * 100).toFixed(2)}%` : '0%')

function Check({ ok, children }: { ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex items-start gap-2">
      <span aria-hidden="true" className={ok ? 'text-success' : 'text-warning'}>
        {ok ? '✓' : '!'}
      </span>
      <span className="text-ink">
        <span className="sr-only">{ok ? 'Good: ' : 'Caution: '}</span>
        {children}
      </span>
    </li>
  )
}

// A shareable, public page for a token launched with this app: what a buyer
// would want to check, read from the chain by the backend just now — not
// anything the creator typed. No wallet or sign-in needed.
export function TokenPage() {
  const { network = '', address = '' } = useParams<{ network: string; address: string }>()
  const [page, setPage] = useState<TokenPageData | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    let cancelled = false
    tokenPagesApi
      .get(network, address)
      .then((data) => !cancelled && setPage(data))
      .catch((err: unknown) => !cancelled && setError(err instanceof Error ? err.message : 'Couldn’t load this token'))
    return () => {
      cancelled = true
    }
  }, [network, address])

  if (error) {
    return (
      <div className="space-y-5 p-8">
        <PageHero eyebrow="Token" title="Token not found" description="" />
        <EmptyState title="This link doesn't match a token launched here" description={error} />
      </div>
    )
  }
  if (!page) return <p className="p-8 text-ink-muted">Reading the token from the chain…</p>

  const networkLabel =
    page.chain === 'solana'
      ? (SOLANA_NETWORKS.find((n) => n.id === page.network)?.label ?? page.network)
      : (EVM_NETWORKS.find((n) => n.id === page.network)?.label ?? page.network)
  const native = page.chain === 'solana' ? 'SOL' : (EVM_NETWORKS.find((n) => n.id === page.network)?.nativeToken ?? 'ETH')
  const fmt = (raw: string) => formatTokenAmount(raw, page.decimals)
  const pool = page.pool
  const live = Boolean(pool?.pair && pool.token_reserve && BigInt(pool.token_reserve) > 0n)
  const price = live
    ? Number(formatTokenAmount(pool!.native_reserve!, page.chain === 'solana' ? 9 : 18).replace(/,/g, '')) /
      Number(fmt(pool!.token_reserve!).replace(/,/g, ''))
    : null
  const lpSupply = BigInt(pool?.lp_supply ?? '0')

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(window.location.href)
      setCopied(true)
    } catch {
      setCopied(false)
    }
  }

  return (
    <div className="space-y-5 p-8" data-testid="token-page">
      <PageHero
        eyebrow={`Token · ${networkLabel}`}
        title={`${page.name} (${page.symbol})`}
        description="Everything below is read from the chain just now — not what the creator says."
      />
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <span className="break-all font-mono text-ink-faint">{page.address}</span>
        {page.explorer_url && (
          <a href={page.explorer_url} target="_blank" rel="noreferrer" className="text-accent-400 hover:underline">
            Explorer
          </a>
        )}
        <Button variant="ghost" size="sm" onClick={() => void copyLink()}>
          {copied ? 'Link copied' : 'Copy link'}
        </Button>
      </div>

      <div className="grid max-w-4xl gap-4 md:grid-cols-2">
        <Card padding="lg" rounded="xl">
          <h2 className="mb-3 text-sm font-semibold text-ink">Supply and control</h2>
          <p className="mb-3 text-ink">
            {fmt(page.total_supply)} {page.symbol}
          </p>
          <ul className="space-y-2 text-sm">
            {page.chain === 'solana' ? (
              <>
                <Check ok={page.mint_authority_revoked}>{page.mint_authority_revoked ? 'Supply is fixed — no one can mint more' : 'The creator can still mint more'}</Check>
                <Check ok={page.freeze_authority_revoked}>{page.freeze_authority_revoked ? 'No one can freeze holders’ tokens' : 'Holders’ tokens can still be frozen'}</Check>
                <Check ok={page.metadata_locked}>{page.metadata_locked ? 'Name, symbol and logo are locked' : 'Name, symbol and logo can still change'}</Check>
              </>
            ) : (
              <>
                {page.owner !== null && (
                  <Check ok={page.ownership_renounced}>{page.ownership_renounced ? 'Ownership renounced — no one can change its settings' : 'Has an owner who can change its settings'}</Check>
                )}
                <Check ok={page.source_verified}>{page.source_verified ? 'Source code verified on the explorer' : 'Source code not verified yet'}</Check>
                {page.advanced && (
                  <>
                    <Check ok={page.advanced.trading_enabled}>{page.advanced.trading_enabled ? 'Trading is enabled' : 'Trading is not enabled yet — holders can’t transfer'}</Check>
                    <li className="text-ink-muted">
                      Buy tax {page.advanced.buy_tax_bps / 100}% · sell tax {page.advanced.sell_tax_bps / 100}% · max {fmt(page.advanced.max_transaction)} per
                      transfer, {fmt(page.advanced.max_wallet)} per wallet
                    </li>
                  </>
                )}
              </>
            )}
          </ul>
        </Card>

        <Card padding="lg" rounded="xl" data-testid="token-page-pool">
          <h2 className="mb-3 text-sm font-semibold text-ink">Liquidity</h2>
          {!pool ? (
            <p className="text-sm text-ink-muted">Couldn't read the pool right now.</p>
          ) : !live ? (
            <p className="text-sm text-ink-muted">No {pool.dex} pool yet.</p>
          ) : (
            <div className="space-y-2 text-sm">
              <div className="flex flex-wrap gap-2">
                <Badge tone="info">{pool.dex}</Badge>
                <Badge tone="neutral">
                  {fmt(pool.token_reserve!)} {page.symbol} + {formatTokenAmount(pool.native_reserve!, page.chain === 'solana' ? 9 : 18)} {native}
                </Badge>
              </div>
              {price !== null && (
                <p className="text-ink">
                  Price: 1 {page.symbol} = {new Intl.NumberFormat('en-US', { maximumSignificantDigits: 6 }).format(price)} {native}
                </p>
              )}
              <ul className="space-y-2">
                {page.chain === 'solana' ? (
                  <Check ok={BigInt(page.pool!.permanently_locked_lp ?? '0') > 0n}>
                    {percentOf(BigInt(page.pool!.permanently_locked_lp ?? '0'), lpSupply)} of the pool's liquidity is locked forever (Raydium Burn &amp; Earn)
                  </Check>
                ) : (
                  <>
                    <Check ok={(page.pool!.locks ?? []).length > 0}>
                      {percentOf((page.pool!.locks ?? []).reduce((sum, l) => sum + BigInt(l.amount), 0n), lpSupply)} of the pool's liquidity is time-locked
                    </Check>
                    {(page.pool!.locks ?? []).map((lock) => (
                      <li key={lock.address} className="pl-6 text-ink-muted">
                        {percentOf(BigInt(lock.amount), lpSupply)} until {new Date(lock.release_time * 1000).toLocaleString()}{' '}
                        <span className="break-all font-mono text-xs">({lock.address})</span>
                      </li>
                    ))}
                    {BigInt(page.pool!.burned_lp ?? '0') > 0n && (
                      <Check ok>{percentOf(BigInt(page.pool!.burned_lp!), lpSupply)} of the pool's liquidity is burned</Check>
                    )}
                  </>
                )}
              </ul>
            </div>
          )}
        </Card>
      </div>
      <p className="max-w-4xl text-xs text-ink-faint">
        This page reports on-chain facts, not advice. A fixed supply and locked liquidity remove some risks, not all of them.
      </p>
    </div>
  )
}
