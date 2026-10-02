import { describe, expect, it } from 'vitest'

import { ALL_TOOLS, LEGACY_REDIRECTS, PILLARS, pillarForPath, toolForPath } from './pillars'

// Every page App.tsx routes to inside the app shell (kept in step with it).
const APP_ROUTES = new Set([
  '/dashboard', '/tools', '/tokens/create', '/nfts/generator', '/nfts/deploy-evm', '/contracts/deploy',
  '/contracts/templates', '/drops/launch', '/research/market', '/research/defi', '/research/check', '/liquidity/airdrop', '/liquidity/snapshot', '/liquidity/vesting', '/tokens/burn', ...PILLARS.map((p) => p.path),
])

describe('pillars', () => {
  it('points every live tool at a real page, and gives "soon" tools no link', () => {
    for (const tool of ALL_TOOLS) {
      if (tool.status === 'soon') expect(tool.path, tool.id).toBeUndefined()
      else expect(APP_ROUTES.has(tool.path!.split(/[?#]/)[0]), `${tool.id} → ${tool.path}`).toBe(true)
    }
  })

  it('redirects every old URL to a real page', () => {
    for (const target of Object.values(LEGACY_REDIRECTS)) expect(APP_ROUTES.has(target), target).toBe(true)
  })

  it('knows which area and tool a route belongs to', () => {
    expect(pillarForPath('/nfts/generator')?.id).toBe('nfts')
    expect(pillarForPath('/drops')?.id).toBe('drops')
    expect(pillarForPath('/mint/buy/abc')?.id).toBe('drops')
    expect(pillarForPath('/token/sepolia/0x1')?.id).toBe('tokens')
    expect(pillarForPath('/tokensomething')).toBeNull()
    expect(pillarForPath('/dashboard')).toBeNull()
    expect(toolForPath('/nfts/generator')?.id).toBe('nft-generator')
    expect(toolForPath('/drops')).toBeNull()
    // Tools sharing a page: the plain path is the page's own tool; query or
    // hash pick the more specific one.
    expect(toolForPath('/contracts/deploy')?.id).toBe('contracts-deploy')
    expect(toolForPath('/contracts/deploy', '?template=token_timelock')?.id).toBe('contracts-timelock')
    expect(toolForPath('/tokens/create', '', '#history')?.id).toBe('token-manage')
    expect(toolForPath('/tokens/create', '?chain=solana')?.id).toBe('token-solana')
  })

  it('gives every tool a unique id', () => {
    const ids = ALL_TOOLS.map((tool) => tool.id)
    expect(new Set(ids).size).toBe(ids.length)
  })
})
