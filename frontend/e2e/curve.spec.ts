import { expect, test } from '@playwright/test'
import { formatEther, parseAbi, parseEther, type Address } from 'viem'

import { expectNoA11yViolations } from './setup/axe'
import { anvil, ANVIL_RPC_URL, installEvmWallet, ownerWallet, publicClient } from './setup/evmToken'
import { ensureLocalUniswap, LOCAL_UNISWAP } from './setup/localUniswap'

const CURVE_ABI = parseAbi([
  'function balanceOf(address) view returns (uint256)',
  'function ethReserve() view returns (uint256)',
  'function tokensSold() view returns (uint256)',
  'function curveSupply() view returns (uint256)',
  'function poolSupply() view returns (uint256)',
  'function graduated() view returns (bool)',
  'function pair() view returns (address)',
  'function quoteBuy(uint256 value) view returns (uint256 tokens, uint256 cost, uint256 fee)',
  'function quoteSell(uint256 tokens) view returns (uint256 eth, uint256 fee)',
  'function feeRecipient() view returns (address)',
  'function feesOwed() view returns (uint256)',
  'function creator() view returns (address)',
  'function creatorFeesOwed() view returns (uint256)',
  'function withdrawFees() returns (uint256)',
])
const PAIR_ABI = parseAbi([
  'function getReserves() view returns (uint112, uint112, uint32)',
  'function token0() view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address) view returns (uint256)',
])
const DEAD = '0x000000000000000000000000000000000000dEaD'
// run-backend.sh's PLATFORM_FEE_RECIPIENT.
const FEE_WALLET = '0x000000000000000000000000000000000000FEE0'
const me = ownerWallet.account.address

test.beforeAll(async () => ensureLocalUniswap(anvil, ANVIL_RPC_URL))
test.beforeEach(async ({ page }) => installEvmWallet(page))

test('a real bonding-curve launch: creator buy, buy and sell on the public page, then a buy-out graduates it into a burned Uniswap V2 pool', async ({ page: creatorPage, browser }) => {
  test.setTimeout(180_000)
  let page = creatorPage
  const read = <T,>(address: Address, functionName: string, args: readonly unknown[] = []) =>
    publicClient.readContract({ address, abi: CURVE_ABI, functionName, args } as never) as Promise<T>

  // Launch, with a creator buy in the same transaction.
  await page.goto('/tokens/curve')
  await page.getByRole('button', { name: 'Connect EVM Wallet' }).click()
  await page.getByRole('button', { name: /^Sign in with/ }).click()
  await expect(page.getByText(/EVM · 0xf39f/i)).toBeVisible({ timeout: 15_000 })
  await page.getByLabel('network').selectOption('sepolia')
  await page.getByLabel('token name').fill('Curve E2E')
  await page.getByLabel('symbol').fill('CRVE')
  await expect(page.getByLabel(/^raise target/)).toHaveValue('0.02') // the testnet suggestion
  await page.getByLabel(/^your buy at launch/).fill('0.002')
  const summary = page.getByRole('complementary', { name: 'Summary' })
  await expect(summary).toContainText('Uniswap V2')
  await expect(summary).toContainText('market cap then')
  await expect(summary).toContainText('1%: 0.3% to you, 0.7% to the platform')
  await expectNoA11yViolations(page, 'curve launch form')
  await summary.getByRole('button', { name: '[ launch on the curve ]' }).click()

  const created = page.getByRole('region', { name: 'launched' })
  await expect(created.getByTestId('curve-panel')).toBeVisible({ timeout: 45_000 })
  const token = (await page.getByTestId('curve-created').textContent())!.match(/0x[a-fA-F0-9]{40}/)![0] as Address
  // The creator buy pays the fee too: 0.002 sent, 1/1.01 of it raised.
  const creatorRaised = (parseEther('0.002') * 100n) / 101n
  expect(await read<bigint>(token, 'ethReserve')).toBe(creatorRaised)
  // Split 0.3 : 0.7 between the creator (the launching wallet) and the platform.
  const fees = async () => (await read<bigint>(token, 'feesOwed')) + (await read<bigint>(token, 'creatorFeesOwed'))
  const creatorFee = parseEther('0.002') - creatorRaised
  expect(await fees()).toBe(creatorFee)
  expect(await read<bigint>(token, 'creatorFeesOwed')).toBe((creatorFee * 30n) / 100n)
  expect((await read<Address>(token, 'creator')).toLowerCase()).toBe(me.toLowerCase())
  expect((await read<Address>(token, 'feeRecipient')).toLowerCase()).toBe(FEE_WALLET.toLowerCase())
  const creatorTokens = await read<bigint>(token, 'balanceOf', [me])
  expect(creatorTokens).toBe(await read<bigint>(token, 'tokensSold'))
  await expect(created.getByTestId('curve-progress')).toContainText(/^9\.9% · .* ETH of 0\.02 ETH raised/)

  // The public page, as a buyer arriving fresh: no account, no session.
  page = await (await browser.newContext()).newPage()
  await installEvmWallet(page)
  await page.goto(`/token/sepolia/${token}`)
  const curveCard = page.getByTestId('token-page-curve')
  await expect(curveCard.getByText('On the bonding curve')).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('token-page-pool')).toContainText('opens when the curve graduates')
  await expect(page.getByText('No owner — nobody can change its rules')).toBeVisible()
  await curveCard.getByRole('button', { name: 'Connect wallet to trade' }).click()

  // Buy: the panel's quote is the contract's, to the wei.
  const [expected, buyCost, buyFee] = await read<[bigint, bigint, bigint]>(token, 'quoteBuy', [parseEther('0.005')])
  expect(buyCost + buyFee).toBe(parseEther('0.005'))
  await curveCard.getByLabel(/^Spend \(ETH\)/).fill('0.005')
  await expect(curveCard.getByTestId('curve-quote')).toContainText(/includes a .* ETH fee/)
  await curveCard.getByRole('button', { name: 'Buy', exact: true }).click()
  await expect(curveCard.getByText('Bought.')).toBeVisible({ timeout: 20_000 })
  const afterBuy = await read<bigint>(token, 'balanceOf', [me])
  expect(afterBuy - creatorTokens).toBe(expected)

  // Sell what was just bought: back to where the creator buy left it.
  await curveCard.getByRole('button', { name: 'sell', exact: true }).click()
  const sellText = formatEther(expected)
  await curveCard.getByLabel(/^Sell \(CRVE\)/).fill(sellText)
  const [ethBack, sellFee] = await read<[bigint, bigint]>(token, 'quoteSell', [expected])
  const before = await publicClient.getBalance({ address: me })
  await curveCard.getByRole('button', { name: 'Sell', exact: true }).click()
  await expect(curveCard.getByText('Sold.')).toBeVisible({ timeout: 20_000 })
  expect(await read<bigint>(token, 'balanceOf', [me])).toBe(creatorTokens)
  const gained = (await publicClient.getBalance({ address: me })) - before
  expect(gained).toBeLessThanOrEqual(ethBack) // less the gas
  expect(gained).toBeGreaterThan(ethBack - parseEther('0.001'))
  expect(await read<bigint>(token, 'ethReserve')).toBe(creatorRaised + buyCost - ethBack - sellFee)
  expect(await fees()).toBe(creatorFee + buyFee + sellFee)

  // The trades so far (creator buy, buy, sell), charted and listed from the curve's events.
  const activity = curveCard.getByTestId('curve-activity')
  await expect(activity.getByRole('table', { name: '3 trades' })).toBeVisible({ timeout: 20_000 })
  await expect(activity.getByRole('img', { name: /^Price in ETH since launch|^Price since launch/ })).toBeVisible()
  await expect(activity.getByRole('row')).toHaveCount(4)
  await expect(activity.getByRole('row').nth(1)).toContainText('▼ sell')
  await expectNoA11yViolations(page, 'public page of a token on its curve')

  // Buy it out: the panel says this graduates it, and refunds the rest.
  await curveCard.getByRole('button', { name: 'buy', exact: true }).click()
  await curveCard.getByLabel(/^Spend \(ETH\)/).fill('0.05')
  await expect(curveCard.getByTestId('curve-quote')).toContainText('This graduates it to Uniswap V2')
  await curveCard.getByRole('button', { name: 'Buy', exact: true }).click()
  await expect(curveCard.getByText('Graduated to Uniswap V2')).toBeVisible({ timeout: 20_000 })

  // On-chain: the pool has everything raised and the other 20%, LP burned.
  expect(await read<boolean>(token, 'graduated')).toBe(true)
  const pair = await read<Address>(token, 'pair')
  expect(pair.toLowerCase()).toBe(
    (
      await publicClient.readContract({
        address: LOCAL_UNISWAP.factory,
        abi: parseAbi(['function getPair(address, address) view returns (address)']),
        functionName: 'getPair',
        args: [token, LOCAL_UNISWAP.weth],
      })
    ).toLowerCase(),
  )
  const [r0, r1] = await publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'getReserves' })
  const tokenIs0 = (await publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'token0' })).toLowerCase() === token.toLowerCase()
  expect(tokenIs0 ? r0 : r1).toBe(await read<bigint>(token, 'poolSupply'))
  expect(tokenIs0 ? r1 : r0).toBe(await read<bigint>(token, 'ethReserve'))
  const lpSupply = await publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'totalSupply' })
  expect(await publicClient.readContract({ address: pair, abi: PAIR_ABI, functionName: 'balanceOf', args: [DEAD] })).toBe(lpSupply - 1000n)
  // The curve keeps only the fees, and anyone can send the platform's share on, only to the platform.
  const owed = await read<bigint>(token, 'feesOwed')
  const creatorOwed = await read<bigint>(token, 'creatorFeesOwed')
  expect(await publicClient.getBalance({ address: token })).toBe(owed + creatorOwed)
  expect((owed + creatorOwed) * 100n).toBeGreaterThanOrEqual(await read<bigint>(token, 'ethReserve'))
  const feeWalletBefore = await publicClient.getBalance({ address: FEE_WALLET })
  const sendOn = await ownerWallet.writeContract({ address: token, abi: CURVE_ABI, functionName: 'withdrawFees' })
  expect((await publicClient.waitForTransactionReceipt({ hash: sendOn })).status).toBe('success')
  expect((await publicClient.getBalance({ address: FEE_WALLET })) - feeWalletBefore).toBe(owed)
  expect(await publicClient.getBalance({ address: token })).toBe(creatorOwed)

  // The page, read again: a live pool, its liquidity burned.
  await page.reload()
  const poolCard = page.getByTestId('token-page-pool')
  await expect(poolCard.getByText(/of the pool's liquidity is burned/)).toBeVisible({ timeout: 20_000 })
  await expect(page.getByTestId('token-page-curve')).toContainText('Bonding curve (graduated)')
  await expectNoA11yViolations(page, 'public page of a graduated curve token')

  await expect(page.getByTestId('curve-activity').getByRole('table', { name: '4 trades' })).toBeVisible({ timeout: 20_000 })

  // The public feed of launches shows it graduated.
  await page.goto('/launches')
  const card = page.getByRole('link', { name: /Curve E2E/ })
  await expect(card.getByText('Graduated')).toBeVisible({ timeout: 20_000 })
  await expectNoA11yViolations(page, 'new launches feed')
  await card.click()
  await expect(page).toHaveURL(new RegExp(`/token/sepolia/${token}$`, 'i'))

  // And the creator's launch page lists it under "your curve launches".
  await creatorPage.goto('/tokens/curve')
  const mine = creatorPage.getByRole('region', { name: 'your curve launches' })
  await expect(mine.getByText('Graduated to Uniswap V2')).toBeVisible({ timeout: 20_000 })

  // The creator claims their share there, after graduation.
  const earnings = mine.getByTestId('curve-creator-fees')
  await expect(earnings).toContainText('to claim')
  const creatorBefore = await publicClient.getBalance({ address: me })
  await earnings.getByRole('button', { name: 'Claim' }).click()
  await expect(mine.getByText('Your creator fees are on their way to your wallet.')).toBeVisible({ timeout: 20_000 })
  expect(await read<bigint>(token, 'creatorFeesOwed')).toBe(0n)
  expect(await publicClient.getBalance({ address: token })).toBe(0n)
  const creatorGained = (await publicClient.getBalance({ address: me })) - creatorBefore
  expect(creatorGained).toBeLessThanOrEqual(creatorOwed) // less the gas
  expect(creatorGained).toBeGreaterThan(creatorOwed - parseEther('0.001'))
  await expect(earnings.getByRole('button', { name: 'Claim' })).toBeDisabled()
  await expectNoA11yViolations(creatorPage, 'curve launches with creator earnings')
})
