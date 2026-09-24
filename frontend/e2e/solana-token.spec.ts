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

  // Start from the project wizard: a Token project on Solana should land on
  // the Launchpad's Solana tab, and the launch should link back to it.
  await page.goto('/projects/new')

  // Same connect fallback as candy-machine.spec.ts: autoConnect usually has
  // the fake Phantom connected already.
  const connectButton = page.getByRole('button', { name: 'Connect Solana Wallet' })
  if (await connectButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await connectButton.click()
    await page.getByRole('button', { name: /Phantom/ }).click()
  }
  await page.getByRole('button', { name: /^Sign in with/ }).click()
  await expect(page.getByText(new RegExp(`SOLANA · ${CREATOR_PUBLIC_KEY.slice(0, 6)}`))).toBeVisible({ timeout: 15_000 })

  await page.getByText('Token', { exact: true }).click()
  await page.getByRole('button', { name: 'Solana', exact: true }).click()
  await page.getByPlaceholder('My token').fill('E2E SPL Project')
  await page.getByRole('button', { name: 'Create draft and continue' }).click()
  await expect(page).toHaveURL(/\/tokens\?project=[^&]+&chain=solana/)
  await expect(page.getByText('E2E SPL Project')).toBeVisible()

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
  expect(mintInfo).not.toBeNull()
  const parsed = (mintInfo!.data as { parsed: { info: Record<string, unknown> } }).parsed.info
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

  // The project it was launched from is now linked to it.
  await page.goto('/dashboard')
  const card = page.locator('li, article, div').filter({ hasText: 'E2E SPL Project' }).filter({ hasText: 'E2ET' }).last()
  await expect(card).toContainText(`E2ET · ${mintAddress!.slice(0, 10)}`)
})

test('owner tools on a token that kept its authorities: mint more, revoke freeze and mint, then rename and lock its metadata — each checked on-chain', async ({ page }) => {
  test.setTimeout(90_000)
  const connection = new Connection(VALIDATOR_RPC_URL, 'confirmed')
  const readMint = async (mint: PublicKey) =>
    ((await connection.getParsedAccountInfo(mint)).value!.data as { parsed: { info: Record<string, unknown> } }).parsed.info

  await page.goto('/tokens?chain=solana')
  const connectButton = page.getByRole('button', { name: 'Connect Solana Wallet' })
  if (await connectButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await connectButton.click()
    await page.getByRole('button', { name: /Phantom/ }).click()
  }
  await page.getByRole('button', { name: /^Sign in with/ }).click()
  await expect(page.getByText(new RegExp(`SOLANA · ${CREATOR_PUBLIC_KEY.slice(0, 6)}`))).toBeVisible({ timeout: 15_000 })

  // Launch keeping both authorities (both boxes unticked).
  await page.getByLabel('Token name').fill('Keeper Token')
  await page.getByLabel('Symbol').fill('KEEP')
  await page.getByLabel('Initial supply (whole tokens)').fill('1000')
  await page.getByLabel('Decimals').fill('2')
  await page.getByLabel(/Fixed supply/).uncheck()
  await page.getByLabel(/Revoke freeze authority/).uncheck()
  await page.getByRole('button', { name: 'Launch token' }).click()
  await expect(page.getByText(/Keeper Token \(KEEP\) launched/)).toBeVisible({ timeout: 45_000 })
  const mint = new PublicKey((await page.locator('p.font-mono').first().textContent())!.trim())

  // .first(): once Manage is open, the expanded panel's row mentions the
  // token too; the token's own row always comes first.
  const row = page.getByRole('row', { name: /Keeper Token/ }).first()
  await expect(row).toContainText('Mintable')
  await row.getByRole('button', { name: 'Manage KEEP' }).click()
  const panel = page.getByTestId('token-manage')

  // Mint 500 more — signed by the fixture wallet (the mint authority).
  await panel.getByLabel(/Mint more/).fill('500')
  await panel.getByRole('button', { name: 'Mint' }).click()
  await expect(panel.getByText('Minted.')).toBeVisible({ timeout: 30_000 })
  expect((await readMint(mint)).supply).toBe('150000')
  await expect(panel).toContainText('1,500')

  // Revoke freeze, then fix the supply — each behind a confirmation.
  await panel.getByRole('button', { name: 'Revoke freeze authority…' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke freeze authority' }).click()
  await expect(panel.getByText('Freeze authority revoked.')).toBeVisible({ timeout: 30_000 })
  expect((await readMint(mint)).freezeAuthority).toBeNull()

  await panel.getByRole('button', { name: 'Fix supply…' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Revoke mint authority' }).click()
  await expect(panel.getByText('Supply is now fixed.')).toBeVisible({ timeout: 30_000 })
  expect((await readMint(mint)).mintAuthority).toBeNull()

  // The history row reflects what the backend re-read from the chain.
  await expect(row).toContainText('Fixed')
  await expect(row).not.toContainText('Freezable')
  await expect(row).toContainText('1,500')

  // Details: rename it and add a description (re-pinned through the Pinata
  // stub), then lock the metadata — each signed by the update authority.
  const details = panel.getByTestId('token-details')
  await details.getByLabel('Name').fill('Keeper Renamed')
  await details.getByLabel('Description').fill('Now with a description')
  await details.getByRole('button', { name: 'Save details' }).click()
  await expect(details.getByText('Details updated.')).toBeVisible({ timeout: 30_000 })

  const [metadataPda] = PublicKey.findProgramAddressSync(
    [Buffer.from('metadata'), TOKEN_METADATA_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    TOKEN_METADATA_PROGRAM_ID,
  )
  const metadataAccount = await connection.getAccountInfo(metadataPda)
  expect(metadataAccount?.data.includes(Buffer.from('Keeper Renamed'))).toBe(true)
  await expect(page.getByRole('row', { name: /Keeper Renamed/ }).first()).toBeVisible()
  await expect(details.getByLabel('Description')).toHaveValue('Now with a description')

  await details.getByRole('button', { name: 'Lock metadata…' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Lock metadata' }).click()
  await expect(details.getByText(/Metadata is locked/)).toBeVisible({ timeout: 30_000 })
  const token = await page.evaluate(() => JSON.parse(localStorage.getItem('nocode-launchpad.auth') ?? '{}').accessToken as string)
  const launches = await (await page.request.get('http://localhost:5000/api/solana-tokens', { headers: { Authorization: `Bearer ${token}` } })).json()
  const launchId = launches.tokens.find((t: { mint_address: string }) => t.mint_address === mint.toBase58()).id
  const onChain = await (
    await page.request.get(`http://localhost:5000/api/solana-tokens/${launchId}/metadata`, { headers: { Authorization: `Bearer ${token}` } })
  ).json()
  expect(onChain.is_mutable).toBe(false)
  await expect(page.getByRole('row', { name: /Keeper Renamed/ }).first()).toContainText('Locked')
})
