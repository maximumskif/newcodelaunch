import { describe, expect, it } from 'vitest'

import { projectHref } from './projectTypes'

describe('projectHref', () => {
  it('opens a Solana token project on the Launchpad’s Solana tab', () => {
    expect(projectHref({ id: 'p1', project_type: 'token', chain: 'solana' })).toBe('/tokens/create?project=p1&chain=solana')
  })

  it('leaves every other project where it always went', () => {
    expect(projectHref({ id: 'p1', project_type: 'token', chain: 'evm' })).toBe('/tokens/create?project=p1')
    expect(projectHref({ id: 'p2', project_type: 'nft_collection', chain: 'evm' })).toBe('/nfts/generator?project=p2')
    expect(projectHref({ id: 'p3', project_type: 'candy_machine', chain: 'solana' })).toBe('/drops/launch?project=p3')
  })
})
