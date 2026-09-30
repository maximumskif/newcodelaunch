import { expect, test } from '@playwright/test'
import { parseAbi, parseUnits, type Address } from 'viem'

import { freshAddress, installEvmWallet, publicClient } from './setup/evmToken'

const BALANCE_ABI = parseAbi(['function balanceOf(address) view returns (uint256)'])

test.beforeEach(async ({ page }) => installEvmWallet(page))

test('a real EVM airdrop: one-time multisend setup, approval, two batches — on a real chain', async ({ page }) => {
  test.setTimeout(180_000)

  // A token the wallet holds: a basic ERC-20 deployed through the app.
  await page.goto('/tokens/create')
  await page.getByRole('button', { name: 'Connect EVM Wallet' }).click()
  await page.getByRole('button', { name: /^Sign in with/ }).click()
  await expect(page.getByText(/EVM · 0xf39f/i)).toBeVisible({ timeout: 15_000 })
  await page.getByLabel(/^Token Name/).fill('Airdrop E2E')
  await page.getByLabel(/^Token Symbol/).fill('AIR')
  await page.getByLabel(/^Token Supply/).fill('1000000')
  await page.getByRole('button', { name: 'Deploy' }).click()
  const deployedText = page.getByTestId('deploy-result').getByText(/Deployed at/)
  await expect(deployedText).toBeVisible({ timeout: 30_000 })
  const token = (await deployedText.textContent())!.match(/0x[a-fA-F0-9]{40}/)![0] as Address

  // In-app navigation, so the wallet and sign-in stay as they are.
  await page.evaluate((url) => {
    history.pushState({}, '', url)
    dispatchEvent(new PopStateEvent('popstate'))
  }, `/liquidity/airdrop?token=${token}`)
  await expect(page.getByTestId('evm-token')).toHaveText('AIR · your balance 1,000,000', { timeout: 15_000 })

  // 160 wallets: more than one batch of 150.
  const recipients = Array.from({ length: 160 }, () => freshAddress())
  await page.getByLabel(/^recipients/).fill(recipients.map((r, i) => `${r} ${i + 1}`).join('\n'))
  const summary = page.getByRole('complementary', { name: 'Summary' })
  await expect(summary).toContainText('12,880 AIR') // 1 + 2 + … + 160
  await expect(summary).toContainText(/transactions\s*3/) // approve + 2 sends

  // Anvil starts empty each run, so nobody has deployed the shared
  // Multisend here: the first sender does, once.
  await summary.getByRole('button', { name: '[ deploy airdrop contract ]' }).click()
  const sendButton = summary.getByRole('button', { name: '[ send airdrop ]' })
  await expect(sendButton).toBeEnabled({ timeout: 30_000 })

  await sendButton.click()
  await expect(page.getByRole('heading', { name: 'sent to 160 of 160 wallets' })).toBeVisible({ timeout: 60_000 })
  await expect(page.getByTestId('airdrop-log').locator('li')).toHaveCount(2)

  const balanceOf = (owner: Address) => publicClient.readContract({ address: token, abi: BALANCE_ABI, functionName: 'balanceOf', args: [owner] })
  for (const [i, recipient] of recipients.entries()) {
    expect(await balanceOf(recipient)).toBe(parseUnits(String(i + 1), 18))
  }
  await expect(page.getByTestId('evm-token')).toHaveText('AIR · your balance 987,120', { timeout: 15_000 })
})
