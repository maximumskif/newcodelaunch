import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import { Connection, PublicKey } from '@solana/web3.js'

import {
  FIXTURE_WALLET_PUBLIC_KEY as CREATOR_PUBLIC_KEY,
  fundFixtureWallet,
  TOKEN_METADATA_PROGRAM_ID,
  VALIDATOR_RPC_URL,
  waitForClonedPrograms,
} from './setup/solanaValidator'

const here = path.dirname(fileURLToPath(import.meta.url))

// 1x1 PNG — real image bytes the backend's Pillow check actually opens
// (solana_tokens._validate_logo), pinned through the local Pinata stub.
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

test.beforeAll(async () => {
  const connection = new Connection(VALIDATOR_RPC_URL, 'confirmed')
  await waitForClonedPrograms(connection, [TOKEN_METADATA_PROGRAM_ID])
  await fundFixtureWallet(connection)
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript({ path: path.join(here, '.generated', 'injectedSolanaWallet.bundle.js') })
})

test('a real SPL token launch: metadata pinned, wallet-signed, fixed supply — against a real local Solana validator', async ({
  page,
}) => {
  test.setTimeout(90_000)

  await page.goto('/tokens?chain=solana')

  // Same connect fallback as candy-machine.spec.ts: autoConnect usually has
  // the fake Phantom connected already.
  const connectButton = page.getByRole('button', { name: 'Connect Solana Wallet' })
  if (await connectButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await connectButton.click()
    await page.getByRole('button', { name: /Phantom/ }).click()
  }
  await page.getByRole('button', { name: /^Sign in with/ }).click()
  await expect(page.getByText(new RegExp(`SOLANA · ${CREATOR_PUBLIC_KEY.slice(0, 6)}`))).toBeVisible({ timeout: 15_000 })

  await page.getByLabel('Token name').fill('E2E Test Token')
  await page.getByLabel('Symbol').fill('e2et')
  await page.getByLabel('Initial supply (whole tokens)').fill('1,000,000')
  await page.getByLabel('Decimals').fill('6')
  await page.getByLabel(/^Description/).fill('Launched by the e2e suite')
  await page.locator('input[type="file"]').setInputFiles({
    name: 'logo.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_1X1_BASE64, 'base64'),
  })
  await expect(page.getByText('logo.png')).toBeVisible()

  await page.getByRole('button', { name: 'Launch token' }).click()

  // Real multipart upload -> real Pillow logo check -> logo + metadata JSON
  // pinned (Pinata stub) -> real Umi/Token Metadata transaction built by the
  // sidecar -> signed by the fixture's real keypair -> confirmed on the real
  // local validator -> independently re-verified by the backend (fee payer,
  // mint referenced, mint account read back) before it's recorded.
  const success = page.getByText(/E2E Test Token \(E2ET\) launched/)
  await expect(success).toBeVisible({ timeout: 45_000 })
  await expect(success).toContainText('1,000,000 tokens')

  // The history table is fed by GET /api/solana-tokens — i.e. it's what
  // the backend actually persisted, and its badge is what the backend read
  // from the chain, not what the form asked for.
  const historyRow = page.getByRole('row', { name: /E2E Test Token/ })
  await expect(historyRow).toContainText('Fixed')
  await expect(historyRow).not.toContainText('Freezable')

  const mintAddress = (await page.locator('p.font-mono').first().textContent())?.trim()
  expect(mintAddress).toMatch(/^[1-9A-HJ-NP-Za-km-z]{32,44}$/)

  // And check the chain directly, independent of anything the app reports.
  const connection = new Connection(VALIDATOR_RPC_URL, 'confirmed')
  const mint = new PublicKey(mintAddress!)
  const mintInfo = (await connection.getParsedAccountInfo(mint)).value
  const parsed = (mintInfo?.data as { parsed: { info: Record<string, unknown> } }).parsed.info
  expect(parsed.decimals).toBe(6)
  expect(parsed.supply).toBe('1000000000000')
  expect(parsed.mintAuthority).toBeNull()
  expect(parsed.freezeAuthority).toBeNull()

  const holdings = await connection.getParsedTokenAccountsByOwner(new PublicKey(CREATOR_PUBLIC_KEY), { mint })
  expect(holdings.value[0].account.data.parsed.info.tokenAmount.uiAmountString).toBe('1000000')

  // Token Metadata account (PDA of ["metadata", program, mint]) exists and
  // is owned by the real Token Metadata program.
  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  )
  const metadataAccount = await connection.getAccountInfo(metadataPda)
  expect(metadataAccount?.owner.toBase58()).toBe(TOKEN_METADATA_PROGRAM_ID.toBase58())
  expect(metadataAccount?.data.includes(Buffer.from('E2E Test Token'))).toBe(true)
})
