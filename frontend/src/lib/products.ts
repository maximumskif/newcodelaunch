import type { ComponentType } from 'react'

import { IconCode, IconCoin, IconLayers } from '../components/ui/icons'

export interface ProductLink {
  label: string
  path?: string
  icon?: ComponentType<{ className?: string }>
}

// Single source of truth for "what counts as a product" — used by both the
// marketing nav's Products dropdown and the app shell's sidebar. Live items
// have a path and route to a real page; everything else is shown with a
// "Soon" badge instead of a route to an empty placeholder.
export const PRODUCTS: ProductLink[] = [
  { label: 'Token Launchpad', path: '/tokens', icon: IconCoin },
  { label: 'NFT Generator', path: '/nft', icon: IconLayers },
  { label: 'Smart Contracts Hub', path: '/contracts', icon: IconCode },
  { label: 'Candy Machine' },
  { label: 'DeFi Scanner' },
  { label: 'Market Intelligence' },
]
