import { render, screen } from '@testing-library/react'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { tokenPagesApi, type EvmTokenPage, type SolanaTokenPage } from '../../lib/tokenPagesApi'
import { TokenPage } from './TokenPage'

vi.mock('../../lib/tokenPagesApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/tokenPagesApi')>()
  return { ...actual, tokenPagesApi: { get: vi.fn() } }
})

const renderAt = (path: string) =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Routes>
        <Route path="/token/:network/:address" element={<TokenPage />} />
      </Routes>
    </MemoryRouter>,
  )

const evm: EvmTokenPage = {
  chain: 'evm',
  network: 'sepolia',
  address: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  template: 'Advanced ERC-20 Token',
  name: 'Advanced E2E',
  symbol: 'ADV',
  decimals: 18,
  total_supply: '1000000000000000000000000',
  owner: '0x0000000000000000000000000000000000000000',
  ownership_renounced: true,
  advanced: { trading_enabled: true, buy_tax_bps: 300, sell_tax_bps: 500, max_transaction: '10000000000000000000000', max_wallet: '20000000000000000000000' },
  source_verified: false,
  code_matches_template: true,
  explorer_url: 'https://sepolia.etherscan.io/address/0x5FbDB2315678afecb367f032d93F642f64180aa3',
  chain_time: 1_790_000_000,
  pool: {
    dex: 'Uniswap V2',
    pair: '0x1111111111111111111111111111111111111111',
    token_reserve: '100000000000000000000000',
    native_reserve: '1000000000000000000',
    lp_supply: '1000',
    burned_lp: '100',
    locks: [{ address: '0x5555555555555555555555555555555555555555', amount: '250', release_time: 4_102_444_800 }],
  },
}

const solana: SolanaTokenPage = {
  chain: 'solana',
  network: 'solana_devnet',
  address: 'Mint111111111111111111111111111111111111111',
  name: 'Pooled',
  symbol: 'POOL',
  decimals: 6,
  total_supply: '1000000000000',
  mint_authority_revoked: true,
  freeze_authority_revoked: false,
  metadata_locked: true,
  explorer_url: null,
  pool: { dex: 'Raydium', pair: 'Pool1', token_reserve: '100000000000', native_reserve: '1000000000', lp_supply: '10000', permanently_locked_lp: '9999' },
}

describe('TokenPage', () => {
  beforeEach(() => vi.clearAllMocks())

  it('shows an EVM token’s control, taxes, price and time-locks', async () => {
    vi.mocked(tokenPagesApi.get).mockResolvedValue(evm)
    renderAt(`/token/sepolia/${evm.address}`)
    expect(await screen.findByRole('heading', { name: 'Advanced E2E (ADV)' })).toBeInTheDocument()
    expect(tokenPagesApi.get).toHaveBeenCalledWith('sepolia', evm.address)
    expect(screen.getByText(/Ownership renounced/)).toBeInTheDocument()
    expect(screen.getByText('Source code not verified yet')).toBeInTheDocument()
    expect(screen.getByText(/Buy tax 3% · sell tax 5%/)).toBeInTheDocument()
    expect(screen.getByText('Price: 1 ADV = 0.00001 ETH')).toBeInTheDocument()
    expect(screen.getByText("25.00% of the pool's liquidity is time-locked")).toBeInTheDocument()
    expect(screen.getByText("10.00% of the pool's liquidity is burned")).toBeInTheDocument()
  })

  it('shows a Solana token’s authorities and permanent lock', async () => {
    vi.mocked(tokenPagesApi.get).mockResolvedValue(solana)
    renderAt(`/token/solana_devnet/${solana.address}`)
    expect(await screen.findByText('Supply is fixed — no one can mint more')).toBeInTheDocument()
    expect(screen.getByText('Holders’ tokens can still be frozen')).toBeInTheDocument()
    expect(screen.getByText(/99.99% of the pool's liquidity is locked forever/)).toBeInTheDocument()
    expect(screen.getByText('Price: 1 POOL = 0.00001 SOL')).toBeInTheDocument()
  })

  it('says when there’s no pool, or the pool couldn’t be read', async () => {
    vi.mocked(tokenPagesApi.get).mockResolvedValue({ ...solana, pool: { dex: 'Raydium', pair: null } })
    const { unmount } = renderAt(`/token/solana_devnet/${solana.address}`)
    expect(await screen.findByText('No Raydium pool yet.')).toBeInTheDocument()
    unmount()
    vi.mocked(tokenPagesApi.get).mockResolvedValue({ ...solana, pool: null })
    renderAt(`/token/solana_devnet/${solana.address}`)
    expect(await screen.findByText("Couldn't read the pool right now.")).toBeInTheDocument()
  })

  it('handles a link that doesn’t match a token launched here', async () => {
    vi.mocked(tokenPagesApi.get).mockRejectedValue(new Error('No token launched with this app at that address'))
    renderAt('/token/sepolia/0xnope')
    expect(await screen.findByText("This link doesn't match a token launched here")).toBeInTheDocument()
  })

  it('warns loudly when the contract isn’t the code it was recorded as', async () => {
    vi.mocked(tokenPagesApi.get).mockResolvedValue({ ...evm, code_matches_template: false })
    renderAt(`/token/sepolia/${evm.address}`)
    expect(await screen.findByRole('alert')).toHaveTextContent("doesn't match the Advanced ERC-20 Token template")
    expect(screen.getByText('Code does not match the Advanced ERC-20 Token template')).toBeInTheDocument()
  })
})
