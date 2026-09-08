import type { NFTGeneratedItem } from '../../lib/nftApi'

interface Props {
  items: NFTGeneratedItem[]
}

interface TraitStat {
  value: string
  count: number
  percentage: number
}

// The real, measured spread of what actually got generated — distinct from
// the rarity_weight a creator sets per trait (the input), this is the
// output: how often each value actually landed across the real generated
// items, computed from the same attributes.trait_type/value pairs already
// in hand from listItems(), no new endpoint or AI call needed.
function computeDistribution(items: NFTGeneratedItem[]): [string, TraitStat[]][] {
  const counts = new Map<string, Map<string, number>>()
  for (const item of items) {
    for (const attribute of item.attributes) {
      const byValue = counts.get(attribute.trait_type) ?? new Map<string, number>()
      byValue.set(attribute.value, (byValue.get(attribute.value) ?? 0) + 1)
      counts.set(attribute.trait_type, byValue)
    }
  }

  return Array.from(counts.entries()).map(([traitType, byValue]) => {
    const stats: TraitStat[] = Array.from(byValue.entries())
      .map(([value, count]) => ({ value, count, percentage: (count / items.length) * 100 }))
      .sort((a, b) => a.percentage - b.percentage) // rarest (most interesting) first
    return [traitType, stats]
  })
}

export function RarityDistribution({ items }: Props) {
  if (items.length === 0) return null

  return (
    <div className="space-y-3 rounded-md border border-border bg-canvas p-3">
      <p className="text-xs text-ink-faint">
        The actual trait spread across {items.length} generated item{items.length === 1 ? '' : 's'} — what your
        rarity weights actually produced, not the weights themselves.
      </p>
      {computeDistribution(items).map(([traitType, stats]) => (
        <div key={traitType}>
          <p className="mb-1 text-xs font-medium text-ink">{traitType}</p>
          <div className="space-y-1">
            {stats.map((stat) => (
              <div key={stat.value} className="flex items-center gap-2 text-xs">
                <span className="w-24 shrink-0 truncate text-ink-muted" title={stat.value}>
                  {stat.value}
                </span>
                <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-hover">
                  <div className="h-full rounded-full bg-accent-500" style={{ width: `${stat.percentage}%` }} />
                </div>
                <span className="w-20 shrink-0 text-right tabular-nums text-ink-faint">
                  {stat.percentage.toFixed(1)}% ({stat.count})
                </span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  )
}
