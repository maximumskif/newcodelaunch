import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { useAccount, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { contractsApi, type ContractDeployment } from '../../lib/contractsApi'
import { nftApi, type NFTCollection, type NFTGeneratedItem } from '../../lib/nftApi'
import { useDeployTemplate } from '../contracts/useDeployTemplate'
import { NftEvmDeployPage } from './NftEvmDeployPage'

vi.mock('wagmi', () => ({
  useAccount: vi.fn(),
  useWriteContract: vi.fn(),
  useWaitForTransactionReceipt: vi.fn(),
}))

vi.mock('../contracts/useDeployTemplate', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../contracts/useDeployTemplate')>()
  return { ...actual, useDeployTemplate: vi.fn() }
})

vi.mock('../network/NetworkContext', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../network/NetworkContext')>()
  return { ...actual, useNetwork: () => ({ network: 'sepolia', setNetwork: vi.fn() }) }
})

vi.mock('../../lib/nftApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/nftApi')>()
  return {
    ...actual,
    nftApi: { ...actual.nftApi, getCollection: vi.fn(), listItems: vi.fn(), publishEvmMetadata: vi.fn() },
  }
})

vi.mock('../../lib/contractsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/contractsApi')>()
  return { ...actual, contractsApi: { ...actual.contractsApi, listDeployments: vi.fn() } }
})

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'tok', user: null, login: vi.fn(), logout: vi.fn() }),
}))

const collection: NFTCollection = {
  id: 'col-1',
  name: 'Cool Apes',
  description: '',
  collection_size: 10,
  image_size: 512,
  status: 'published',
  created_at: '2026-01-01T00:00:00Z',
  layers: [],
}

function item(index: number, published: boolean): NFTGeneratedItem {
  return {
    id: `item-${index}`,
    token_index: index,
    attributes: [],
    image_path: `generated/col-1/${index}.png`,
    ipfs_image_hash: published ? `QmImage${index}` : null,
    ipfs_metadata_hash: published ? `QmMeta${index}` : null,
  } as NFTGeneratedItem
}

const deployment = {
  id: 'dep-1',
  template_id: 'erc721_basic',
  template_name: 'Basic ERC-721 NFT Collection',
  contract_type: 'erc721',
  network: 'sepolia',
  contract_address: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  transaction_hash: '0xtx',
  deployer_address: '0xf39F',
  nft_collection_id: 'col-1',
  parameters: {},
  gas_used: null,
  deployment_cost_native: null,
  explorer_url: 'https://sepolia.etherscan.io/address/0x5FbDB2315678afecb367f032d93F642f64180aa3',
  verification_status: 'unverified',
  verification_message: null,
  created_at: '2026-09-24T00:00:00Z',
} satisfies ContractDeployment

const deploy = vi.fn()
const writeContractAsync = vi.fn()

function mockHooks({ deployed = false, receipt = undefined as unknown } = {}) {
  vi.mocked(useAccount).mockReturnValue({ address: '0xf39F' } as unknown as ReturnType<typeof useAccount>)
  vi.mocked(useDeployTemplate).mockReturnValue({
    deploy,
    step: deployed ? 'done' : 'idle',
    error: null,
    deployment: deployed ? deployment : null,
    txHash: undefined,
  })
  vi.mocked(useWriteContract).mockReturnValue({ writeContractAsync } as unknown as ReturnType<typeof useWriteContract>)
  vi.mocked(useWaitForTransactionReceipt).mockReturnValue({ data: receipt } as ReturnType<typeof useWaitForTransactionReceipt>)
}

function renderPage() {
  return render(
    <MemoryRouter initialEntries={['/nft/deploy-evm?collection=col-1']}>
      <NftEvmDeployPage />
    </MemoryRouter>,
  )
}

describe('NftEvmDeployPage', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(nftApi.getCollection).mockResolvedValue({ collection })
    vi.mocked(nftApi.listItems).mockResolvedValue({ items: [item(1, true), item(2, true), item(3, false)] })
    vi.mocked(nftApi.publishEvmMetadata).mockResolvedValue({
      base_uri: 'ipfs://QmDir/',
      gateway_url: 'https://gw/ipfs/QmDir/',
      item_count: 2,
    })
    vi.mocked(contractsApi.listDeployments).mockResolvedValue({ deployments: [] })
    writeContractAsync.mockResolvedValue('0xenable')
  })

  it('pins the metadata folder, then deploys erc721_basic with it — linked to the collection', async () => {
    const user = userEvent.setup()
    mockHooks()
    renderPage()

    expect(await screen.findByText(/2 of 3 generated items published/)).toBeInTheDocument()
    expect(screen.getByLabelText('Symbol')).toHaveValue('COOLAPES')
    await user.clear(screen.getByLabelText('Mint price (ETH)'))
    await user.type(screen.getByLabelText('Mint price (ETH)'), '0.05')
    await user.click(screen.getByRole('button', { name: 'Deploy ERC-721 collection' }))

    await waitFor(() => expect(deploy).toHaveBeenCalled())
    expect(nftApi.publishEvmMetadata).toHaveBeenCalledWith('tok', 'col-1')
    expect(deploy).toHaveBeenCalledWith(
      'erc721_basic',
      {
        COLLECTION_NAME: 'Cool Apes',
        COLLECTION_SYMBOL: 'COOLAPES',
        MAX_SUPPLY: '2',
        MINT_PRICE: '50000000000000000',
        BASE_URI: 'ipfs://QmDir/',
        MAX_MINTS_PER_WALLET: '10',
      },
      'sepolia',
      undefined,
      'col-1',
    )
  })

  it('never deploys when pinning the metadata folder fails', async () => {
    const user = userEvent.setup()
    mockHooks()
    vi.mocked(nftApi.publishEvmMetadata).mockRejectedValue(new Error('Pinata is not configured'))
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Deploy ERC-721 collection' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Pinata is not configured')
    expect(deploy).not.toHaveBeenCalled()
  })

  it('disables Deploy on an invalid mint price', async () => {
    const user = userEvent.setup()
    mockHooks()
    renderPage()

    await user.clear(await screen.findByLabelText('Mint price (ETH)'))
    await user.type(screen.getByLabelText('Mint price (ETH)'), '1e3')
    expect(screen.getByText(/Mint price must be a number/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Deploy ERC-721 collection' })).toBeDisabled()
  })

  it('after deploying, enables public minting with an owner transaction', async () => {
    const user = userEvent.setup()
    mockHooks({ deployed: true })
    renderPage()

    await user.click(await screen.findByRole('button', { name: 'Enable public minting' }))
    expect(writeContractAsync).toHaveBeenCalledWith({
      address: deployment.contract_address,
      abi: expect.any(Array),
      functionName: 'setMintingEnabled',
      args: [true],
      chainId: 11155111,
    })
  })

  it('shows minting as on once the enable transaction is confirmed, and a revert as an error', async () => {
    mockHooks({ deployed: true, receipt: { status: 'success' } })
    const { unmount } = renderPage()
    expect(await screen.findByText(/Public minting is on/)).toBeInTheDocument()
    unmount()

    mockHooks({ deployed: true, receipt: { status: 'reverted' } })
    renderPage()
    expect(await screen.findByText(/enable-minting transaction reverted/)).toBeInTheDocument()
  })
})
