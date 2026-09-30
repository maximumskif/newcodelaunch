import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import { createMint, getAccount, getAssociatedTokenAddressSync, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'

import { FIXTURE_WALLET_PUBLIC_KEY, fundFixtureWallet, VALIDATOR_RPC_URL } from './setup/solanaValidator'

const here = path.dirname(fileURLToPath(import.meta.url))
const connection = new Connection(VALIDATOR_RPC_URL, 'confirmed')
const sender = new PublicKey(FIXTURE_WALLET_PUBLIC_KEY)
let mint: PublicKey

// A token the fixture wallet holds: minted by a throwaway authority, so the
// test needs no key but the wallet's own (which only the page uses).
test.beforeAll(async () => {
  await fundFixtureWallet(connection)
  const authority = Keypair.generate()
  await connection.confirmTransaction(await connection.requestAirdrop(authority.publicKey, 2 * LAMPORTS_PER_SOL), 'confirmed')
  mint = await createMint(connection, authority, authority.publicKey, null, 6)
  const account = await getOrCreateAssociatedTokenAccount(connection, authority, mint, sender)
  await mintTo(connection, authority, mint, account.address, authority, 1_000_000n * 10n ** 6n)
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript({ path: path.join(here, '.generated', 'injectedSolanaWallet.bundle.js') })
})

test('a real airdrop: 30 fresh wallets, several transactions, exact cost shown — against a local Solana validator', async ({ page }) => {
  test.setTimeout(90_000)
  const recipients = Array.from({ length: 30 }, () => Keypair.generate().publicKey)

  await page.goto(`/liquidity/airdrop?mint=${mint.toBase58()}`)
  const connectButton = page.getByRole('button', { name: 'Connect Solana Wallet' })
  if (await connectButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await connectButton.click()
    await page.getByRole('button', { name: /Phantom/ }).click()
  }

  const tokenSelect = page.getByLabel('token to send')
  await expect(tokenSelect).toHaveValue(mint.toBase58(), { timeout: 15_000 })
  await expect(tokenSelect.locator('option:checked')).toContainText('balance 1,000,000')

  // A header, a typo'd line and a duplicate are called out, not sent.
  const lines = ['wallet,amount', ...recipients.map((r, i) => `${r.toBase58()}, ${i + 1}.5`), 'not-an-address, 5', `${recipients[0].toBase58()}, 1`]
  await page.getByLabel(/^recipients/).fill(lines.join('\n'))
  const problems = page.getByRole('alert')
  await expect(problems).toContainText('2 lines can')
  await expect(problems).toContainText('line 32: not a valid address')
  await expect(problems).toContainText('line 33: same address as line 2')

  // 1.5 + 2.5 + … + 30.5 = 480
  const summary = page.getByRole('complementary', { name: 'Summary' })
  await expect(summary).toContainText('480')
  await page.getByRole('button', { name: '[ review cost ]' }).click()
  await expect(summary.getByText('new accounts')).toBeVisible({ timeout: 15_000 })
  await expect(summary).toContainText(/new accounts\s*30/)
  // 30 accounts' rent, plus a fee per transaction.
  const rent = await connection.getMinimumBalanceForRentExemption(165)
  const transactions = Number((await summary.locator('dt:has-text("transactions") + dd').textContent()) ?? 0)
  expect(transactions).toBeGreaterThan(1)
  await expect(summary).toContainText(`${((30 * rent + transactions * 5000) / LAMPORTS_PER_SOL).toFixed(6)} SOL`)

  await page.getByRole('button', { name: '[ send airdrop ]' }).click()
  await expect(page.getByRole('heading', { name: 'sent to 30 of 30 wallets' })).toBeVisible({ timeout: 45_000 })
  await expect(page.getByTestId('airdrop-log').locator('li')).toHaveCount(transactions)

  for (const [i, recipient] of recipients.entries()) {
    const account = await getAccount(connection, getAssociatedTokenAddressSync(mint, recipient))
    expect(account.amount).toBe(BigInt(i + 1) * 10n ** 6n + 500_000n)
  }
  const left = await getAccount(connection, getAssociatedTokenAddressSync(mint, sender))
  expect(left.amount).toBe((1_000_000n - 480n) * 10n ** 6n)
  // The wallet's balance in the picker refreshes too.
  await expect(tokenSelect.locator('option:checked')).toContainText('balance 999,520')
})
