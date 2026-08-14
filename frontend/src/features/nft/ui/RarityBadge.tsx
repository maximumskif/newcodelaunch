const TIER_STYLES: Record<string, string> = {
  common: 'bg-white/10 text-white/70 ring-white/15',
  uncommon: 'bg-emerald-500/15 text-emerald-300 ring-emerald-400/30',
  rare: 'bg-violet-500/15 text-violet-300 ring-violet-400/30',
  legendary: 'bg-gradient-to-r from-amber-500/20 to-purple-500/20 text-amber-200 ring-amber-400/30',
}

export function RarityBadge({ tier }: { tier: string }) {
  const style = TIER_STYLES[tier] ?? TIER_STYLES.common
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium capitalize ring-1 ${style}`}>
      {tier}
    </span>
  )
}
