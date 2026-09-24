import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import { Connection, Keypair } from '@solana/web3.js'

import { API_BASE_URL, AUTH_STORAGE_KEY, seedPublishedCollection } from './setup/seed'
import {
  CORE_CANDY_GUARD_PROGRAM_ID,
  CORE_CANDY_MACHINE_PROGRAM_ID,
  CORE_PROGRAM_ID,
  FIXTURE_WALLET_PUBLIC_KEY as CREATOR_PUBLIC_KEY,
  fundFixtureWallet,
  VALIDATOR_RPC_URL,
  waitForClonedPrograms,
} from './setup/solanaValidator'

const here = path.dirname(fileURLToPath(import.meta.url))

// datetime-local input format, in the browser's (and this process's) local time.
function localInput(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}

test.beforeAll(async () => {
  const connection = new Connection(VALIDATOR_RPC_URL, 'confirmed')
  await waitForClonedPrograms(connection, [CORE_PROGRAM_ID, CORE_CANDY_MACHINE_PROGRAM_ID, CORE_CANDY_GUARD_PROGRAM_ID])
  await fundFixtureWallet(connection)
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript({ path: path.join(here, '.generated', 'injectedSolanaWallet.bundle.js') })
})

test('a real allowlist phase: listed wallet mints at the allowlist price, others are refused, then the live drop is edited — against a real local Solana validator', async ({
  page,
  request,
}) => {
  test.setTimeout(120_000)

  await page.goto('/mint')
  const connectButton = page.getByRole('button', { name: 'Connect Solana Wallet' })
  if (await connectButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await connectButton.click()
    await page.getByRole('button', { name: /Phantom/ }).click()
  }
  await page.getByRole('button', { name: /^Sign in with/ }).click()
  await expect(page.getByText(new RegExp(`SOLANA · ${CREATOR_PUBLIC_KEY.slice(0, 6)}`))).toBeVisible({ timeout: 15_000 })
  const accessToken = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').accessToken as string, AUTH_STORAGE_KEY)
  const headers = { Authorization: `Bearer ${accessToken}` }

  const { collection } = await seedPublishedCollection(request, headers, 'E2E Phased Drop', 2)

  // Launch through the actual form: allowlist phase open since yesterday
  // (the fixture wallet + one other), public phase opening tomorrow.
  const otherListed = Keypair.generate().publicKey.toBase58()
  await page.goto(`/mint?collection=${collection.id}`)
  await page.getByLabel('Price per mint (SOL)').fill('0.2')
  await page.getByLabel('Go-live date').fill(localInput(new Date(Date.now() + 24 * 3600_000)))
  await page.getByLabel(/Add an allowlist phase/).check()
  await page.getByLabel(/Allowlisted wallets/).fill(`${CREATOR_PUBLIC_KEY}\n${otherListed}`)
  await expect(page.getByText('2 wallets')).toBeVisible()
  await page.getByLabel('Allowlist price (SOL)').fill('0.05')
  await page.getByLabel('Allowlist start').fill(localInput(new Date(Date.now() - 24 * 3600_000)))
  await page.getByLabel(/Max mints per wallet/).fill('1')
  await page.getByRole('button', { name: 'Launch Candy Machine' }).click()

  // Recording now reads the guard groups back from the chain and checks
  // them — prices, dates, payment destination, and the merkle root of the
  // list above — so reaching "created" means the on-chain phases are right.
  await expect(page.getByText('Candy Machine created.')).toBeVisible({ timeout: 45_000 })
  const storefrontLink = page.getByRole('link', { name: /\/mint\/buy\// })
  const candyMachine = (await storefrontLink.textContent())!.split('/mint/buy/')[1]

  // Someone not on the list is refused by the backend before any
  // transaction is built (and the on-chain allowList guard would reject
  // them anyway, which the sidecar's probe run confirmed).
  const outsider = Keypair.generate().publicKey.toBase58()
  const refused = await request.post(`${API_BASE_URL}/mint/public/${candyMachine}/mint`, { data: { minter_wallet: outsider } })
  expect(refused.status()).toBe(403)
  expect((await refused.json()).error).toContain('allowlist-only')

  // The listed wallet sees the allowlist phase and mints at its price —
  // a real proof route + mint in one transaction.
  await storefrontLink.click()
  await expect(page).toHaveURL(/\/mint\/buy\//)
  await expect(page.getByText('Allowlist phase', { exact: true })).toBeVisible()
  await expect(page.getByText('Allowlist · 2 wallets')).toBeVisible()
  await page.getByRole('button', { name: 'Mint for 0.05 SOL' }).click()
  await expect(page.getByText('Minted!')).toBeVisible({ timeout: 30_000 })
  await expect(page.getByText('1 of 2 remaining')).toBeVisible({ timeout: 10_000 })

  // The drop allows 1 per wallet (the mintLimit guard's on-chain counter):
  // on reload the storefront shows this wallet has hit it, and the mint API
  // refuses to build another.
  await page.reload()
  await expect(page.getByText("You've reached this drop's limit")).toBeVisible()
  const overLimit = await request.post(`${API_BASE_URL}/mint/public/${candyMachine}/mint`, {
    data: { minter_wallet: CREATOR_PUBLIC_KEY },
  })
  expect(overLimit.status()).toBe(403)
  expect((await overLimit.json()).error).toContain('limit is 1 per wallet')

  // The dashboard: allowlist phase, and revenue as a range (1 mint at either
  // 0.05 or 0.2 — the chain doesn't record which phase a mint came through).
  await page.goto('/mint')
  const row = page.getByRole('row', { name: /E2E Phased Drop/ })
  await expect(row).toContainText('1 / 2')
  await expect(row).toContainText('Allowlist phase')
  await expect(row).toContainText('0.05–0.2 SOL')
  await expect(row).toContainText('Max 1 per wallet')

  // Edit the live drop's phases: drop the allowlist, open public minting an
  // hour ago at a new 0.15 SOL price. One creator-signed guard update; the
  // backend only saves it after reading the new configuration back from the
  // chain, so reaching the refreshed dashboard means the chain has it.
  await row.getByRole('button', { name: /Edit phases/ }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByLabel(/Allowlisted wallets/)).toHaveValue(new RegExp(CREATOR_PUBLIC_KEY))
  await dialog.getByLabel('Public price (SOL)').fill('0.15')
  await dialog.getByLabel('Public go-live').fill(localInput(new Date(Date.now() - 3600_000)))
  await dialog.getByLabel(/Add an allowlist phase/).uncheck()
  // Raise the limit to 2 — the counter is shared across phases, so this
  // wallet (1 allowlist mint so far) gets exactly one more.
  await expect(dialog.getByLabel(/Max mints per wallet/)).toHaveValue('1')
  await dialog.getByLabel(/Max mints per wallet/).fill('2')
  await dialog.getByRole('button', { name: 'Save phases' }).click()
  await expect(dialog).toBeHidden({ timeout: 45_000 })

  await expect(row).toContainText('Live')
  await expect(row).toContainText('0.15 SOL')
  // The earlier allowlist sale may have paid 0.05 — the range still covers
  // every price this drop has had (0.05, 0.2, 0.15).
  await expect(row).toContainText('0.05–0.2 SOL')

  // And the storefront mints at the new price, through the updated guards.
  await page.goto(`/mint/buy/${candyMachine}`)
  await expect(page.getByText('Live now')).toBeVisible()
  await expect(page.getByText("You've minted 1 of 2 allowed per wallet.")).toBeVisible()
  await page.getByRole('button', { name: 'Mint for 0.15 SOL' }).click()
  await expect(page.getByText('Minted!')).toBeVisible({ timeout: 30_000 })
})
