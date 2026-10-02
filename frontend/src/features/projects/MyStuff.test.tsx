import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render, screen, within } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { contractsApi } from '../../lib/contractsApi'
import { nftApi } from '../../lib/nftApi'
import { solanaTokensApi } from '../../lib/solanaTokensApi'
import { MyStuff } from './MyStuff'

vi.mock('../../lib/contractsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/contractsApi')>()
  const base = { network: 'sepolia', transaction_hash: '0x', deployer_address: '0x', nft_collection_id: null, gas_used: null, deployment_cost_native: null, explorer_url: '', verification_message: null, created_at: '2026-09-30T00:00:00Z' }
  return {
    ...actual,
    contractsApi: {
      ...actual.contractsApi,
      listDeployments: vi.fn(async () => ({
        deployments: [
          { ...base, id: 'd1', template_id: 'erc20_basic', template_name: 'Basic ERC-20 Token', contract_type: 'erc20', contract_address: '0x5FbDB2315678afecb367f032d93F642f64180aa3', parameters: { TOKEN_SYMBOL: 'NOVA' }, verification_status: 'verified' },
          { ...base, id: 'd2', template_id: 'token_timelock', template_name: 'Token Time-Lock', contract_type: 'lock', contract_address: '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512', parameters: {}, verification_status: 'unverified' },
        ],
      })),
    },
  }
})
vi.mock('../../lib/solanaTokensApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/solanaTokensApi')>()
  return { ...actual, solanaTokensApi: { ...actual.solanaTokensApi, list: vi.fn(async () => ({ tokens: [] })) } }
})
vi.mock('../../lib/nftApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/nftApi')>()
  const base = { description: '', collection_size: 10, image_size: 512, status: 'generated' as const, created_at: '2026-09-30T00:00:00Z' }
  return {
    ...actual,
    nftApi: {
      ...actual.nftApi,
      listCollections: vi.fn(async () => ({
        collections: [
          { ...base, id: 'c1', name: 'Night Owls', item_count: 10, published_count: 10 },
          { ...base, id: 'c2', name: 'Pixel Frogs', item_count: 5, published_count: 0 },
        ],
      })),
    },
  }
})
vi.mock('../../lib/candyMachineApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/candyMachineApi')>()
  return { ...actual, candyMachineApi: { ...actual.candyMachineApi, dashboard: vi.fn(async () => ({ drops: [], totals_by_network: {} })) } }
})

describe('MyStuff', () => {
  it('groups what you made by area, each with its next step', async () => {
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><MyStuff token="tok" /></MemoryRouter>
      </QueryClientProvider>,
    )

    const tokens = await screen.findByRole('region', { name: /tokens/ })
    expect(within(tokens).getByText('NOVA')).toBeInTheDocument()
    expect(within(tokens).getByRole('link', { name: 'public page →' })).toHaveAttribute('href', '/token/sepolia/0x5FbDB2315678afecb367f032d93F642f64180aa3')
    expect(within(tokens).getByRole('link', { name: 'airdrop →' })).toHaveAttribute('href', '/liquidity/airdrop?network=sepolia&token=0x5FbDB2315678afecb367f032d93F642f64180aa3')
    expect(within(tokens).getByRole('link', { name: 'holders →' })).toHaveAttribute('href', '/liquidity/snapshot?network=sepolia&address=0x5FbDB2315678afecb367f032d93F642f64180aa3')
    expect(within(tokens).getByRole('link', { name: 'vest →' })).toHaveAttribute('href', '/liquidity/vesting?network=sepolia&token=0x5FbDB2315678afecb367f032d93F642f64180aa3')
    expect(within(tokens).getByRole('link', { name: 'burn →' })).toHaveAttribute('href', '/tokens/burn?network=sepolia&token=0x5FbDB2315678afecb367f032d93F642f64180aa3')

    const nfts = screen.getByRole('region', { name: /nft collections/ })
    expect(within(nfts).getByText('10 items · 10 published')).toBeInTheDocument()
    expect(within(nfts).getByRole('link', { name: 'sell →' })).toHaveAttribute('href', '/drops/launch?collection=c1')
    expect(within(nfts).getByRole('link', { name: 'publish →' })).toHaveAttribute('href', '/nfts/generator?collection=c2')

    const contracts = screen.getByRole('region', { name: /contracts/ })
    expect(within(contracts).getByText('Token Time-Lock')).toBeInTheDocument()

    // No drops: no empty section (the start tiles above cover it).
    expect(screen.queryByRole('region', { name: /drops/ })).not.toBeInTheDocument()
  })

  it('says so, in one line, when nothing has been made yet', async () => {
    vi.mocked(contractsApi.listDeployments).mockResolvedValueOnce({ deployments: [] })
    vi.mocked(solanaTokensApi.list).mockResolvedValueOnce({ tokens: [] })
    vi.mocked(nftApi.listCollections).mockResolvedValueOnce({ collections: [] })
    render(
      <QueryClientProvider client={new QueryClient()}>
        <MemoryRouter><MyStuff token="tok" /></MemoryRouter>
      </QueryClientProvider>,
    )
    expect(await screen.findByText(/^Nothing here yet/)).toBeInTheDocument()
    expect(screen.queryByRole('region')).not.toBeInTheDocument()
  })
})
