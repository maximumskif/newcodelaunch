import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))

// Smallest possible valid PNG — a 1x1 transparent pixel. Real image bytes
// PIL actually opens/composites/resizes server-side (nft_compositing.py),
// not a placeholder string. Same bytes candy-machine.spec.ts already proved
// work end-to-end through this exact upload -> generate -> publish pipeline
// via direct API calls — this spec drives the identical pipeline through the
// browser instead.
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __E2E_ANVIL_RPC_URL__: string }).__E2E_ANVIL_RPC_URL__ = 'http://127.0.0.1:8545'
  })
  await page.addInitScript({ path: path.join(here, '.generated', 'injectedEvmWallet.bundle.js') })
})

test('a real NFT collection build: create, upload a trait, generate, and publish to IPFS — through the actual upload UI', async ({
  page,
}) => {
  // Only the wallet-signing step (auth) is faked at the key level, same as
  // token-deploy.spec.ts — everything else here (collection/layer/trait
  // creation, real PIL compositing, real IPFS-shaped publish through the
  // local Pinata stub) is the real backend, driven through the real
  // multi-step upload UI this project's own docs flagged as only having
  // component-level coverage before this (LayerCard.test.tsx etc.), never a
  // full click-through.
  await page.goto('/nft')

  await page.getByRole('button', { name: 'Connect EVM Wallet' }).click()
  await page.getByRole('button', { name: /^Sign in with/ }).click()
  await expect(page.getByText(/EVM · 0xf39f/i)).toBeVisible({ timeout: 15_000 })

  // Create a collection via CollectionSidebar's inline form.
  await page.getByRole('button', { name: 'New collection' }).click()
  await page.getByLabel('Collection name').fill('E2E Upload Collection')
  await page.getByRole('button', { name: 'Create' }).click()

  // Add a layer via LayerEditor.
  await page.getByLabel('New layer name').fill('Background')
  await page.getByRole('button', { name: 'Add layer' }).click()

  // LayerCard opens its upload form automatically for a brand-new,
  // trait-less layer — attach the real PNG bytes to the Dropzone's
  // underlying <input type="file">. setInputFiles works on a hidden file
  // input; only one exists on the page at this point (one layer, one
  // upload form open).
  await page.locator('input[type="file"]').setInputFiles({
    name: 'blue.png',
    mimeType: 'image/png',
    buffer: Buffer.from(PNG_1X1_BASE64, 'base64'),
  })
  await page.getByLabel('Trait name').fill('Blue')
  // exact:true — LayerEditor's own "Add layer" button also matches a plain
  // substring search for "Add".
  await page.getByRole('button', { name: 'Add', exact: true }).click()

  // The trait thumbnail rendering is nft_generation's real upload + PIL
  // round trip, not a client-side preview standing in for it.
  await expect(page.getByAltText('Blue')).toBeVisible({ timeout: 10_000 })

  // Generate — with one layer and one trait, ready() is true and the max
  // possible combinations is 1, so generating 1 item is the whole space.
  await page.getByLabel('Number of items to generate').fill('1')
  await page.getByRole('button', { name: 'Generate' }).click()

  const publishButton = page.getByRole('button', { name: 'Publish' })
  await expect(publishButton).toBeVisible({ timeout: 15_000 })
  await publishButton.click()

  // Real HTTP round trip through the real ipfs.py code path to the local
  // Pinata stub (frontend/e2e/setup/pinata_stub.py) — this link only
  // renders once the backend actually recorded an IpfsHash for the item.
  await expect(page.getByRole('link', { name: /IPFS/ })).toBeVisible({ timeout: 15_000 })

  // Confirm the metadata preview reflects the real published state, not a
  // stale pre-publish placeholder.
  await page.getByRole('button', { name: 'Preview metadata' }).click()
  await expect(page.getByText('Real content pinned to IPFS.')).toBeVisible({ timeout: 10_000 })
})
