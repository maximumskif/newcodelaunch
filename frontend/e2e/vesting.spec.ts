import { expect, test, type Page } from '@playwright/test'
import { parseAbi, parseUnits, type Address } from 'viem'

import { deployAdvancedToken, freshAddress, installEvmWallet, ownerWallet, publicClient, testClient } from './setup/evmToken'

const BALANCE_ABI = parseAbi(['function balanceOf(address) view returns (uint256)'])
const DAY = 24 * 60 * 60

test.beforeEach(async ({ page }) => installEvmWallet(page))

// In-app navigation, so the wallet and sign-in stay as they are — and the
// vesting page remounts, re-reading the chain.
const goTo = (page: Page, url: string) =>
  page.evaluate((target) => {
    history.pushState({}, '', target)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)

test('a real vesting schedule: create, fund, nothing before the cliff, part-way release, then the rest — on a real chain', async ({ page }) => {
  test.setTimeout(180_000)

  await page.goto('/tokens/create')
  await page.getByRole('button', { name: 'Connect EVM Wallet' }).click()
  await page.getByRole('button', { name: /^Sign in with/ }).click()
  await expect(page.getByText(/EVM · 0xf39f/i)).toBeVisible({ timeout: 15_000 })
  await page.getByLabel(/^Token Name/).fill('Vesting E2E')
  await page.getByLabel(/^Token Symbol/).fill('TEAM')
  await page.getByLabel(/^Token Supply/).fill('1000000')
  await page.getByRole('button', { name: 'Deploy' }).click()
  const deployedText = page.getByTestId('deploy-result').getByText(/Deployed at/)
  await expect(deployedText).toBeVisible({ timeout: 30_000 })
  const token = (await deployedText.textContent())!.match(/0x[a-fA-F0-9]{40}/)![0] as Address
  const balanceOf = (owner: Address) => publicClient.readContract({ address: token, abi: BALANCE_ABI, functionName: 'balanceOf', args: [owner] })

  await goTo(page, `/liquidity/vesting?token=${token}`)
  await expect(page.getByTestId('vesting-token')).toHaveText('TEAM · your balance 1,000,000', { timeout: 15_000 })

  // The start defaults to now by the chain's clock.
  const beneficiary = freshAddress()
  await page.getByLabel(/^beneficiary/).fill(beneficiary)
  await page.getByLabel(/^amount/).fill('1200')
  await page.getByLabel(/^cliff/).fill('3')
  await page.getByLabel(/^vesting length/).fill('12')
  const summary = page.getByRole('complementary', { name: 'Summary' })
  await expect(summary).toContainText('1,200 TEAM')
  await summary.getByRole('button', { name: '[ create vesting contract ]' }).click()

  // Created, then funded from the panel (the amount is carried over).
  const created = page.getByRole('region', { name: 'created — now send it the tokens' })
  const panel = created.getByTestId('token-vesting')
  await expect(panel.getByText('Not funded yet')).toBeVisible({ timeout: 30_000 })
  const vestingAddress = (await page.getByTestId('vesting-created').textContent())!.match(/0x[a-fA-F0-9]{40}/)![0] as Address
  await panel.getByRole('button', { name: 'Fund' }).click()
  await expect(panel.getByText('Tokens added — they vest on the same schedule.')).toBeVisible({ timeout: 20_000 })
  expect(await balanceOf(vestingAddress)).toBe(parseUnits('1200', 18))
  await expect(panel.getByText(/^Cliff until/)).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Nothing to release yet' })).toBeDisabled()

  // Half a year on: past the cliff, about half vested.
  await testClient.increaseTime({ seconds: 183 * DAY })
  await testClient.mine({ blocks: 1 })
  await goTo(page, '/tokens/create')
  await goTo(page, '/liquidity/vesting')
  const listed = page.getByRole('region', { name: 'your vesting schedules' }).getByTestId('token-vesting')
  await expect(listed).toHaveCount(1, { timeout: 15_000 })
  await expect(listed.getByText(/^Vesting until/)).toBeVisible({ timeout: 15_000 })
  await listed.getByRole('button', { name: /^Release .* TEAM to beneficiary$/ }).click()
  await expect(listed.getByText('Released to the beneficiary.')).toBeVisible({ timeout: 20_000 })
  const halfway = await balanceOf(beneficiary)
  expect(halfway).toBeGreaterThan(parseUnits('540', 18))
  expect(halfway).toBeLessThan(parseUnits('660', 18))

  // Past the end: the rest, and nothing left behind.
  await testClient.increaseTime({ seconds: 365 * DAY })
  await testClient.mine({ blocks: 1 })
  await goTo(page, '/tokens/create')
  await goTo(page, '/liquidity/vesting')
  await expect(listed.getByText('Fully vested')).toBeVisible({ timeout: 15_000 })
  await listed.getByRole('button', { name: /^Release .* TEAM to beneficiary$/ }).click()
  await expect(listed.getByText('Fully paid out')).toBeVisible({ timeout: 20_000 })
  expect(await balanceOf(beneficiary)).toBe(parseUnits('1200', 18))
  expect(await balanceOf(vestingAddress)).toBe(0n)
})

test('a beneficiary finds and releases their schedule without signing in', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/tokens/create')
  await page.getByRole('button', { name: 'Connect EVM Wallet' }).click()
  await page.getByRole('button', { name: /^Sign in with/ }).click()
  await expect(page.getByText(/EVM · 0xf39f/i)).toBeVisible({ timeout: 15_000 })
  await page.getByLabel(/^Token Name/).fill('Paid To Me')
  await page.getByLabel(/^Token Symbol/).fill('MINE')
  await page.getByLabel(/^Token Supply/).fill('1000')
  await page.getByRole('button', { name: 'Deploy' }).click()
  const deployedText = page.getByTestId('deploy-result').getByText(/Deployed at/)
  await expect(deployedText).toBeVisible({ timeout: 30_000 })
  const token = (await deployedText.textContent())!.match(/0x[a-fA-F0-9]{40}/)![0] as Address

  // A schedule paying this same wallet: no cliff, one month.
  await goTo(page, `/liquidity/vesting?token=${token}`)
  await expect(page.getByTestId('vesting-token')).toBeVisible({ timeout: 15_000 })
  await page.getByLabel(/^beneficiary/).fill('0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266')
  await page.getByLabel(/^amount/).fill('100')
  await page.getByLabel(/^vesting length/).fill('1')
  await page.getByRole('complementary', { name: 'Summary' }).getByRole('button', { name: '[ create vesting contract ]' }).click()
  const created = page.getByRole('region', { name: 'created — now send it the tokens' }).getByTestId('token-vesting')
  await expect(created.getByText('Not funded yet')).toBeVisible({ timeout: 30_000 })
  await created.getByRole('button', { name: 'Fund' }).click()
  await expect(created.getByText('Tokens added — they vest on the same schedule.')).toBeVisible({ timeout: 20_000 })

  // A fresh load: wallet connected, not signed in.
  await testClient.increaseTime({ seconds: 40 * DAY })
  await testClient.mine({ blocks: 1 })
  await page.evaluate(() => localStorage.clear())
  await page.goto('/liquidity/vesting')
  await page.getByRole('button', { name: 'Connect EVM Wallet' }).click()
  await expect(page.getByText('Sign in to create vesting schedules')).toBeVisible()
  const mine = page.getByRole('region', { name: 'paid to you' }).getByTestId('token-vesting').filter({ hasText: token })
  await expect(mine).toHaveCount(1, { timeout: 15_000 })
  await mine.getByRole('button', { name: 'Release 100 MINE to you' }).click()
  await expect(mine.getByText('Fully paid out')).toBeVisible({ timeout: 20_000 })
  const balance = await publicClient.readContract({ address: token, abi: BALANCE_ABI, functionName: 'balanceOf', args: ['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'] })
  expect(balance).toBe(parseUnits('1000', 18))
})

test('vesting for several wallets: one contract each, funded together through the shared Multisend', async ({ page }) => {
  test.setTimeout(180_000)
  await page.goto('/tokens/create')
  await page.getByRole('button', { name: 'Connect EVM Wallet' }).click()
  await page.getByRole('button', { name: /^Sign in with/ }).click()
  await expect(page.getByText(/EVM · 0xf39f/i)).toBeVisible({ timeout: 15_000 })
  await page.getByLabel(/^Token Name/).fill('Team Batch')
  await page.getByLabel(/^Token Symbol/).fill('CREW')
  await page.getByLabel(/^Token Supply/).fill('1000000')
  await page.getByRole('button', { name: 'Deploy' }).click()
  const deployedText = page.getByTestId('deploy-result').getByText(/Deployed at/)
  await expect(deployedText).toBeVisible({ timeout: 30_000 })
  const token = (await deployedText.textContent())!.match(/0x[a-fA-F0-9]{40}/)![0] as Address
  const balanceOf = (owner: Address) => publicClient.readContract({ address: token, abi: BALANCE_ABI, functionName: 'balanceOf', args: [owner] })

  await goTo(page, `/liquidity/vesting?token=${token}`)
  await expect(page.getByTestId('vesting-token')).toBeVisible({ timeout: 15_000 })
  await page.getByRole('button', { name: 'Several wallets' }).click()
  const team = [freshAddress(), freshAddress(), freshAddress()]
  await page.getByLabel(/^recipients/).fill(team.map((who, i) => `${who}, ${(i + 1) * 1000}`).join('\n'))
  await page.getByLabel(/^cliff/).fill('6')
  await page.getByLabel(/^vesting length/).fill('24')
  const summary = page.getByRole('complementary', { name: 'Summary' })
  await expect(summary).toContainText('6,000 CREW')
  await expect(summary).toContainText('3 wallets')
  await summary.getByRole('button', { name: '[ create 3 vesting contracts ]' }).click()
  await expect(page.getByRole('heading', { name: '3 schedules created and funded' })).toBeVisible({ timeout: 90_000 })
  for (const who of team) expect(await balanceOf(who)).toBe(0n)

  // Past the end: each releases exactly its own amount.
  await testClient.increaseTime({ seconds: 25 * 31 * DAY })
  await testClient.mine({ blocks: 1 })
  await goTo(page, '/tokens/create')
  await goTo(page, '/liquidity/vesting')
  const panels = page.getByRole('region', { name: 'your vesting schedules' }).getByTestId('token-vesting').filter({ hasText: token })
  await expect(panels).toHaveCount(3, { timeout: 15_000 })
  for (let i = 0; i < 3; i++) {
    const panel = panels.nth(i)
    await expect(panel.getByText('Fully vested')).toBeVisible({ timeout: 15_000 })
    await panel.getByRole('button', { name: /^Release .* CREW to beneficiary$/ }).click()
    await expect(panel.getByText('Fully paid out')).toBeVisible({ timeout: 20_000 })
  }
  for (const [i, who] of team.entries()) expect(await balanceOf(who)).toBe(parseUnits(String((i + 1) * 1000), 18))
})

test('a capped token: releases in parts that fit, until its owner exempts the vesting contract', async ({ page }) => {
  test.setTimeout(180_000)
  // Max 10,000 per transfer, 20,000 per wallet; trading on.
  const token = await deployAdvancedToken(page, { marketing: freshAddress(), liquidity: freshAddress() })
  await ownerWallet.writeContract({ address: token, abi: parseAbi(['function enableTrading()']), functionName: 'enableTrading' })
  const balanceOf = (owner: Address) => publicClient.readContract({ address: token, abi: BALANCE_ABI, functionName: 'balanceOf', args: [owner] })

  await goTo(page, `/liquidity/vesting?token=${token}`)
  await expect(page.getByTestId('vesting-token')).toBeVisible({ timeout: 15_000 })
  const beneficiary = freshAddress()
  await page.getByLabel(/^beneficiary/).fill(beneficiary)
  await page.getByLabel(/^amount/).fill('100000')
  await page.getByLabel(/^vesting length/).fill('1')
  await page.getByRole('complementary', { name: 'Summary' }).getByRole('button', { name: '[ create vesting contract ]' }).click()
  const created = page.getByRole('region', { name: 'created — now send it the tokens' }).getByTestId('token-vesting')
  await expect(created.getByText('Not funded yet')).toBeVisible({ timeout: 30_000 })
  await created.getByRole('button', { name: 'Fund' }).click()
  await expect(created.getByText('Tokens added — they vest on the same schedule.')).toBeVisible({ timeout: 20_000 })

  await testClient.increaseTime({ seconds: 40 * DAY })
  await testClient.mine({ blocks: 1 })
  await goTo(page, '/tokens/create')
  await goTo(page, '/liquidity/vesting')
  const panel = page.getByRole('region', { name: 'your vesting schedules' }).getByTestId('token-vesting').filter({ hasText: token })
  await expect(panel.getByTestId('token-limits')).toContainText('caps a transfer at 10,000 ADV', { timeout: 15_000 })

  // All 100,000 is due, but one transfer can only carry 10,000.
  await panel.getByRole('button', { name: 'Release 10,000 ADV of 100,000 ADV to beneficiary' }).click()
  await expect(panel.getByText('Released to the beneficiary.')).toBeVisible({ timeout: 20_000 })
  expect(await balanceOf(beneficiary)).toBe(parseUnits('10000', 18))

  // The owner (this wallet) exempts it; the rest goes at once.
  await panel.getByRole('button', { name: "Exempt from the token's limits" }).click()
  await expect(panel.getByText('This contract is now exempt from the token’s limits.')).toBeVisible({ timeout: 20_000 })
  await expect(panel.getByTestId('token-limits')).toHaveCount(0)
  await panel.getByRole('button', { name: 'Release 90,000 ADV to beneficiary' }).click()
  await expect(panel.getByText('Fully paid out')).toBeVisible({ timeout: 20_000 })
  expect(await balanceOf(beneficiary)).toBe(parseUnits('100000', 18))
})
