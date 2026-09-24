import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import { Connection } from '@solana/web3.js'

import { AUTH_STORAGE_KEY, seedLargePublishedCollection } from './setup/seed'
import {
  CORE_CANDY_GUARD_PROGRAM_ID,
  CORE_CANDY_MACHINE_PROGRAM_ID,
  CORE_PROGRAM_ID,
  FIXTURE_WALLET_PUBLIC_KEY,
  fundFixtureWallet,
  VALIDATOR_RPC_URL,
  waitForClonedPrograms,
} from './setup/solanaValidator'

const here = path.dirname(fileURLToPath(import.meta.url))
const ITEMS = 150

test.beforeAll(async () => {
  const connection = new Connection(VALIDATOR_RPC_URL, 'confirmed')
  await waitForClonedPrograms(connection, [CORE_PROGRAM_ID, CORE_CANDY_MACHINE_PROGRAM_ID, CORE_CANDY_GUARD_PROGRAM_ID])
  await fundFixtureWallet(connection)
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript({ path: path.join(here, '.generated', 'injectedSolanaWallet.bundle.js') })
})

test(`a ${ITEMS}-item Candy Machine drop: items stored compactly and loaded in wallet-approved batches — against a real local Solana validator`, async ({
  page,
  request,
}) => {
  test.setTimeout(180_000)

  await page.goto('/mint')
  const connect = page.getByRole('button', { name: 'Connect Solana Wallet' })
  if (await connect.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await connect.click()
    await page.getByRole('button', { name: /Phantom/ }).click()
  }
  await page.getByRole('button', { name: /^Sign in with/ }).click()
  await expect(page.getByText(new RegExp(`SOLANA · ${FIXTURE_WALLET_PUBLIC_KEY.slice(0, 6)}`))).toBeVisible({ timeout: 15_000 })
  const accessToken = await page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').accessToken as string, AUTH_STORAGE_KEY)

  // Well past the old 20-item cap, and more than one transaction holds.
  const { collection } = await seedLargePublishedCollection(request, { Authorization: `Bearer ${accessToken}` }, 'E2E Big Drop', ITEMS)

  await page.goto(`/mint?collection=${collection.id}`)
  await expect(page.getByText(`${ITEMS} of ${ITEMS} generated items published to IPFS.`)).toBeVisible()
  await page.getByLabel('Go-live date').fill('2020-01-01T00:00')
  await page.getByRole('button', { name: 'Launch Candy Machine' }).click()

  // Collection tx -> creation tx (with the first items) -> the rest in a
  // signAllTransactions batch -> recorded, which the backend only allows
  // once the chain says every item is loaded.
  await expect(page.getByText('Candy Machine created.')).toBeVisible({ timeout: 120_000 })

  await page.getByRole('link', { name: /\/mint\/buy\// }).click()
  await expect(page.getByText(`${ITEMS} of ${ITEMS} remaining`)).toBeVisible()
  await page.getByRole('button', { name: /^Mint for/ }).click()
  await expect(page.getByText('Minted!')).toBeVisible({ timeout: 30_000 })

  await page.goto('/mint')
  await expect(page.getByRole('row', { name: /E2E Big Drop/ })).toContainText(`1 / ${ITEMS}`)
})
