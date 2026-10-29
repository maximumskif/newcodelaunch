import { useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'
import { formatUnits } from 'viem'
import { useAccount, useConnect, usePublicClient, useWriteContract } from 'wagmi'

import { Badge } from '../../components/ui/Badge'
import { Button } from '../../components/ui/Button'
import { InlineError } from '../../components/ui/InlineError'
import { fromBaseUnits, toBaseUnits } from '../../lib/airdrop'
import { formatAmount } from '../../lib/marketFormat'
import { CURVE_ABI, priceAt, progress, quoteBuy, quoteSell, withSlippage, type CurveTerms } from '../../lib/curve'
import { pickEvmConnector } from '../auth/evmConnector'
import { NETWORK_TO_CHAIN_ID } from '../contracts/useDeployTemplate'
import { useOwnerTransaction } from '../contracts/useOwnerTransaction'
import { EVM_NETWORKS } from '../network/NetworkContext'

// The curve's argument-less views.
type ViewFunction =
  | 'symbol'
  | 'totalSupply'
  | 'curveSupply'
  | 'poolSupply'
  | 'graduationTarget'
  | 'virtualEth'
  | 'virtualTokens'
  | 'ethReserve'
  | 'tokensSold'
  | 'graduated'
  | 'pair'
  | 'creator'
  | 'creatorFeesOwed'

const inputClass =
  'h-10 min-w-0 flex-1 rounded-md border border-border bg-canvas px-3 font-mono text-sm text-ink placeholder:text-ink-faint focus:border-accent-500 focus:outline-none'

// Buying and selling on a Bonding-Curve Token, for anyone with a wallet —
// no sign-in, it's the buyer's own transaction. Quotes use the contract's
// own math on the state just read (lib/curve.ts matches it to the wei),
// with 1% slippage, so a trade that lands after someone else's still goes
// through unless the price moved more than that. Each shows the 1% fee it
// pays. The curve's creator also sees their 0.3% share building up, and
// claims it here.
export function CurvePanel({ network, address, dexName = 'the DEX' }: { network: string; address: `0x${string}`; dexName?: string }) {
  const chainId = NETWORK_TO_CHAIN_ID[network]
  const native = EVM_NETWORKS.find((n) => n.id === network)?.nativeToken ?? 'ETH'
  const publicClient = usePublicClient({ chainId })
  const { address: wallet } = useAccount()
  const { connectors, connect } = useConnect()
  const { writeContractAsync } = useWriteContract()
  const queryClient = useQueryClient()
  const [side, setSide] = useState<'buy' | 'sell'>('buy')
  const [amountText, setAmountText] = useState('')

  const reads = useQuery({
    queryKey: ['curve', chainId, address, wallet],
    enabled: Boolean(publicClient),
    refetchInterval: 15_000,
    queryFn: async () => {
      const client = publicClient!
      const read = <F extends ViewFunction>(functionName: F) => client.readContract({ address, abi: CURVE_ABI, functionName })
      const [symbol, totalSupply, curveSupply, poolSupply, target, virtualEth, virtualTokens, ethReserve, tokensSold, graduated, pair, creator, creatorFees] = await Promise.all([
        read('symbol'),
        read('totalSupply'),
        read('curveSupply'),
        read('poolSupply'),
        read('graduationTarget'),
        read('virtualEth'),
        read('virtualTokens'),
        read('ethReserve'),
        read('tokensSold'),
        read('graduated'),
        read('pair'),
        read('creator'),
        read('creatorFeesOwed'),
      ])
      const [held, nativeBalance] = wallet
        ? await Promise.all([
            client.readContract({ address, abi: CURVE_ABI, functionName: 'balanceOf', args: [wallet] }),
            client.getBalance({ address: wallet }),
          ])
        : [0n, 0n]
      const terms: CurveTerms = { totalSupply, curveSupply, poolSupply, target, virtualEth, virtualTokens }
      return { symbol, terms, state: { ethReserve, tokensSold }, graduated, pair, held, nativeBalance, creator, creatorFees }
    },
  })

  const { send, isBusy, error, done } = useOwnerTransaction<'buy' | 'sell' | 'claim'>({
    chainId,
    doneMessages: { buy: 'Bought.', sell: 'Sold.', claim: 'Your creator fees are on their way to your wallet.' },
    onSettled: ({ status }) => {
      if (status === 'success') setAmountText('')
      void reads.refetch()
      // The trade list and chart (CurveActivity), if shown alongside.
      void queryClient.invalidateQueries({ queryKey: ['curve-trades', network, address] })
    },
  })

  if (reads.isLoading) return <p className="text-sm text-ink-muted">Reading the curve…</p>
  if (reads.isError || !reads.data) return <InlineError>Couldn't read this curve right now.</InlineError>

  const { symbol, terms, state, graduated, pair, held, nativeBalance, creator, creatorFees } = reads.data
  const isCreator = Boolean(wallet && creator.toLowerCase() === wallet.toLowerCase())
  const short = (n: bigint) => formatAmount(Number(formatUnits(n, 18)))
  const tokens = (n: bigint) => `${short(n)} ${symbol}`
  const coins = (n: bigint) => `${short(n)} ${native}`
  const raised = progress(terms, state)
  const percent = Math.floor(raised * 1000) / 10
  const price = priceAt(terms, state)
  const marketCap = price * (Number(terms.totalSupply) / 1e18)

  const amount = toBaseUnits(amountText, 18)
  const buy = side === 'buy' && amount ? quoteBuy(terms, state, amount) : null
  const sale = side === 'sell' && amount ? quoteSell(terms, state, amount) : null
  const sellEth = sale?.eth ?? null
  const buysOut = Boolean(buy && buy.tokens > 0n && state.tokensSold + buy.tokens === terms.curveSupply)
  const overBalance = amount !== null && (side === 'buy' ? amount > nativeBalance : amount > held)
  const canTrade = Boolean(wallet && amount && !overBalance && !isBusy() && (side === 'buy' ? buy && buy.tokens > 0n : sellEth && sellEth > 0n))

  const trade = () =>
    side === 'buy'
      ? void send('buy', () =>
          writeContractAsync({ address, abi: CURVE_ABI, functionName: 'buy', args: [withSlippage(buy!.tokens)], value: amount!, chainId }),
        )
      : void send('sell', () =>
          writeContractAsync({ address, abi: CURVE_ABI, functionName: 'sell', args: [amount!, withSlippage(sellEth!)], chainId }),
        )

  return (
    <div className="space-y-4 rounded-lg border border-border bg-surface-raised p-4 text-sm" data-testid="curve-panel">
      <div className="flex flex-wrap gap-2">
        {graduated ? <Badge tone="success">Graduated to {dexName}</Badge> : <Badge tone="info">On the bonding curve</Badge>}
        <Badge tone="neutral">
          1 {symbol} = {formatAmount(price)} {native}
        </Badge>
        <Badge tone="neutral">
          market cap {formatAmount(marketCap)} {native}
        </Badge>
      </div>

      <div className="space-y-1.5">
        <div
          className="h-2 overflow-hidden rounded-full bg-surface"
          role="progressbar"
          aria-label="Raised toward graduation"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={graduated ? 100 : percent}
        >
          <div className="h-full bg-accent-500" style={{ width: `${graduated ? 100 : percent}%` }} />
        </div>
        <p className="font-mono text-xs text-ink-muted" data-testid="curve-progress">
          {graduated
            ? `Raised ${coins(state.ethReserve)}; it all went into the ${dexName} pool, with the liquidity burned`
            : `${percent}% · ${coins(state.ethReserve)} of ${coins(terms.target)} raised · ${tokens(terms.curveSupply - state.tokensSold)} left on the curve`}
        </p>
      </div>

      {graduated ? (
        <p className="text-ink-muted">
          The curve is closed. {symbol} now trades on {dexName} like any token. Its pool is <span className="break-all font-mono text-xs">{pair}</span>, and
          nobody can withdraw that liquidity.
        </p>
      ) : !wallet ? (
        <Button
          size="sm"
          onClick={() => {
            const connector = pickEvmConnector(connectors)
            if (connector) connect({ connector })
          }}
        >
          Connect wallet to trade
        </Button>
      ) : (
        <div className="space-y-3 border-t border-border pt-3">
          <div className="inline-flex rounded-lg border border-border p-1" role="group" aria-label="Buy or sell">
            {(['buy', 'sell'] as const).map((item) => (
              <button
                key={item}
                type="button"
                aria-pressed={side === item}
                disabled={isBusy()}
                onClick={() => {
                  setSide(item)
                  setAmountText('')
                }}
                className={`rounded-md px-3 py-1.5 text-sm capitalize transition-colors duration-150 ${
                  side === item ? 'bg-accent-500/15 text-ink' : 'text-ink-muted hover:bg-surface-hover'
                }`}
              >
                {item}
              </button>
            ))}
          </div>
          <label className="block text-xs text-ink-muted" htmlFor={`curve-amount-${address}`}>
            {side === 'buy' ? `Spend (${native}) · you have ${coins(nativeBalance)}` : `Sell (${symbol}) · you hold ${tokens(held)}`}
          </label>
          <div className="flex gap-2">
            <input
              id={`curve-amount-${address}`}
              value={amountText}
              onChange={(event) => setAmountText(event.target.value)}
              inputMode="decimal"
              placeholder="0"
              className={inputClass}
            />
            {side === 'sell' && held > 0n && (
              <Button size="sm" variant="ghost" onClick={() => setAmountText(fromBaseUnits(held, 18, { grouped: false }))}>
                max
              </Button>
            )}
            <Button size="sm" disabled={!canTrade} isLoading={isBusy()} onClick={trade}>
              {side === 'buy' ? 'Buy' : 'Sell'}
            </Button>
          </div>
          {amountText.trim() && amount === null && <p className="text-xs text-warning">Enter an amount like 0.05.</p>}
          {overBalance && <p className="text-xs text-warning">That's more than this wallet has.</p>}
          {buy && buy.tokens > 0n && !overBalance && (
            <p className="font-mono text-xs text-ink-muted" data-testid="curve-quote">
              {buysOut
                ? `Buys the last ${tokens(buy.tokens)} for ${coins(buy.cost + buy.fee)}, fee included; the rest is refunded. This graduates it to ${dexName}.`
                : `≈ ${tokens(buy.tokens)} (at least ${tokens(withSlippage(buy.tokens))}) · includes a ${coins(buy.fee)} fee`}
            </p>
          )}
          {buy && buy.tokens === 0n && <p className="text-xs text-warning">Too little to buy any tokens.</p>}
          {sellEth !== null && amount !== null && amount > 0n && !overBalance && (
            <p className="font-mono text-xs text-ink-muted" data-testid="curve-quote">
              {sellEth > 0n
                ? `≈ ${coins(sellEth)} (at least ${coins(withSlippage(sellEth))}) after a ${coins(sale!.fee)} fee`
                : 'Too few tokens to get anything back.'}
            </p>
          )}
        </div>
      )}

      {isCreator && (
        <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3" data-testid="curve-creator-fees">
          <p className="text-ink-muted">
            You launched this. Your 0.3% of every trade: <span className="font-mono text-ink">{coins(creatorFees)}</span> to claim.
          </p>
          <Button
            size="sm"
            variant="ghost"
            disabled={creatorFees === 0n || isBusy()}
            onClick={() => void send('claim', () => writeContractAsync({ address, abi: CURVE_ABI, functionName: 'claimCreatorFees', chainId }))}
          >
            Claim
          </Button>
        </div>
      )}
      {!graduated && <p className="text-xs text-ink-faint">Every buy and sell on the curve pays a 1% fee: 0.3% to its creator and 0.7% to the platform.</p>}
      {done && <p className="text-success">{done}</p>}
      {error && <InlineError>{error}</InlineError>}
    </div>
  )
}
