import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render as rtlRender, screen, within } from '@testing-library/react'
import type { ReactElement } from 'react'
import userEvent from '@testing-library/user-event'
import { zeroAddress } from 'viem'
import { useAccount, useChainId, usePublicClient, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import type { ContractDeployment } from '../../lib/contractsApi'
import { percentToBps } from '../../lib/erc20AdvancedAbi'
import { Erc20ManagePanel } from './Erc20ManagePanel'

vi.mock('wagmi', () => ({
  useAccount: vi.fn(),
  useChainId: vi.fn(),
  usePublicClient: vi.fn(),
  useSwitchChain: vi.fn(),
  useWaitForTransactionReceipt: vi.fn(),
  useWriteContract: vi.fn(),
}))

const OWNER = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const OTHER = '0x70997970C51812dc3A010C7d01b50e0d17dc79C8'
const CONTRACT = '0x5FbDB2315678afecb367f032d93F642f64180aa3'

const deployment = { id: 'dep-1', network: 'sepolia', contract_address: CONTRACT, template_id: 'erc20_advanced' } as ContractDeployment

const writeContractAsync = vi.fn()

function mockChain({ account = OWNER, tradingEnabled = false, owner = OWNER, legacy = false } = {}) {
  vi.mocked(useAccount).mockReturnValue({ address: account } as unknown as ReturnType<typeof useAccount>)
  vi.mocked(useChainId).mockReturnValue(11155111)
  vi.mocked(useSwitchChain).mockReturnValue({ switchChainAsync: vi.fn() } as unknown as ReturnType<typeof useSwitchChain>)
  vi.mocked(useWriteContract).mockReturnValue({ writeContractAsync } as unknown as ReturnType<typeof useWriteContract>)
  vi.mocked(useWaitForTransactionReceipt).mockReturnValue({ data: undefined } as ReturnType<typeof useWaitForTransactionReceipt>)
  const state: Record<string, unknown> = {
    owner,
    symbol: 'ADV',
    decimals: 18,
    tradingEnabled,
    buyTaxRate: 300n,
    sellTaxRate: 500n,
    marketingFee: 60n,
    liquidityFee: 40n,
    maxTransactionAmount: 10_000n * 10n ** 18n,
    maxWalletAmount: 20_000n * 10n ** 18n,
    marketingWallet: OTHER,
    liquidityWallet: OTHER,
  }
  vi.mocked(usePublicClient).mockReturnValue({
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => {
      if (functionName === 'marketPairs') {
        if (legacy) throw new Error('execution reverted')
        return false
      }
      return state[functionName]
    }),
  } as unknown as ReturnType<typeof usePublicClient>)
}

function render(ui: ReactElement) {
  return rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)
}

describe('percentToBps', () => {
  it('converts percentages up to the 10% cap', () => {
    expect(percentToBps('3.5')).toBe(350)
    expect(percentToBps('0')).toBe(0)
    expect(percentToBps('10')).toBe(1000)
    expect(percentToBps('10.01')).toBeNull()
    expect(percentToBps('1.234')).toBeNull()
    expect(percentToBps('-1')).toBeNull()
    expect(percentToBps('')).toBeNull()
  })
})

describe('Erc20ManagePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    writeContractAsync.mockResolvedValue('0xhash')
  })

  it('shows the live settings and offers to enable trading', async () => {
    mockChain()
    const user = userEvent.setup()
    render(<Erc20ManagePanel deployment={deployment} />)
    expect(await screen.findByText('Trading not enabled')).toBeInTheDocument()
    expect(screen.getByText('Buy 3% · Sell 5% · split 60/40')).toBeInTheDocument()
    expect(screen.getByText('Max tx 10000 · max wallet 20000 ADV')).toBeInTheDocument()
    // Renouncing before trading is open would lock trading shut for good.
    expect(screen.queryByRole('button', { name: /Renounce/ })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Enable trading' }))
    expect(writeContractAsync).toHaveBeenLastCalledWith(expect.objectContaining({ functionName: 'enableTrading', args: [], chainId: 11155111 }))
  })

  it('sends taxes in basis points and limits in whole tokens', async () => {
    mockChain({ tradingEnabled: true })
    const user = userEvent.setup()
    const { unmount } = render(<Erc20ManagePanel deployment={deployment} />)
    await user.type(await screen.findByLabelText('Buy tax (%)'), '2.5')
    await user.type(screen.getByLabelText('Sell tax (%)'), '11')
    const taxes = screen.getByLabelText('Buy tax (%)').parentElement!
    expect(within(taxes).getByRole('button', { name: 'Set' })).toBeDisabled()
    await user.clear(screen.getByLabelText('Sell tax (%)'))
    await user.type(screen.getByLabelText('Sell tax (%)'), '4')
    await user.click(within(taxes).getByRole('button', { name: 'Set' }))
    expect(writeContractAsync).toHaveBeenLastCalledWith(expect.objectContaining({ functionName: 'updateTaxRates', args: [250n, 400n] }))
    // Every action waits for the previous transaction's receipt.
    expect(screen.getByLabelText('Max wallet').parentElement!.querySelector('button')).toBeDisabled()
    unmount()

    render(<Erc20ManagePanel deployment={deployment} />)
    await user.type(await screen.findByLabelText('Max transaction'), '5000')
    await user.type(screen.getByLabelText('Max wallet'), '15000')
    await user.click(within(screen.getByLabelText('Max wallet').parentElement!).getByRole('button', { name: 'Set' }))
    expect(writeContractAsync).toHaveBeenLastCalledWith(expect.objectContaining({ functionName: 'updateLimits', args: [5000n, 15000n] }))
  })

  it('registers a trading pair and excludes a wallet from fees', async () => {
    mockChain({ tradingEnabled: true })
    const user = userEvent.setup()
    const { unmount } = render(<Erc20ManagePanel deployment={deployment} />)
    await user.type(await screen.findByLabelText('Pair address'), OTHER)
    await user.click(screen.getByRole('button', { name: 'Register' }))
    expect(writeContractAsync).toHaveBeenLastCalledWith(expect.objectContaining({ functionName: 'setMarketPair', args: [OTHER, true] }))
    unmount()

    render(<Erc20ManagePanel deployment={deployment} />)
    await user.type(await screen.findByLabelText('Wallet to exclude or include'), OTHER)
    await user.click(screen.getByRole('button', { name: 'Include' }))
    expect(writeContractAsync).toHaveBeenLastCalledWith(expect.objectContaining({ functionName: 'excludeFromFees', args: [OTHER, false] }))
  })

  it('renounces ownership only after confirming', async () => {
    mockChain({ tradingEnabled: true })
    const user = userEvent.setup()
    render(<Erc20ManagePanel deployment={deployment} />)
    await user.click(await screen.findByRole('button', { name: 'Renounce ownership…' }))
    expect(writeContractAsync).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Renounce ownership' }))
    expect(writeContractAsync).toHaveBeenLastCalledWith(expect.objectContaining({ functionName: 'renounceOwnership' }))
  })

  it('explains what an older deployment can’t do', async () => {
    mockChain({ tradingEnabled: true, legacy: true })
    render(<Erc20ManagePanel deployment={deployment} />)
    expect(await screen.findByText(/earlier version of this template/)).toBeInTheDocument()
    expect(screen.queryByLabelText('Pair address')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /Renounce/ })).not.toBeInTheDocument()
    // Enabling trading, taxes and limits still work on it.
    expect(screen.getByLabelText('Buy tax (%)')).toBeInTheDocument()
  })

  it('is read-only for anyone but the owner, and after renouncing', async () => {
    mockChain({ account: OTHER })
    const { unmount } = render(<Erc20ManagePanel deployment={deployment} />)
    expect(await screen.findByText(/Connect the owner wallet/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Enable trading' })).not.toBeInTheDocument()
    unmount()

    mockChain({ owner: zeroAddress, tradingEnabled: true })
    render(<Erc20ManagePanel deployment={deployment} />)
    expect(await screen.findByText('Ownership renounced')).toBeInTheDocument()
    expect(screen.queryByLabelText('Buy tax (%)')).not.toBeInTheDocument()
  })
})
