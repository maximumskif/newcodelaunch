import { expect, test, type Page } from '@playwright/test'
import { parseAbi, parseUnits, type Address } from 'viem'

import { freshAddress, installEvmWallet, publicClient, testClient } from './setup/evmToken'

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

  // The start defaults to now (the browser's clock, which earlier specs may
  // have left behind the chain's — a 12-month schedule leaves room).
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
