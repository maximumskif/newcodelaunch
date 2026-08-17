import type { ComponentType } from 'react'

import { IconCandy, IconCode, IconCoin, IconLayers } from '../components/ui/icons'
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
// Resume/View action to the right existing feature page).
//
// `candy_machine` is here for the dashboard's sake (Project.to_dict() on the
// backend has included a candy_machine_deployment link since Phase 6, and
// PROJECT_TYPES[project.project_type] must resolve for every type a Project
// row can actually have, or ProjectsDashboard.tsx crashes rendering that
// card) even though nothing creates one today: the wizard's type picker
// intentionally excludes it (a candy machine's entry point is always an
// already-published NFT collection, never a bare draft), and
// MintLaunchPage.tsx doesn't yet pass a project_id when recording one either
// — wiring that end-to-end is a separate, not-yet-scoped follow-up.
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
  candy_machine: {
    label: 'Candy Machine',
    description: 'Launch a Solana Candy Machine from a published NFT collection.',
    path: '/mint',
    icon: IconCandy,
    needsNetwork: true,
  },
}
