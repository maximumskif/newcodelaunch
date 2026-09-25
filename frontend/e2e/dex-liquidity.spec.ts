import { expect, test } from '@playwright/test'
import { parseAbi, parseEther, parseUnits, zeroAddress, type Address } from 'viem'

import { anvil, ANVIL_RPC_URL, deployAdvancedToken, freshAddress, fundedWallet, installEvmWallet, publicClient, testClient } from './setup/evmToken'
import { expectNoA11yViolations } from './setup/axe'
import { ensureLocalUniswap, LOCAL_UNISWAP } from './setup/localUniswap'

const TOKEN_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function marketPairs(address) view returns (bool)',
  'function tradingEnabled() view returns (bool)',
  'function approve(address spender, uint256 amount) returns (bool)',
])
const FACTORY_ABI = parseAbi(['function getPair(address, address) view returns (address)'])
const PAIR_ABI = parseAbi([
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function token0() view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
])
const LOCK_ABI = parseAbi(['function lockedAmount() view returns (uint256)', 'function release()'])
const OWNER: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
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

test('liquidity for an advanced ERC-20 on a real Uniswap V2: pool created from the UI, registered as the trading pair, real swaps taxed, then LP time-locked and released', async ({
  page,
  browser,
}) => {
  test.setTimeout(240_000)
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

  // --- Remove 5% of the owner's position through the router. The pull
  // from the pool is a "buy" for this token (3% tax, and capped by its
  // 10,000-token transfer limit — so 30% is refused before sending).
  const removal = panel.getByTestId('liquidity-remove')
  await removal.getByLabel(/Share of your position/).fill('30')
  await expect(removal.getByText(/than this token lets move in one transfer/)).toBeVisible()
  await expect(removal.getByRole('button', { name: /Approve LP tokens|Remove liquidity/ })).toBeDisabled()

  const lpMine = await publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'balanceOf', args: [OWNER] })
  const lpTotal = await publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'totalSupply' })
  const beforeRemoval = await reserves()
  const ownerTokensBefore = await balanceOf(OWNER)
  const marketingBefore = await balanceOf(marketing)
  const lpOut = (lpMine * 5n) / 100n
  const tokenOut = (lpOut * beforeRemoval.token) / lpTotal
  const nativeOut = (lpOut * beforeRemoval.native) / lpTotal

  await removal.getByLabel(/Share of your position/).fill('5')
  await removal.getByRole('button', { name: 'Approve LP tokens' }).click()
  await expect(panel.getByText('Approved — now remove the liquidity.')).toBeVisible({ timeout: 20_000 })
  await removal.getByRole('button', { name: 'Remove liquidity' }).click()
  await expect(panel.getByText(/Liquidity removed/)).toBeVisible({ timeout: 20_000 })

  const removalTax = (tokenOut * 300n) / 10000n
  await expect.poll(reserves).toEqual({ token: beforeRemoval.token - tokenOut, native: beforeRemoval.native - nativeOut })
  await expect.poll(() => balanceOf(OWNER)).toBe(ownerTokensBefore + tokenOut - removalTax)
  await expect.poll(() => balanceOf(marketing)).toBe(marketingBefore + (removalTax * 60n) / 100n)

  // --- Time-lock half of the remaining LP: a Token Time-Lock contract
  // deployed from the owner's wallet (release a few minutes out), then the
  // LP moved into it.
  const lpBeforeLock = await publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'balanceOf', args: [OWNER] })
  const lockSection = panel.getByTestId('liquidity-lock')
  const releaseAt = new Date(Date.now() + 5 * 60_000)
  const pad = (n: number) => String(n).padStart(2, '0')
  const local = `${releaseAt.getFullYear()}-${pad(releaseAt.getMonth() + 1)}-${pad(releaseAt.getDate())}T${pad(releaseAt.getHours())}:${pad(releaseAt.getMinutes())}`
  await lockSection.getByLabel('Locked until').fill(local)
  await lockSection.getByRole('button', { name: 'Create a lock until this date' }).click()
  await expect(lockSection.getByTestId('liquidity-locks')).toContainText('Empty lock', { timeout: 45_000 })
  await lockSection.getByLabel('Share of your position to lock (%)').fill('50')
  await lockSection.getByRole('button', { name: 'Move 50% of your LP here' }).click()
  await expect(panel.getByText('LP tokens moved into the lock.')).toBeVisible({ timeout: 20_000 })
  await expect(panel.getByText(/time-locked$/)).toBeVisible({ timeout: 15_000 })
  await expectNoA11yViolations(page, 'liquidity panel with a time-lock')

  // The lock's own history row (after a reload, the history re-reads).
  await page.reload()
  const lockRow = page.getByRole('row', { name: /Token Time-Lock/ }).first()
  const manageLock = lockRow.getByRole('button', { name: /^Manage 0x/ })
  const lock = (await manageLock.getAttribute('aria-label'))!.replace('Manage ', '') as Address
  const locked = lpBeforeLock / 2n
  await expect.poll(() => publicClient.readContract({ address: lock, abi: LOCK_ABI, functionName: 'lockedAmount' })).toBe(locked)
  await expect.poll(() => publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'balanceOf', args: [OWNER] })).toBe(lpBeforeLock - locked)

  // A buyer — a fresh browser, no wallet, not signed in — sees the lock on
  // the token's public page, read from the chain.
  const lpSupplyNow = await publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'totalSupply' })
  const stranger = await browser.newContext()
  const publicPage = await stranger.newPage()
  await publicPage.goto(`/token/sepolia/${token}`)
  await expect(publicPage.getByRole('heading', { name: 'Advanced E2E (ADV)' })).toBeVisible({ timeout: 20_000 })
  await expect(publicPage.getByText('Trading is enabled')).toBeVisible()
  await expect(publicPage.getByText(/Buy tax 3% · sell tax 5%/)).toBeVisible()
  await expect(publicPage.getByText(`${((Number(locked) / Number(lpSupplyNow)) * 100).toFixed(2)}% of the pool's liquidity is time-locked`)).toBeVisible()
  await expect(publicPage.getByTestId('token-page-pool')).toContainText(lock)
  await expectNoA11yViolations(publicPage, 'public token page (EVM)')
  await stranger.close()

  // Nobody can release it early — not even by calling the contract directly.
  await expect(buyer.writeContract({ address: lock, abi: LOCK_ABI, functionName: 'release' })).rejects.toThrow(/Tokens are still locked/)

  // A buyer can check what it is: its source verifies on the explorer
  // (the local verifying Etherscan stub recompiles and compares bytecode).
  await lockRow.getByRole('button', { name: 'Verify source' }).click()
  await expect(lockRow.getByRole('link', { name: 'Source verified' })).toBeVisible({ timeout: 20_000 })

  // Once the release time has passed (anvil's clock moved forward), anyone
  // can trigger the release — and it pays only the beneficiary, the owner.
  await testClient.increaseTime({ seconds: 10 * 60 })
  await testClient.mine({ blocks: 1 })
  await page.reload()
  await page.getByRole('row', { name: /Token Time-Lock/ }).first().getByRole('button', { name: `Manage ${lock}` }).click()
  const lockPanel = page.getByTestId('token-lock')
  await lockPanel.getByRole('button', { name: 'Release to beneficiary' }).click()
  await expect(lockPanel.getByText('Released to the beneficiary.')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'balanceOf', args: [OWNER] })).toBe(lpBeforeLock)
  await expect.poll(() => publicClient.readContract({ address: lock, abi: LOCK_ABI, functionName: 'lockedAmount' })).toBe(0n)
})
