import type { ComponentType } from 'react'

import { IconCandy, IconChart, IconCode, IconCoin, IconLayers, IconStack, IconTemplate } from '../components/ui/icons'

export interface ProductLink {
  label: string
  path?: string
  icon?: ComponentType<{ className?: string }>
  // Sidebar section heading.
  group: 'Build' | 'Launch' | 'Research'
}

// Single source of truth for "what counts as a product" — used by both the
// marketing nav's Products dropdown and the app shell's sidebar. Live items
// have a path and route to a real page; everything else is shown with a
// "Soon" badge instead of a route to an empty placeholder.
export const PRODUCTS: ProductLink[] = [
  { group: 'Build', label: 'Token Launchpad', path: '/tokens', icon: IconCoin },
  { group: 'Build', label: 'NFT Generator', path: '/nft', icon: IconLayers },
  { group: 'Build', label: 'Smart Contracts Hub', path: '/contracts', icon: IconCode },
  { group: 'Research', label: 'Market Intelligence', path: '/market', icon: IconChart },
  { group: 'Research', label: 'DeFi Scanner', path: '/defi', icon: IconStack },
  { group: 'Build', label: 'Template Marketplace', path: '/marketplace', icon: IconTemplate },
  { group: 'Launch', label: 'Candy Machine', path: '/mint', icon: IconCandy },
]
