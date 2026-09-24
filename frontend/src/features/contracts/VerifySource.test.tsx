import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { contractsApi, type ContractDeployment } from '../../lib/contractsApi'
import { VerifySource } from './VerifySource'

vi.mock('../../lib/contractsApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../../lib/contractsApi')>()
  return { ...actual, contractsApi: { ...actual.contractsApi, verifySource: vi.fn(), refreshVerification: vi.fn() } }
})

vi.mock('../auth/AuthContext', () => ({
  useAuth: () => ({ accessToken: 'tok', user: null, login: vi.fn(), updateUser: vi.fn(), logout: vi.fn() }),
}))

const base: ContractDeployment = {
  id: 'dep-1',
  template_id: 'erc20_basic',
  template_name: 'Basic ERC-20 Token',
  contract_type: 'erc20',
  network: 'sepolia',
  contract_address: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  transaction_hash: '0xtx',
  deployer_address: '0xf39F',
  nft_collection_id: null,
  parameters: {},
  gas_used: null,
  deployment_cost_native: null,
  explorer_url: 'https://sepolia.etherscan.io/address/0x5FbDB2315678afecb367f032d93F642f64180aa3',
  verification_status: 'unverified',
  verification_message: null,
  created_at: '2026-09-24T00:00:00Z',
}

describe('VerifySource', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.useFakeTimers({ shouldAdvanceTime: true })
  })
  afterEach(() => vi.useRealTimers())

  it('submits, polls while pending, and links to the verified code', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.mocked(contractsApi.verifySource).mockResolvedValue({ deployment: { ...base, verification_status: 'pending' } })
    vi.mocked(contractsApi.refreshVerification)
      .mockResolvedValueOnce({ deployment: { ...base, verification_status: 'pending' } })
      .mockResolvedValueOnce({ deployment: { ...base, verification_status: 'verified' } })
    render(<VerifySource deployment={base} />)

    await user.click(screen.getByRole('button', { name: 'Verify source' }))
    expect(contractsApi.verifySource).toHaveBeenCalledWith('tok', 'dep-1')
    expect(screen.getByText('Verifying source…')).toBeInTheDocument()

    await act(() => vi.advanceTimersByTimeAsync(3_000))
    expect(screen.getByText('Verifying source…')).toBeInTheDocument()
    await act(() => vi.advanceTimersByTimeAsync(3_000))

    const link = screen.getByRole('link', { name: 'Source verified' })
    expect(link).toHaveAttribute('href', `${base.explorer_url}#code`)
    expect(contractsApi.refreshVerification).toHaveBeenCalledTimes(2)
  })

  it("shows the explorer's reason on failure and offers a retry", async () => {
    render(<VerifySource deployment={{ ...base, verification_status: 'failed', verification_message: 'Unable to locate ContractCode' }} />)
    expect(screen.getByRole('alert')).toHaveTextContent('Unable to locate ContractCode')
    expect(screen.getByRole('button', { name: 'Retry verification' })).toBeInTheDocument()
  })

  it('surfaces a request error such as verification not being configured', async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime })
    vi.mocked(contractsApi.verifySource).mockRejectedValue(new Error("Source verification isn't configured"))
    render(<VerifySource deployment={base} />)

    await user.click(screen.getByRole('button', { name: 'Verify source' }))
    expect(await screen.findByRole('alert')).toHaveTextContent("isn't configured")
    expect(contractsApi.refreshVerification).not.toHaveBeenCalled()
  })

  it('renders an already-verified deployment without any buttons', () => {
    render(<VerifySource deployment={{ ...base, verification_status: 'verified' }} />)
    expect(screen.getByRole('link', { name: 'Source verified' })).toBeInTheDocument()
    expect(screen.queryByRole('button')).not.toBeInTheDocument()
  })
})
