import { Badge, type BadgeTone } from '../../../components/ui/Badge'

const TIER_TONE: Record<string, BadgeTone> = {
  common: 'neutral',
  uncommon: 'success',
  rare: 'accent',
  legendary: 'warning',
}

export function RarityBadge({ tier }: { tier: string }) {
  return (
    <Badge tone={TIER_TONE[tier] ?? 'neutral'}>
      <span className="capitalize">{tier}</span>
    </Badge>
  )
}
