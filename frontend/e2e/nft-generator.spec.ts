import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test, type Page } from '@playwright/test'

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

// Only the wallet-signing step (auth) is faked at the key level, same as
// token-deploy.spec.ts — everything downstream is the real backend.
async function signIn(page: Page) {
  await page.goto('/nft')
  await page.getByRole('button', { name: 'Connect EVM Wallet' }).click()
  await page.getByRole('button', { name: /^Sign in with/ }).click()
  await expect(page.getByText(/EVM · 0xf39f/i)).toBeVisible({ timeout: 15_000 })
}

// Shared by the edit/generate tests below: sign in, create a collection
// with one layer and one uploaded trait, through the real UI.
async function buildCollectionWithOneTrait(page: Page, collectionName: string) {
  await signIn(page)

  // Create a collection via CollectionSidebar's inline form.
  await page.getByRole('button', { name: 'New collection' }).click()
  await page.getByLabel('Collection name').fill(collectionName)
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
}

test('a real NFT collection build: create, upload a trait, generate, and publish to IPFS — through the actual upload UI', async ({
  page,
}) => {
  await buildCollectionWithOneTrait(page, 'E2E Upload Collection')

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

test('editing and deleting real traits, layers, and collections — through the actual UI', async ({ page }) => {
  await buildCollectionWithOneTrait(page, 'E2E Edit-Delete Collection')

  // Trait rename/reweight: click the thumbnail to open the edit panel (a
  // real PATCH /api/nft/traits/<id>), save, and confirm the grid re-renders
  // with the new name — not just that the request succeeded.
  await page.getByAltText('Blue').click()
  const traitNameInput = page.getByLabel('Edit trait name')
  await traitNameInput.fill('Sky Blue')
  await page.getByRole('button', { name: 'Save' }).click()
  await expect(page.getByAltText('Sky Blue')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByAltText('Blue', { exact: true })).not.toBeVisible()

  // Trait delete: a real DELETE that removes both the DB row and the
  // uploaded file server-side (nft_collections.delete_trait) — the grid
  // goes empty.
  await page.getByAltText('Sky Blue').click()
  await page.getByLabel('Delete trait').click()
  await expect(page.getByAltText('Sky Blue')).not.toBeVisible({ timeout: 10_000 })

  // Layer rename: click-to-edit in the layer header.
  await page.getByTitle('Click to rename').click()
  // exact:true — "New layer name" (LayerEditor's own add-layer input) is
  // also a substring match for "Layer name" otherwise.
  const layerNameInput = page.getByLabel('Layer name', { exact: true })
  await layerNameInput.fill('Backdrop')
  await layerNameInput.press('Enter')
  await expect(page.getByTitle('Click to rename')).toHaveText('Backdrop')

  // Layer delete requires confirmation — cascades to its (already-deleted)
  // traits and removes the layer's own upload directory server-side.
  await page.getByLabel('Delete layer').click()
  await expect(page.getByText('Delete layer "Backdrop"?')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete layer' }).click()
  await expect(page.getByText('No layers yet.')).toBeVisible({ timeout: 10_000 })

  // Collection delete, from the sidebar — cascades to everything else (no
  // layers left here, but the real endpoint also cleans up the collection's
  // whole upload directory tree regardless).
  await page.getByLabel('Delete collection E2E Edit-Delete Collection').click()
  await expect(page.getByText('Delete collection "E2E Edit-Delete Collection"?')).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Delete collection' }).click()
  // Scoped to the sidebar's own select-button (exact match) — a bare text
  // search for the collection name also transiently matches the confirm
  // dialog's own closing heading ('Delete collection "...Collection"?'),
  // which contains the same name as a substring.
  await expect(page.getByRole('button', { name: 'E2E Edit-Delete Collection', exact: true })).not.toBeVisible({
    timeout: 10_000,
  })
})

test('bulk trait analysis: a real batch CV analysis round trip, no collection required', async ({ page }) => {
  // Deliberately doesn't create a collection first — this tool is
  // collection-independent (POST /nft/analyze/batch takes only images), and
  // this proves that's really true, not just true in the type signature.
  await signIn(page)

  await page.getByRole('button', { name: 'Show bulk trait analysis (AI)' }).click()

  await page.locator('input[type="file"]').setInputFiles([
    { name: 'blue.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1X1_BASE64, 'base64') },
    { name: 'blue2.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1X1_BASE64, 'base64') },
  ])
  await page.getByRole('button', { name: 'Analyze 2 images' }).click()

  // Real ai_traits.analyze_single_image runs (color/composition/technical
  // CV analysis on real pixel data) for both images with no OpenAI key
  // configured in this e2e environment — proving the batch endpoint works
  // standalone, without requiring the optional AI-vision pass.
  await expect(page.getByText('2 images analyzed')).toBeVisible({ timeout: 10_000 })
  await expect(page.getByText('blue.png')).toBeVisible()
  await expect(page.getByText('blue2.png')).toBeVisible()
  // Both images are identical 1x1 transparent pixels, so the real diversity
  // math over that trait_frequency correctly finds zero diversity.
  await expect(page.getByText('Diversity score: 0.00')).toBeVisible()
})
