import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { render as rtlRender, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import type { ReactElement } from 'react'
import { parseEther } from 'viem'
import { useAccount, useChainId, useConnect, usePublicClient, useSwitchChain, useWaitForTransactionReceipt, useWriteContract } from 'wagmi'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { curveTerms, quoteBuy, quoteSell, withSlippage } from '../../lib/curve'
import { CurvePanel } from './CurvePanel'

vi.mock('wagmi', () => ({
  useAccount: vi.fn(),
  useChainId: vi.fn(),
  useConnect: vi.fn(),
  usePublicClient: vi.fn(),
  useSwitchChain: vi.fn(),
  useWaitForTransactionReceipt: vi.fn(),
  useWriteContract: vi.fn(),
}))

const CURVE = '0x7777777777777777777777777777777777777777'
const WALLET = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const writeContractAsync = vi.fn()
const connect = vi.fn()
// A billion tokens, a 4 ETH target, 1 ETH raised so far (1.01 ETH paid, fee included).
const terms = curveTerms(1_000_000_000n, parseEther('4'))
const state = { ethReserve: parseEther('1'), tokensSold: quoteBuy(terms, { ethReserve: 0n, tokensSold: 0n }, parseEther('1.01')).tokens }

function mockCurve({ wallet = WALLET as string | null, graduated = false, held = parseEther('1000000') } = {}) {
  vi.mocked(useAccount).mockReturnValue({ address: wallet ?? undefined } as unknown as ReturnType<typeof useAccount>)
  vi.mocked(useChainId).mockReturnValue(11155111)
  vi.mocked(useConnect).mockReturnValue({ connectors: [{ id: 'injected' }], connect } as unknown as ReturnType<typeof useConnect>)
  vi.mocked(useSwitchChain).mockReturnValue({ switchChainAsync: vi.fn() } as unknown as ReturnType<typeof useSwitchChain>)
  vi.mocked(useWriteContract).mockReturnValue({ writeContractAsync } as unknown as ReturnType<typeof useWriteContract>)
  vi.mocked(useWaitForTransactionReceipt).mockReturnValue({ data: undefined } as ReturnType<typeof useWaitForTransactionReceipt>)
  const values: Record<string, unknown> = {
    symbol: 'MCAT',
    totalSupply: terms.totalSupply,
    curveSupply: terms.curveSupply,
    poolSupply: terms.poolSupply,
    graduationTarget: terms.target,
    virtualEth: terms.virtualEth,
    virtualTokens: terms.virtualTokens,
    ethReserve: state.ethReserve,
    tokensSold: state.tokensSold,
    graduated,
    pair: '0x8888888888888888888888888888888888888888',
    balanceOf: held,
  }
  vi.mocked(usePublicClient).mockReturnValue({
    readContract: vi.fn(async ({ functionName }: { functionName: string }) => values[functionName]),
    getBalance: vi.fn(async () => parseEther('10')),
  } as unknown as ReturnType<typeof usePublicClient>)
}

const render = (ui: ReactElement) => rtlRender(<QueryClientProvider client={new QueryClient()}>{ui}</QueryClientProvider>)

describe('CurvePanel', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    writeContractAsync.mockResolvedValue('0xabc')
  })

  it('shows how far the curve is from graduating', async () => {
    mockCurve()
    render(<CurvePanel network="sepolia" address={CURVE} dexName="Uniswap V2" />)
    expect(await screen.findByTestId('curve-progress')).toHaveTextContent('25% · 1 ETH of 4 ETH raised')
    expect(screen.getByRole('progressbar', { name: 'Raised toward graduation' })).toHaveAttribute('aria-valuenow', '25')
    expect(screen.getByText('On the bonding curve')).toBeInTheDocument()
    expect(screen.getByText('Every buy and sell on the curve pays a 1% fee to the platform.')).toBeInTheDocument()
  })

  it('buys with the quote less 1% as the minimum, sending what was typed', async () => {
    mockCurve()
    render(<CurvePanel network="sepolia" address={CURVE} />)
    await userEvent.type(await screen.findByLabelText(/^Spend \(ETH\)/), '0.5')
    const { tokens } = quoteBuy(terms, state, parseEther('0.5'))
    expect(screen.getByTestId('curve-quote')).toHaveTextContent(/^≈ .* MCAT \(at least .* MCAT\) · includes a 0\.00495 ETH fee$/)
    await userEvent.click(screen.getByRole('button', { name: 'Buy' }))
    expect(writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({ address: CURVE, functionName: 'buy', args: [withSlippage(tokens)], value: parseEther('0.5'), chainId: 11155111 }),
    )
  })

  it('says when a buy takes the rest of the curve and graduates it', async () => {
    mockCurve()
    render(<CurvePanel network="sepolia" address={CURVE} dexName="Uniswap V2" />)
    await userEvent.type(await screen.findByLabelText(/^Spend \(ETH\)/), '5')
    expect(screen.getByTestId('curve-quote')).toHaveTextContent(/Buys the last .* MCAT for 3\.03 ETH, fee included; the rest is refunded\. This graduates it to Uniswap V2\./)
  })

  it('sells with the quote less 1% as the minimum, and refuses more than is held', async () => {
    mockCurve({ held: parseEther('1000') })
    render(<CurvePanel network="sepolia" address={CURVE} />)
    await userEvent.click(await screen.findByRole('button', { name: 'sell' }))
    const input = screen.getByLabelText(/^Sell \(MCAT\)/)
    await userEvent.type(input, '2000')
    expect(screen.getByText("That's more than this wallet has.")).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Sell' })).toBeDisabled()

    await userEvent.click(screen.getByRole('button', { name: 'max' }))
    expect(input).toHaveValue('1000')
    expect(screen.getByTestId('curve-quote')).toHaveTextContent(/^≈ .* ETH \(at least .* ETH\) after a .* ETH fee$/)
    await userEvent.click(screen.getByRole('button', { name: 'Sell' }))
    // The minimum is on what the seller receives, after the fee.
    expect(writeContractAsync).toHaveBeenCalledWith(
      expect.objectContaining({ functionName: 'sell', args: [parseEther('1000'), withSlippage(quoteSell(terms, state, parseEther('1000')).eth)] }),
    )
  })

  it('offers to connect a wallet rather than a trade form', async () => {
    mockCurve({ wallet: null })
    render(<CurvePanel network="sepolia" address={CURVE} />)
    await userEvent.click(await screen.findByRole('button', { name: 'Connect wallet to trade' }))
    expect(connect).toHaveBeenCalled()
    expect(screen.queryByLabelText(/^Spend/)).not.toBeInTheDocument()
  })

  it('once graduated, points to the pool and offers no trades', async () => {
    mockCurve({ graduated: true })
    render(<CurvePanel network="sepolia" address={CURVE} dexName="Uniswap V2" />)
    expect(await screen.findByText('Graduated to Uniswap V2')).toBeInTheDocument()
    expect(screen.getByText(/nobody can withdraw that liquidity/)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Buy' })).not.toBeInTheDocument()
    expect(screen.queryByText(/pays a 1% fee/)).not.toBeInTheDocument()
  })
})
