import type { ComponentType } from 'react'

import { IconCandy, IconCode, IconCoin, IconLayers } from '../components/ui/icons'
import type { ProjectType } from './projectsApi'

interface ProjectTypeMeta {
  label: string
  description: string
  path: string
  icon: ComponentType<{ className?: string }>
  needsNetwork: boolean
  // False for a type that can only ever come from linking an existing
  // record (see candy_machine below) — NewProjectWizard.tsx's type picker
  // filters to just the creatable ones via WIZARD_PROJECT_TYPES, so a type
  // added here for the dashboard's sake doesn't also silently become
  // something the wizard offers to start from a bare draft.
  creatableViaWizard: boolean
}

// Single source of truth for what a project "is" — used by the new-project
// wizard (to build the type picker) and the dashboard (to route a project's
// Resume/View action to the right existing feature page).
//
// `candy_machine` is here for the dashboard's sake (Project.to_dict() on the
// backend has included a candy_machine_deployment link since Phase 6, and
// PROJECT_TYPES[project.project_type] must resolve for every type a Project
// row can actually have, or ProjectsDashboard.tsx crashes rendering that
// card) — but note creatableViaWizard: false below: a candy machine's entry
// point is always an already-published NFT collection, never a bare draft,
// so chain:'evm'/an EVM network would make no sense for one. The real entry
// point is GenerateStep.tsx's "Launch Mint Site" link, which carries
// ?project=<id> through to MintLaunchPage.tsx when arrived at via an
// NFT-collection project — see that page for the actual linking.
export const PROJECT_TYPES: Record<ProjectType, ProjectTypeMeta> = {
  token: {
    label: 'Token',
    description: 'Deploy an ERC-20 token from a compiled Solidity template.',
    path: '/tokens',
    icon: IconCoin,
    needsNetwork: true,
    creatableViaWizard: true,
  },
  nft_collection: {
    label: 'NFT Collection',
    description: 'Build a layered trait collection and publish it to IPFS.',
    path: '/nft',
    icon: IconLayers,
    needsNetwork: false,
    creatableViaWizard: true,
  },
  contract: {
    label: 'Custom Contract',
    description: 'Deploy any template from the Smart Contracts Hub.',
    path: '/contracts',
    icon: IconCode,
    needsNetwork: true,
    creatableViaWizard: true,
  },
  candy_machine: {
    label: 'Candy Machine',
    description: 'Launch a Solana Candy Machine from a published NFT collection.',
    path: '/mint',
    icon: IconCandy,
    needsNetwork: true,
    creatableViaWizard: false,
  },
}

export const WIZARD_PROJECT_TYPES = Object.fromEntries(
  Object.entries(PROJECT_TYPES).filter(([, meta]) => meta.creatableViaWizard),
) as Partial<Record<ProjectType, ProjectTypeMeta>>
