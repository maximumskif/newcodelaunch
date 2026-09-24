import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render as rtlRender, screen, waitFor } from '@testing-library/react'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import { useAccount, useBalance, useChainId, usePublicClient, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContractDeployment } from '../../lib/contractsApi'
import { nftApi } from '../../lib/nftApi'
import { Erc721ManagePanel } from './Erc721ManagePanel'

vi.mock('wagmi', () => ({
  useAccount: vi.fn(),
  useBalance: vi.fn(),
  useChainId: vi.fn(),
  usePublicClient: vi.fn(),
  useSwitchChain: vi.fn(),
  useWaitForTransactionReceipt: vi.fn(),
  useWriteContract: vi.fn(),
}))

vi.mock('../../lib/nftApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/nftApi')>()
  return { ...actual, nftApi: { ...actual.nftApi, publishEvmMetadata: vi.fn() } }
})

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'tok', user: null, login: vi.fn(), updateUser: vi.fn(), logout: vi.fn() }),
}))

const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const CONTRACT = '0x5FbDB2315678afecb367f032d93F642f64180aa3'

const deployment = {
  id: 'dep-1',
  network: 'sepolia',
  contract_address: CONTRACT,
} as ContractDeployment

const writeContractAsync = vi.fn()
const switchChainAsync = vi.fn()

function mockChain({ account = OWNER, chainId = 11155111, mintingEnabled = true } = {}) {
  vi.mocked(useAccount).mockReturnValue({ address: account } as unknown as ReturnType<typeof useAccount>)
  vi.mocked(useChainId).mockReturnValue(chainId)
  vi.mocked(useSwitchChain).mockReturnValue({ switchChainAsync } as unknown as ReturnType<typeof useSwitchChain>)
  vi.mocked(useWriteContract).mockReturnValue({ writeContractAsync } as unknown as ReturnType<typeof useWriteContract>)
  vi.mocked(useWaitForTransactionReceipt).mockReturnValue({ data: undefined } as ReturnType<typeof useWaitForTransactionReceipt>)
  vi.mocked(useBalance).mockReturnValue({
    data: { value: 20_000_000_000_000_000n },
    refetch: vi.fn(),
  } as unknown as ReturnType<typeof useBalance>)
  const state: Record<string, unknown> = {
    owner: OWNER,
    totalSupply: 2n,
    maxSupply: 2n,
    mintPrice: 10_000_000_000_000_000n,
    maxMintsPerWallet: 3n,
    mintingEnabled,
    baseURI: 'ipfs://QmDir/',
  }
  vi.mocked(usePublicClient).mockReturnValue({
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => state[functionName]),
  } as unknown as ReturnType<typeof usePublicClient>)
}

// The panel's reads go through react-query — a fresh client per render.
function render(ui: ReactElement) {
  return rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)
}

describe('Erc721ManagePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    writeContractAsync.mockResolvedValue('0xhash')
  })

  it('shows the live on-chain state', async () => {
    mockChain()
    render(<Erc721ManagePanel deployment={deployment} collectionId="col-1" />)
    expect(await screen.findByText('Minting on')).toBeInTheDocument()
    expect(screen.getByText('2 / 2 minted')).toBeInTheDocument()
    expect(screen.getByText('0.01 ETH each · max 3 per wallet')).toBeInTheDocument()
    expect(screen.getByText('0.02 ETH')).toBeInTheDocument()
    expect(screen.getByText('Metadata: ipfs://QmDir/')).toBeInTheDocument()
  })

  it('withdraws the proceeds on the contract’s own chain', async () => {
    mockChain()
    const user = userEvent.setup()
    render(<Erc721ManagePanel deployment={deployment} collectionId="col-1" />)

    await user.click(await screen.findByRole('button', { name: 'Withdraw to owner' }))
    expect(writeContractAsync).toHaveBeenLastCalledWith(expect.objectContaining({ functionName: 'withdraw', args: [], chainId: 11155111 }))
    expect(switchChainAsync).not.toHaveBeenCalled()
  })

  it('converts a new price to wei, and pausing sends false', async () => {
    mockChain()
    const user = userEvent.setup()
    const { unmount } = render(<Erc721ManagePanel deployment={deployment} collectionId="col-1" />)
    await user.type(await screen.findByLabelText('New mint price (ETH)'), '0.05')
    await user.click(screen.getByRole('button', { name: 'Set price' }))
    expect(writeContractAsync).toHaveBeenLastCalledWith(
      expect.objectContaining({ functionName: 'setMintPrice', args: [50_000_000_000_000_000n] }),
    )
    unmount()

    render(<Erc721ManagePanel deployment={deployment} collectionId="col-1" />)
    await user.click(await screen.findByRole('button', { name: 'Pause minting' }))
    expect(writeContractAsync).toHaveBeenLastCalledWith(expect.objectContaining({ functionName: 'setMintingEnabled', args: [false] }))
  })

  it('re-pins the metadata folder, then points the contract at it', async () => {
    mockChain()
    vi.mocked(nftApi.publishEvmMetadata).mockResolvedValue({ base_uri: 'ipfs://QmNew/', gateway_url: 'x', item_count: 2 })
    const user = userEvent.setup()
    render(<Erc721ManagePanel deployment={deployment} collectionId="col-1" />)

    await user.click(await screen.findByRole('button', { name: /Re-pin metadata/ }))
    await waitFor(() =>
      expect(writeContractAsync).toHaveBeenLastCalledWith(expect.objectContaining({ functionName: 'setBaseURI', args: ['ipfs://QmNew/'] })),
    )
    expect(nftApi.publishEvmMetadata).toHaveBeenCalledWith('tok', 'col-1')
  })

  it('switches the wallet to the contract’s chain first', async () => {
    mockChain({ chainId: 1 })
    const user = userEvent.setup()
    render(<Erc721ManagePanel deployment={deployment} collectionId="col-1" />)
    await user.click(await screen.findByRole('button', { name: 'Withdraw to owner' }))
    expect(switchChainAsync).toHaveBeenCalledWith({ chainId: 11155111 })
  })

  it('is read-only for anyone but the owner', async () => {
    mockChain({ account: '0x70997970C51812dc3A010C7d01b50e0d17dc79C8' })
    render(<Erc721ManagePanel deployment={deployment} collectionId="col-1" />)
    expect(await screen.findByText(/Connect the owner wallet/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Withdraw to owner' })).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Set price' })).not.toBeInTheDocument()
  })
})
