import { useQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { formatUnits } from 'viem'

import { Button } from '../../components/ui/Button'
import { InlineError } from '../../components/ui/InlineError'
import { pricePoints, type CurveTerms } from '../../lib/curve'
import { formatAmount, timeAgo } from '../../lib/marketFormat'
import { tokenPagesApi } from '../../lib/tokenPagesApi'

const SHOWN = 15
const W = 600
const H = 180
const PAD = { top: 12, right: 12, bottom: 22, left: 12 }

const short = (address: string) => `${address.slice(0, 6)}…${address.slice(-4)}`
const amount = (raw: string) => formatAmount(Number(formatUnits(BigInt(raw), 18)))

// A bonding-curve token's recent trades: price after each trade (one
// series, so the title names it and there's no legend), with a hover
// tooltip, and the trades as a table, which is also the chart's text view.
export function CurveActivity({ network, address, terms, symbol, native }: { network: string; address: string; terms: CurveTerms; symbol: string; native: string }) {
  const trades = useQuery({
    queryKey: ['curve-trades', network, address],
    queryFn: () => tokenPagesApi.curveTrades(network, address),
    refetchInterval: 20_000,
  })
  const [showAll, setShowAll] = useState(false)
  const [hover, setHover] = useState<number | null>(null)

  if (trades.isLoading) return <p className="text-sm text-ink-muted">Reading trades…</p>
  if (trades.isError || !trades.data) return <InlineError>Couldn't read this token's trades right now.</InlineError>

  const { trades: list, trade_count, explorer_tx } = trades.data
  if (!list.length) return <p className="text-sm text-ink-muted">No trades yet. The first buy starts the chart.</p>

  // With the whole history here, the line starts at the launch price.
  const sinceLaunch = trade_count === list.length
  const points = pricePoints(terms, list, { fromLaunch: sinceLaunch })
  const period = sinceLaunch ? 'since launch' : `over the last ${list.length} trades`
  const prices = points.map((p) => p.price)
  const low = Math.min(...prices)
  const high = Math.max(...prices)
  const span = high - low || high || 1
  const x = (i: number) => PAD.left + (points.length === 1 ? (W - PAD.left - PAD.right) / 2 : (i / (points.length - 1)) * (W - PAD.left - PAD.right))
  const y = (price: number) => PAD.top + (1 - (price - low) / span) * (H - PAD.top - PAD.bottom)
  const path = points.map((p, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(p.price).toFixed(1)}`).join(' ')
  const hovered = hover !== null ? points[hover] : null
  const rows = showAll ? list : list.slice(0, SHOWN)
  const change = prices.length > 1 ? (prices[prices.length - 1] / prices[0] - 1) * 100 : null

  return (
    <div className="space-y-4" data-testid="curve-activity">
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="font-mono text-sm text-ink">
            Price in {native}, {period}
          </h3>
          {change !== null && (
            <p className="font-mono text-xs text-ink-muted">
              {change >= 0 ? '+' : '−'}
              {Math.abs(change).toFixed(1)}% · low {formatAmount(low)} · high {formatAmount(high)}
            </p>
          )}
        </div>
        <div className="relative mt-2">
          <svg
            viewBox={`0 0 ${W} ${H}`}
            className="h-44 w-full text-accent-500"
            role="img"
            aria-label={`Price ${period}, from ${formatAmount(prices[0])} to ${formatAmount(prices[prices.length - 1])} ${native}. The trades are listed below.`}
            preserveAspectRatio="none"
            onMouseLeave={() => setHover(null)}
          >
            {[0, 0.5, 1].map((f) => (
              <line key={f} x1={PAD.left} x2={W - PAD.right} y1={PAD.top + f * (H - PAD.top - PAD.bottom)} y2={PAD.top + f * (H - PAD.top - PAD.bottom)} className="stroke-border" strokeWidth={1} vectorEffect="non-scaling-stroke" />
            ))}
            <path d={path} fill="none" stroke="currentColor" strokeWidth={2} strokeLinejoin="round" vectorEffect="non-scaling-stroke" />
            {hovered && (
              <line x1={x(hover!)} x2={x(hover!)} y1={PAD.top} y2={H - PAD.bottom} className="stroke-ink-faint" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />
            )}
            {/* Hit targets: a full-height band per trade, wider than the line. */}
            {points.map((_, i) => {
              const left = i === 0 ? 0 : (x(i - 1) + x(i)) / 2
              const right = i === points.length - 1 ? W : (x(i) + x(i + 1)) / 2
              return <rect key={i} x={left} y={0} width={right - left} height={H} fill="transparent" onMouseEnter={() => setHover(i)} />
            })}
          </svg>
          {hovered && (
            <div
              className="pointer-events-none absolute top-0 z-10 rounded-md border border-border bg-surface px-2.5 py-1.5 font-mono text-xs text-ink shadow-lg"
              style={{ left: `${(x(hover!) / W) * 100}%`, transform: `translateX(${x(hover!) > W / 2 ? '-105%' : '5%'})` }}
            >
              <p>
                {formatAmount(hovered.price)} {native}
              </p>
              <p className="text-ink-muted">
                {hovered.trade ? `${hovered.trade.kind} ${amount(hovered.trade.tokens)} ${symbol} · ${timeAgo(hovered.trade.time)}` : 'launch price'}
              </p>
            </div>
          )}
          <div className="mt-1 flex justify-between font-mono text-[11px] text-ink-faint">
            <span>{points[0].trade ? timeAgo(points[0].trade.time) : 'launch'}</span>
            <span>{timeAgo(points[points.length - 1].trade!.time)}</span>
          </div>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-left font-mono text-xs">
          <caption className="mb-2 text-left text-ink-muted">
            {trade_count > list.length ? `Latest ${list.length} of ${trade_count} trades` : `${trade_count} trade${trade_count === 1 ? '' : 's'}`}
          </caption>
          <thead className="text-ink-faint">
            <tr>
              <th scope="col" className="py-1.5 pr-3 font-normal">trade</th>
              <th scope="col" className="hidden py-1.5 pr-3 font-normal sm:table-cell">wallet</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-normal">{native}</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-normal">{symbol}</th>
              <th scope="col" className="py-1.5 pr-3 text-right font-normal">when</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((trade) => (
              <tr key={`${trade.tx}-${trade.kind}-${trade.tokens}`} className="border-t border-border">
                <td className={`py-1.5 pr-3 ${trade.kind === 'buy' ? 'text-success' : 'text-warning'}`}>{trade.kind === 'buy' ? '▲ buy' : '▼ sell'}</td>
                <td className="hidden py-1.5 pr-3 text-ink-muted sm:table-cell">{short(trade.wallet)}</td>
                {/* What the trader paid (fee included) or received. */}
                <td className="py-1.5 pr-3 text-right text-ink">{amount(trade.kind === 'buy' ? String(BigInt(trade.eth) + BigInt(trade.fee)) : trade.eth)}</td>
                <td className="py-1.5 pr-3 text-right text-ink">{amount(trade.tokens)}</td>
                <td className="py-1.5 pr-3 text-right text-ink-muted">
                  {explorer_tx ? (
                    <a href={`${explorer_tx}${trade.tx}`} target="_blank" rel="noreferrer" className="underline decoration-dotted hover:text-accent-400">
                      {timeAgo(trade.time)}
                    </a>
                  ) : (
                    timeAgo(trade.time)
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {list.length > SHOWN && (
        <Button variant="ghost" size="sm" onClick={() => setShowAll(!showAll)}>
          {showAll ? 'Show fewer' : `Show all ${list.length}`}
        </Button>
      )}
    </div>
  )
}
