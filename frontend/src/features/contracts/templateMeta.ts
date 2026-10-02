import type { ComponentType } from 'react'

import { IconBolt, IconClock, IconCoin, IconImage, IconLock } from '../../components/ui/icons'

// Presentation only — what a template card shows beyond the backend's name
// and description. An unknown template id falls back to a generic look, so
// a new backend template still renders without a change here.
export interface TemplateMeta {
  icon: ComponentType<{ className?: string }>
  tags: string[]
  // Which parameter names the summary panel echoes as the contract's
  // identity (the first one present wins).
  identityParams: string[]
}

const META: Record<string, TemplateMeta> = {
  erc20_basic: { icon: IconCoin, tags: ['Mintable', 'Burnable', 'Fixed decimals'], identityParams: ['TOKEN_NAME'] },
  erc20_advanced: { icon: IconBolt, tags: ['Buy/sell tax', 'Anti-whale limits', 'Trading switch'], identityParams: ['TOKEN_NAME'] },
  erc721_basic: { icon: IconImage, tags: ['Public mint', 'Mint price', 'Metadata URI'], identityParams: ['COLLECTION_NAME'] },
  token_timelock: { icon: IconLock, tags: ['No owner', 'Release date', 'LP locks'], identityParams: [] },
  token_vesting: { icon: IconClock, tags: ['No owner', 'Cliff', 'Linear unlock'], identityParams: [] },
  multisend: { icon: IconBolt, tags: ['No owner', 'Airdrops', 'Shared'], identityParams: [] },
}

export function templateMeta(id: string): TemplateMeta {
  return META[id] ?? { icon: IconCoin, tags: [], identityParams: [] }
}

// Utility templates (the Multisend) are plumbing other tools deploy for
// you — not something to pick and configure by hand.
export function isPickable(template: { type: string }): boolean {
  return template.type !== 'utility'
}
