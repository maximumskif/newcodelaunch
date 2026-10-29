import { useQuery } from '@tanstack/react-query'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount } from 'wagmi'

import { Button } from '../../components/ui/Button'
import { InlineError } from '../../components/ui/InlineError'
import { MainnetConfirmCheckbox } from '../../components/ui/MainnetConfirmCheckbox'
import { PageHero } from '../../components/ui/PageHero'
import { SignInPrompt } from '../../components/ui/SignInPrompt'
import { fromBaseUnits, toBaseUnits } from '../../lib/airdrop'
import { contractsApi } from '../../lib/contractsApi'
import { formatAmount } from '../../lib/marketFormat'
import {
  MAX_SUPPLY,
  MAX_TARGET,
  MIN_SUPPLY,
  MIN_TARGET,
  SUGGESTED_TARGET,
  curveTerms,
  graduationPrice,
  priceAt,
  quoteBuy,
} from '../../lib/curve'
import { useAuth } from '../auth/AuthContext'
import { useDeployTemplate } from '../contracts/useDeployTemplate'
import { SummaryRow, short } from '../distribute/airdropParts'
import { EVM_NETWORKS, isMainnetNetwork, useNetwork } from '../network/NetworkContext'
import { CurvePanel } from './CurvePanel'

const inputClass =
  'h-11 rounded-md border border-border bg-canvas px-3 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-accent-500 focus:outline-none'
const wholeNumber = (text: string) => (/^\d{1,16}$/.test(text.replace(/[,_\s]/g, '')) ? BigInt(text.replace(/[,_\s]/g, '')) : null)

// Launch a token on a bonding curve: one Bonding-Curve Token contract (no
// owner), deployed from the creator's wallet. People buy and sell on the
// curve until it has raised its target, then it moves into the network's
// V2 pool by itself with the liquidity burned. EVM networks with a
// supported DEX only.
export function CurveLaunchPage() {
  const { network: sharedNetwork } = useNetwork()
  const { address } = useAccount()
  const { accessToken } = useAuth()
  const setup = useDeployTemplate()
  const dexes = useQuery({ queryKey: ['dexes'], queryFn: () => contractsApi.listDexes(), staleTime: Infinity })
  const fee = useQuery({ queryKey: ['curve-fee'], queryFn: () => contractsApi.getCurveFee(), staleTime: Infinity })
  const networks = EVM_NETWORKS.filter((n) => dexes.data?.dexes[n.id])

  const [network, setNetwork] = useState(sharedNetwork)
  const dex = dexes.data?.dexes[network]
  const native = EVM_NETWORKS.find((n) => n.id === network)?.nativeToken ?? 'ETH'
  const [name, setName] = useState('')
  const [symbol, setSymbol] = useState('')
  const [supplyText, setSupplyText] = useState('1,000,000,000')
  // null until edited: follows the network's suggestion.
  const [targetEdited, setTargetText] = useState<string | null>(null)
  const [creatorBuyText, setCreatorBuyText] = useState('')
  const [mainnetConfirmed, setMainnetConfirmed] = useState(false)

  const mine = useQuery({
    queryKey: ['curve-launches', accessToken],
    queryFn: async () => (await contractsApi.listDeployments(accessToken!)).deployments.filter((d) => d.template_id === 'curve_token'),
    enabled: Boolean(accessToken),
  })
  const created = setup.step === 'done'
  const refetchMine = mine.refetch
  useEffect(() => {
    if (created) void refetchMine()
  }, [created, refetchMine])
  const mineList = (mine.data ?? []).filter((d) => d.id !== setup.deployment?.id)

  const targetText = targetEdited ?? SUGGESTED_TARGET[network] ?? ''
  const supply = wholeNumber(supplyText)
  const target = toBaseUnits(targetText, 18)
  const creatorBuy = creatorBuyText.trim() ? toBaseUnits(creatorBuyText, 18) : 0n
  const supplyProblem =
    supply === null ? 'Supply is a whole number of tokens.' : supply < MIN_SUPPLY || supply > MAX_SUPPLY ? 'Supply is between 1,000 and 1,000,000,000,000,000.' : null
  const targetProblem =
    target === null ? `Enter a target like ${SUGGESTED_TARGET[network] ?? '4'}.` : target < MIN_TARGET || target > MAX_TARGET ? `The target is between 0.001 and 1,000,000 ${native}.` : null
  const terms = supply !== null && target !== null && !supplyProblem && !targetProblem ? curveTerms(supply, target) : null
  const start = { ethReserve: 0n, tokensSold: 0n }
  const creatorQuote = terms && creatorBuy ? quoteBuy(terms, start, creatorBuy) : null
  const creatorBuyProblem =
    creatorBuy === null
      ? 'Enter an amount like 0.1, or leave it empty.'
      : creatorQuote && creatorQuote.tokens >= terms!.curveSupply
        ? 'That would buy the whole curve. Keep the creator buy below the target.'
        : null
  const isMainnet = isMainnetNetwork(network)
  const busy = setup.step !== 'idle' && setup.step !== 'done' && setup.step !== 'error'

  const canLaunch = Boolean(
    accessToken && address && dex && fee.data && name.trim() && symbol.trim() && terms && !creatorBuyProblem && !busy && (!isMainnet || mainnetConfirmed),
  )
  const launch = () =>
    setup.deploy(
      'curve_token',
      {
        TOKEN_NAME: name.trim(),
        TOKEN_SYMBOL: symbol.trim(),
        TOKEN_SUPPLY: String(supply),
        GRADUATION_TARGET: String(target),
        FACTORY: dex!.factory,
        WRAPPED_NATIVE: dex!.wrapped_native,
        FEE_RECIPIENT: fee.data!.recipient,
      },
      network,
      undefined,
      undefined,
      creatorBuy || undefined,
    )

  const STEP_LABELS: Partial<Record<typeof setup.step, string>> = {
    compiling: 'Preparing the contract…',
    deploying: 'Confirm the launch in your wallet…',
    confirming: 'Waiting for the launch to confirm…',
    recording: 'Saving it to your account…',
  }
  const percentOfSupply = (tokens: bigint) => (terms ? `${formatAmount((Number(tokens) / Number(terms.totalSupply)) * 100)}%` : '')

  return (
    <div className="space-y-6 p-4 sm:p-8">
      <PageHero
        eyebrow="Tokens"
        title="Bonding-curve launch"
        description="Launch a token people can buy right away, with no pool to fund. The price rises as people buy. When the curve has raised its target, everything raised and the rest of the supply go into a DEX pool by themselves, and that liquidity is burned so nobody can pull it."
      />

      {!accessToken ? (
        <SignInPrompt purpose="launch a token on a bonding curve" />
      ) : (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_20rem]">
          <section className="space-y-5 rounded-lg border border-border bg-surface p-5" aria-label="New launch">
            <div className="grid gap-4 sm:grid-cols-[12rem_minmax(0,1fr)_10rem]">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-mono text-xs text-ink-faint">network</span>
                <select value={network} onChange={(event) => setNetwork(event.target.value)} className={inputClass} disabled={busy}>
                  {(networks.length ? networks : EVM_NETWORKS).map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                </select>
              </label>
              <label className="flex min-w-0 flex-col gap-1.5 text-sm">
                <span className="font-mono text-xs text-ink-faint">token name</span>
                <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Nova Coin" maxLength={64} className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-mono text-xs text-ink-faint">symbol</span>
                <input value={symbol} onChange={(event) => setSymbol(event.target.value)} placeholder="NOVA" maxLength={12} className={inputClass} />
              </label>
            </div>
            {!address && <p className="text-sm text-warning">Connect an EVM wallet above to launch.</p>}
            {dexes.isError && <InlineError>Couldn't load the supported DEXes right now.</InlineError>}
            {dexes.data && !dex && <p className="text-sm text-warning">There's no supported DEX on this network for the token to graduate to.</p>}
            {fee.isError && <InlineError>Bonding-curve launches aren't available right now.</InlineError>}

            <div className="grid gap-4 sm:grid-cols-3">
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-mono text-xs text-ink-faint">supply (tokens)</span>
                <input value={supplyText} onChange={(event) => setSupplyText(event.target.value)} inputMode="numeric" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-mono text-xs text-ink-faint">raise target ({native})</span>
                <input value={targetText} onChange={(event) => setTargetText(event.target.value)} inputMode="decimal" className={inputClass} />
              </label>
              <label className="flex flex-col gap-1.5 text-sm">
                <span className="font-mono text-xs text-ink-faint">your buy at launch ({native})</span>
                <input value={creatorBuyText} onChange={(event) => setCreatorBuyText(event.target.value)} inputMode="decimal" placeholder="optional" className={inputClass} />
              </label>
            </div>
            {supplyProblem && <p className="text-sm text-warning">{supplyProblem}</p>}
            {targetProblem && <p className="text-sm text-warning">{targetProblem}</p>}
            {creatorBuyProblem && <p className="text-sm text-warning">{creatorBuyProblem}</p>}
            <p className="text-xs text-ink-faint">
              80% of the supply sells on the curve and the other 20% goes into the pool at graduation. Your buy at launch happens in the same transaction
              as the launch, so nobody can buy before you. Everyone else, you included after launch, buys at the curve's price.
            </p>
          </section>

          <aside className="space-y-4 rounded-lg border border-border bg-surface p-5" aria-label="Summary">
            <dl className="space-y-2 font-mono text-sm">
              {terms ? (
                <>
                  <SummaryRow label="first price">
                    {formatAmount(priceAt(terms, start))} {native}
                  </SummaryRow>
                  <SummaryRow label="graduates at">
                    {formatAmount(graduationPrice(terms))} {native}
                  </SummaryRow>
                  <SummaryRow label="market cap then">
                    {formatAmount(graduationPrice(terms) * Number(supply))} {native}
                  </SummaryRow>
                  <SummaryRow label="pool gets">
                    {fromBaseUnits(target!, 18)} {native} + 20%
                  </SummaryRow>
                  {creatorQuote && creatorQuote.tokens > 0n && !creatorBuyProblem && (
                    <SummaryRow label="you get">
                      {percentOfSupply(creatorQuote.tokens)} of supply
                    </SummaryRow>
                  )}
                </>
              ) : (
                <SummaryRow label="first price">—</SummaryRow>
              )}
              <SummaryRow label="DEX">{dex?.name ?? '—'}</SummaryRow>
              <SummaryRow label="trading fee">1% to the platform</SummaryRow>
              <SummaryRow label="transactions">1</SummaryRow>
            </dl>
            <p className="text-xs text-ink-faint">
              One transaction creates the token, its curve and its future pool. You pay the network's gas{creatorBuy ? ', plus your buy and its fee' : ''}.
              Every buy and sell on the curve, yours included, pays a 1% fee to the platform. It's kept apart from what the curve raises, so the pool
              still gets all of it. Trades on the DEX after graduation pay no platform fee.
            </p>
            {isMainnet && (
              <MainnetConfirmCheckbox
                checked={mainnetConfirmed}
                onChange={setMainnetConfirmed}
                disabled={busy}
                verb="launches a token on"
                networkLabel={EVM_NETWORKS.find((n) => n.id === network)?.label ?? network}
              />
            )}
            <Button className="w-full" onClick={() => void launch()} isLoading={busy} disabled={!canLaunch}>
              [ launch on the curve ]
            </Button>
            {busy && (
              <p role="status" className="text-sm text-ink-muted">
                {STEP_LABELS[setup.step]}
              </p>
            )}
            {setup.error && <InlineError>{setup.error}</InlineError>}
          </aside>
        </div>
      )}

      {setup.deployment && (
        <section aria-labelledby="curve-created" className="space-y-3">
          <h2 id="curve-created" className="font-mono text-sm font-semibold text-ink-faint">
            launched
          </h2>
          <p className="break-all font-mono text-xs text-ink-muted" data-testid="curve-created">
            {setup.deployment.contract_address}
          </p>
          <p className="text-sm text-ink-muted">
            Share its{' '}
            <Link to={`/token/${setup.deployment.network}/${setup.deployment.contract_address}`} className="text-accent-400 underline">
              public page
            </Link>
            : anyone can buy there with their own wallet, no account needed.
          </p>
          <CurvePanel key={setup.deployment.id} network={setup.deployment.network} address={setup.deployment.contract_address as `0x${string}`} dexName={dex?.name} />
        </section>
      )}

      {accessToken && (
        <section aria-labelledby="curve-mine" className="space-y-3">
          <h2 id="curve-mine" className="font-mono text-sm font-semibold text-ink-faint">
            your curve launches
          </h2>
          <p className="text-sm text-ink-muted">
            Everyone's launches are on the public{' '}
            <Link to="/launches" className="text-accent-400 underline">
              new launches
            </Link>{' '}
            page.
          </p>
          {mine.isLoading ? (
            <p className="text-sm text-ink-muted">Loading…</p>
          ) : mine.error ? (
            <InlineError>Couldn't load your launches.</InlineError>
          ) : !mineList.length ? (
            <p className="text-sm text-ink-muted">None yet. Each token you launch on a curve shows up here, with how far it is from graduating.</p>
          ) : (
            <div className="grid gap-3 lg:grid-cols-2">
              {mineList.map((d) => (
                <div key={d.id} className="space-y-1">
                  <p className="font-mono text-xs text-ink-faint">
                    {EVM_NETWORKS.find((n) => n.id === d.network)?.label ?? d.network} · {String(d.parameters.TOKEN_SYMBOL ?? '')} ·{' '}
                    <Link to={`/token/${d.network}/${d.contract_address}`} className="text-accent-400 underline">
                      {short(d.contract_address)}
                    </Link>
                  </p>
                  <CurvePanel network={d.network} address={d.contract_address as `0x${string}`} dexName={dexes.data?.dexes[d.network]?.name} />
                </div>
              ))}
            </div>
          )}
        </section>
      )}
    </div>
  )
}
