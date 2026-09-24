import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

import { API_BASE_URL, AUTH_STORAGE_KEY } from './setup/seed'
import { FIXTURE_WALLET_PUBLIC_KEY as SOLANA_WALLET } from './setup/solanaValidator'

const here = path.dirname(fileURLToPath(import.meta.url))

test.beforeEach(async ({ page }) => {
  // Both fixture wallets at once: an EVM one (injected EIP-1193) and a
  // Phantom-shaped Solana one — the same page, like a user with both
  // MetaMask and Phantom installed.
  await page.addInitScript(() => {
    ;(window as unknown as { __E2E_ANVIL_RPC_URL__: string }).__E2E_ANVIL_RPC_URL__ = 'http://127.0.0.1:8545'
  })
  await page.addInitScript({ path: path.join(here, '.generated', 'injectedEvmWallet.bundle.js') })
  await page.addInitScript({ path: path.join(here, '.generated', 'injectedSolanaWallet.bundle.js') })
})

const accessToken = (page: Page) =>
  page.evaluate((key) => JSON.parse(localStorage.getItem(key) ?? '{}').accessToken as string, AUTH_STORAGE_KEY)

async function ensureSolanaConnected(page: Page) {
  const connect = page.getByRole('button', { name: /Connect (a )?Solana [Ww]allet/ })
  if (await connect.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await connect.click()
    await page.getByRole('button', { name: /Phantom/ }).click()
  }
}

async function signOut(page: Page) {
  await page.getByRole('button', { name: /(EVM|SOLANA) · / }).click()
  await page.getByRole('button', { name: 'Disconnect' }).click()
  // Disconnecting the Solana adapter is async: its button reads "Sign in
  // with…" for a moment before flipping to "Connect Solana Wallet". Wait for
  // the settled state, or the next connect check races it.
  await expect(page.getByRole('button', { name: 'Connect Solana Wallet' })).toBeVisible()
}

test('one account across both chains: a Solana account merges into an EVM one by linking, and either wallet signs in to it', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000)
  await page.goto('/dashboard')

  // 1. The Solana wallet has an account of its own, with a project in it.
  await ensureSolanaConnected(page)
  await page.getByRole('button', { name: /^Sign in with FoEsHY/ }).click()
  await expect(page.getByText(/SOLANA · FoEsHY/)).toBeVisible({ timeout: 15_000 })
  const created = await request.post(`${API_BASE_URL}/projects`, {
    headers: { Authorization: `Bearer ${await accessToken(page)}` },
    data: { name: 'Made with Phantom', project_type: 'token', chain: 'solana', network: 'solana_devnet' },
  })
  expect(created.ok()).toBe(true)
  await signOut(page)

  // 2. Sign in with the EVM wallet — a different account, which can't see it.
  await page.getByRole('button', { name: 'Connect EVM Wallet' }).click()
  await page.getByRole('button', { name: /^Sign in with 0x/ }).click()
  await expect(page.getByText(/EVM · 0xf39f/i)).toBeVisible({ timeout: 15_000 })
  await page.reload()
  await expect(page.getByText('Made with Phantom')).toHaveCount(0)

  // 3. Link the Solana wallet from the account menu (a real ed25519
  //    signature over a fresh nonce) — its account merges into this one.
  await page.getByRole('button', { name: /EVM · 0xf39f/i }).click()
  await ensureSolanaConnected(page)
  if (!(await page.getByText('Linked wallets').isVisible().catch(() => false))) {
    await page.getByRole('button', { name: /EVM · 0xf39f/i }).click()
  }
  await page.getByRole('button', { name: /Link Solana wallet FoEs/ }).click()
  await expect(page.getByText(/1 item from that wallet's account moved into this one/)).toBeVisible({ timeout: 15_000 })
  await expect(page.getByRole('button', { name: `Unlink solana wallet ${SOLANA_WALLET}` })).toBeVisible()

  await page.reload()
  await expect(page.getByText('Made with Phantom')).toBeVisible()

  // 4. Signing in with the Solana wallet now opens the same account.
  const evmToken = await accessToken(page)
  const evmAccountId = (await (await request.get(`${API_BASE_URL}/auth/me`, { headers: { Authorization: `Bearer ${evmToken}` } })).json()).user.id
  await signOut(page)
  await ensureSolanaConnected(page)
  await page.getByRole('button', { name: /^Sign in with FoEsHY/ }).click()
  await expect(page.getByText(/SOLANA · FoEsHY/)).toBeVisible({ timeout: 15_000 })
  const solanaMe = (await (await request.get(`${API_BASE_URL}/auth/me`, { headers: { Authorization: `Bearer ${await accessToken(page)}` } })).json()).user
  expect(solanaMe.id).toBe(evmAccountId)
  await expect(page.getByText('Made with Phantom')).toBeVisible()

  // Leave the shared fixture wallets as other specs expect them: separate
  // accounts again (unlinking from the EVM session; the moved project stays
  // with the account that now owns it).
  const unlinked = await request.delete(`${API_BASE_URL}/auth/wallets/solana/${SOLANA_WALLET}`, {
    headers: { Authorization: `Bearer ${evmToken}` },
  })
  expect(unlinked.ok()).toBe(true)
})
