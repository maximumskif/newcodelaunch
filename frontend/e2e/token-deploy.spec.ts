import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))

test.beforeEach(async ({ page }) => {
  // Order matters: this constant must be set before the wallet bundle's
  // IIFE runs (see fixtures/injectedEvmWallet.ts) — addInitScript scripts
  // execute in the order they were added, each before any page script.
  await page.addInitScript(() => {
    ;(window as unknown as { __E2E_ANVIL_RPC_URL__: string }).__E2E_ANVIL_RPC_URL__ = 'http://127.0.0.1:8545'
  })
  await page.addInitScript({ path: path.join(here, '.generated', 'injectedEvmWallet.bundle.js') })
})

test('a real token deploy: connect, sign in, compile, estimate, deploy, and record — against a real local chain', async ({
  page,
}) => {
  // The one thing not real here is the wallet UI a human would click through
  // in a browser extension — everything downstream of "wallet approves" is
  // the actual app talking to an actual (local, throwaway) chain and an
  // actual backend. See e2e/README.md.
  await page.goto('/tokens')

  await page.getByRole('button', { name: 'Connect EVM Wallet' }).click()
  await page.getByRole('button', { name: /^Sign in with/ }).click()

  // Real nonce -> real personal_sign (against the anvil default account) ->
  // real backend signature verification (backend/app/services/auth.py) —
  // this badge only renders once /api/auth/verify actually accepted it.
  // Case-insensitive: auth.normalize_address lowercases EVM addresses
  // server-side before returning them, so the badge reads "0xf39f...", not
  // the checksummed "0xf39F..." the address is more commonly displayed as.
  await expect(page.getByText(/EVM · 0xf39f/i)).toBeVisible({ timeout: 15_000 })

  // erc20_basic is pre-selected (first template the page fetches) — fill
  // its required deployment params.
  await page.getByLabel(/^TOKEN_NAME/).fill('E2ETestToken')
  await page.getByLabel(/^TOKEN_SYMBOL/).fill('E2E')
  await page.getByLabel(/^TOKEN_SUPPLY/).fill('1000000')

  await page.getByRole('button', { name: 'Estimate cost' }).click()
  // A real gas estimate from a real py-solc-x compile against a real chain,
  // not a canned number.
  await expect(page.getByText(/gas at .* gwei/)).toBeVisible({ timeout: 20_000 })

  await page.getByRole('button', { name: 'Deploy' }).click()

  // The full real pipeline this hook's own code comment flagged as
  // never-smoke-tested (see useDeployTemplate.ts): compile -> sign+
  // broadcast via the fake wallet's real key -> wagmi polls the real anvil
  // chain for a receipt -> the backend independently re-verifies the
  // transaction on-chain before persisting it (contracts.record_deployment)
  // -> the UI shows the address it actually recorded.
  const deployedText = page.getByText(/Deployed at/)
  await expect(deployedText).toBeVisible({ timeout: 30_000 })
  await expect(deployedText).toContainText(/0x[a-fA-F0-9]{40}/)
})
