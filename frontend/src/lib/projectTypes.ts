import type { ComponentType } from 'react'

import { IconCode, IconCoin, IconLayers } from '../components/ui/icons'
import type { ProjectType } from './projectsApi'

interface ProjectTypeMeta {
  label: string
  description: string
  path: string
  icon: ComponentType<{ className?: string }>
  needsNetwork: boolean
}

// Single source of truth for what a project "is" — used by the new-project
// wizard (to build the type picker) and the dashboard (to route a project's
// Resume/View action to the right existing feature page). Deliberately only
// covers the three flows that are actually built (Token Launchpad, NFT
// Generator, Smart Contracts Hub) — no entry for Candy Machine/DeFi/etc.
// since a project of that type could never link to anything real yet.
export const PROJECT_TYPES: Record<ProjectType, ProjectTypeMeta> = {
  token: {
    label: 'Token',
    description: 'Deploy an ERC-20 token from a compiled Solidity template.',
    path: '/tokens',
    icon: IconCoin,
    needsNetwork: true,
  },
  nft_collection: {
    label: 'NFT Collection',
    description: 'Build a layered trait collection and publish it to IPFS.',
    path: '/nft',
    icon: IconLayers,
    needsNetwork: false,
  },
  contract: {
    label: 'Custom Contract',
    description: 'Deploy any template from the Smart Contracts Hub.',
    path: '/contracts',
    icon: IconCode,
    needsNetwork: true,
  },
}
