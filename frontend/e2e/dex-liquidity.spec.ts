import { expect, test } from '@playwright/test'
import { parseAbi, parseEther, parseUnits, zeroAddress, type Address } from 'viem'

import { anvil, ANVIL_RPC_URL, deployAdvancedToken, freshAddress, fundedWallet, installEvmWallet, publicClient } from './setup/evmToken'
import { ensureLocalUniswap, LOCAL_UNISWAP } from './setup/localUniswap'

const TOKEN_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function marketPairs(address) view returns (bool)',
  'function tradingEnabled() view returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
])
const FACTORY_ABI = parseAbi(['function getPair(address, address) view returns (address)'])
const PAIR_ABI = parseAbi(['function getReserves() view returns (uint112, uint112, uint32)', 'function token0() view returns (address)'])
const ROUTER_ABI = parseAbi([
  'function swapExactETHForTokensSupportingFeeOnTransferTokens(uint256 amountOutMin, address[] path, address to, uint256 deadline) payable',
  'function swapExactTokensForETHSupportingFeeOnTransferTokens(uint256 amountIn, uint256 amountOutMin, address[] path, address to, uint256 deadline)',
])

const tokens = (amount: string) => parseUnits(amount, 18)
const deadline = () => BigInt(Math.floor(Date.now() / 1000) + 600)
// Uniswap V2's own getAmountOut: 0.3% fee, constant product.
const amountOut = (amountIn: bigint, reserveIn: bigint, reserveOut: bigint) =>
  (amountIn * 997n * reserveOut) / (reserveIn * 1000n + amountIn * 997n)

test.beforeAll(async () => ensureLocalUniswap(anvil, ANVIL_RPC_URL))
test.beforeEach(async ({ page }) => installEvmWallet(page))

test('liquidity for an advanced ERC-20 on a real Uniswap V2: pool created from the UI, registered as the trading pair, and real swaps taxed', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const marketing = freshAddress()
  const liquidity = freshAddress()
  const buyer = await fundedWallet()

  const token = await deployAdvancedToken(page, { marketing, liquidity })
  const balanceOf = (who: Address) => publicClient.readContract({ address: token, abi: TOKEN_ABI, functionName: 'balanceOf', args: [who] })

  // --- Create the pool: 100,000 ADV + 1 ETH, approve then add.
  await page.getByRole('button', { name: `Liquidity for ${token}` }).click()
  const panel = page.getByTestId('liquidity-panel')
  await expect(panel.getByText('Uniswap V2 (local)', { exact: true })).toBeVisible({ timeout: 15_000 })
  await expect(panel.getByText('No liquidity yet')).toBeVisible()
  await panel.getByLabel(/ADV to add/).fill('100000')
  await panel.getByLabel(/ETH to add/).fill('1')
  await expect(panel.getByText('Starting price: 1 ADV = 0.00001 ETH')).toBeVisible()
  await panel.getByRole('button', { name: 'Approve ADV' }).click()
  await expect(panel.getByText('Approved — now add the liquidity.')).toBeVisible({ timeout: 20_000 })
  await panel.getByRole('button', { name: 'Add liquidity' }).click()
  await expect(panel.getByText('Liquidity added.')).toBeVisible({ timeout: 20_000 })
  // Recorded by the backend from the pair's own Mint event.
  await expect(panel.getByTestId('liquidity-history')).toContainText('100000 ADV + 1 ETH', { timeout: 15_000 })

  const pair = await publicClient.readContract({ address: LOCAL_UNISWAP.factory, abi: FACTORY_ABI, functionName: 'getPair', args: [token, LOCAL_UNISWAP.weth] })
  expect(pair).not.toBe(zeroAddress)
  const tokenIsToken0 = (await publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'token0' })).toLowerCase() === token.toLowerCase()
  const reserves = async () => {
    const [r0, r1] = await publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'getReserves' })
    return tokenIsToken0 ? { token: r0, native: r1 } : { token: r1, native: r0 }
  }
  await expect.poll(reserves).toEqual({ token: tokens('100000'), native: parseEther('1') })

  // --- Until trading is enabled, nobody else can buy from the pool.
  await expect(panel.getByText(/Trading isn't enabled yet/)).toBeVisible()
  await expect(
    buyer.writeContract({
      address: LOCAL_UNISWAP.router,
      abi: ROUTER_ABI,
      functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
      args: [0n, [LOCAL_UNISWAP.weth, token], buyer.account.address, deadline()],
      value: parseEther('0.01'),
    }),
  ).rejects.toThrow(/TRANSFER_FAILED/)

  // --- Register the pool as the trading pair, straight from the panel.
  await panel.getByRole('button', { name: 'Register as trading pair' }).click()
  await expect(panel.getByText(/Pool registered as a trading pair/)).toBeVisible({ timeout: 20_000 })
  await expect
    .poll(() => publicClient.readContract({ address: token, abi: TOKEN_ABI, functionName: 'marketPairs', args: [pair] }))
    .toBe(true)

  // --- Enable trading (Manage panel).
  await page.getByRole('button', { name: `Manage ${token}` }).click()
  const manage = page.getByTestId('erc20-manage')
  await manage.getByRole('button', { name: 'Enable trading' }).click()
  await expect(manage.getByText('Trading is enabled.')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => publicClient.readContract({ address: token, abi: TOKEN_ABI, functionName: 'tradingEnabled' })).toBe(true)

  // --- A real buy through the router: 3% buy tax, 60% of it to marketing.
  const before = await reserves()
  const bought = amountOut(parseEther('0.01'), before.native, before.token)
  const buyHash = await buyer.writeContract({
    address: LOCAL_UNISWAP.router,
    abi: ROUTER_ABI,
    functionName: 'swapExactETHForTokensSupportingFeeOnTransferTokens',
    args: [0n, [LOCAL_UNISWAP.weth, token], buyer.account.address, deadline()],
    value: parseEther('0.01'),
  })
  expect((await publicClient.waitForTransactionReceipt({ hash: buyHash })).status).toBe('success')
  const buyTax = (bought * 300n) / 10000n
  await expect.poll(() => balanceOf(buyer.account.address)).toBe(bought - buyTax)
  const buyMarketing = (buyTax * 60n) / 100n
  await expect.poll(() => balanceOf(marketing)).toBe(buyMarketing)
  await expect.poll(() => balanceOf(liquidity)).toBe(buyTax - buyMarketing)

  // --- A real sell back through the router: 5% sell tax on the way in.
  const sellAmount = tokens('500')
  const approveHash = await buyer.writeContract({ address: token, abi: TOKEN_ABI, functionName: 'approve', args: [LOCAL_UNISWAP.router, sellAmount] })
  await publicClient.waitForTransactionReceipt({ hash: approveHash })
  const sellHash = await buyer.writeContract({
    address: LOCAL_UNISWAP.router,
    abi: ROUTER_ABI,
    functionName: 'swapExactTokensForETHSupportingFeeOnTransferTokens',
    args: [sellAmount, 0n, [token, LOCAL_UNISWAP.weth], buyer.account.address, deadline()],
  })
  expect((await publicClient.waitForTransactionReceipt({ hash: sellHash })).status).toBe('success')
  const sellTax = (sellAmount * 500n) / 10000n
  const sellMarketing = (sellTax * 60n) / 100n
  await expect.poll(() => balanceOf(marketing)).toBe(buyMarketing + sellMarketing)
  await expect.poll(() => balanceOf(liquidity)).toBe(buyTax - buyMarketing + (sellTax - sellMarketing))
  await expect.poll(() => balanceOf(buyer.account.address)).toBe(bought - buyTax - sellAmount)

  // --- The panel now shows the live pool, at its new price.
  await page.getByRole('button', { name: `Liquidity for ${token}` }).click()
  await expect(panel.getByText('Pool live')).toBeVisible({ timeout: 15_000 })
  await expect(panel.getByText(/Current price: 1 ADV = /)).toBeVisible()
})
