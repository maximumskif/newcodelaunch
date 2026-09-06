import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'

const here = path.dirname(fileURLToPath(import.meta.url))

// Matches e2e/fixtures/injectedSolanaWallet.ts's hardcoded keypair.
const CREATOR_PUBLIC_KEY = 'FoEsHYn3QLcBMae9YmkYC57ogWamP7zUqKNeuBgh6VwG'

const API_BASE_URL = 'http://localhost:5000/api'
const VALIDATOR_RPC_URL = 'http://127.0.0.1:8899'

const AUTH_STORAGE_KEY = 'nocode-launchpad.auth'

// Smallest possible valid PNG — a 1x1 transparent pixel. Real image bytes
// PIL actually opens/composites/resizes server-side (nft_compositing.py),
// not a placeholder string.
const PNG_1X1_BASE64 =
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='

const CORE_PROGRAM_ID = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d')
const CORE_CANDY_MACHINE_PROGRAM_ID = new PublicKey('CMACYFENjoBMHzapRXyo1JZkVS6EtaDDzkjMrmQLvr4J')
// The Candy Machine's create() call wires in a Core Candy Guard account
// under the hood for its solPayment/startDate guards, even though this
// app's own code never references this program id directly — see
// run-solana-validator.sh's comment for how this one was found (decoding a
// failing transaction's account keys after the other two programs alone
// weren't enough).
const CORE_CANDY_GUARD_PROGRAM_ID = new PublicKey('CMAGAKJ67e9hRZgfC5SFTbZH8MgEmtqazKXjmkaJjWTJ')

// Playwright's webServer `port: 8899` readiness check (playwright.config.ts)
// only confirms solana-test-validator's RPC port is accepting connections —
// not that its `--clone-upgradeable-program` step (fetching these programs'
// real bytecode from devnet, see run-solana-validator.sh) has actually
// finished. The port opens before that completes, so without this, tests
// can start against a validator whose cloned programs aren't loaded yet,
// failing on-chain with "Program is not deployed" for what looks like a
// real bug but is really a startup race. Poll until all three are
// genuinely ready.
async function waitForClonedPrograms(connection: Connection) {
  const deadline = Date.now() + 60_000
  for (const programId of [CORE_PROGRAM_ID, CORE_CANDY_MACHINE_PROGRAM_ID, CORE_CANDY_GUARD_PROGRAM_ID]) {
    for (;;) {
      const info = await connection.getAccountInfo(programId)
      if (info?.executable) break
      if (Date.now() > deadline) throw new Error(`Cloned program ${programId.toBase58()} never became ready`)
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
}

test.beforeAll(async () => {
  const connection = new Connection(VALIDATOR_RPC_URL, 'confirmed')
  await waitForClonedPrograms(connection)

  // solana-test-validator starts empty, unlike anvil, which pre-funds
  // default accounts — fund the fixture's real keypair once here.
  const signature = await connection.requestAirdrop(new PublicKey(CREATOR_PUBLIC_KEY), 10 * LAMPORTS_PER_SOL)
  await connection.confirmTransaction(signature, 'confirmed')
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript({ path: path.join(here, '.generated', 'injectedSolanaWallet.bundle.js') })
})

test('a real Candy Machine launch and public mint — against a real local Solana validator', async ({ page, request }) => {
  // Well past Playwright's 30s default: two real on-chain launch
  // transactions plus a measured ~15s real propagation wait on the public
  // storefront's status read (see the reload-loop comment below) before
  // the mint step even starts.
  test.setTimeout(120_000)

  await page.goto('/nft')

  // WalletProvider's `autoConnect` (see solanaWallets.tsx) should already
  // have this connected by the time the page settles, since the fake
  // wallet's readyState is Installed before React ever mounts. Fall back to
  // clicking through the wallet-selection modal in case it didn't.
  const connectButton = page.getByRole('button', { name: 'Connect Solana Wallet' })
  if (await connectButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await connectButton.click()
    // The wallet-selection modal's button combines the wallet name with a
    // "Detected" badge into one accessible name (e.g. "Phantom icon Phantom
    // Detected") — match by role + partial name rather than exact text.
    await page.getByRole('button', { name: /Phantom/ }).click()
  }

  await page.getByRole('button', { name: /^Sign in with/ }).click()

  // Real nonce -> real ed25519 signMessage (tweetnacl, against the fixture's
  // real keypair) -> real backend signature verification
  // (backend/app/services/auth.py's Solana branch, PyNaCl) — this badge
  // only renders once /api/auth/verify actually accepted it.
  await expect(page.getByText(new RegExp(`SOLANA · ${CREATOR_PUBLIC_KEY.slice(0, 6)}`))).toBeVisible({
    timeout: 15_000,
  })

  const accessToken = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw).accessToken as string) : null
  }, AUTH_STORAGE_KEY)
  expect(accessToken).toBeTruthy()
  const authHeaders = { Authorization: `Bearer ${accessToken}` }

  // Seed the collection/layer/trait/generated-item/publish steps via the
  // real backend API directly. None of this involves wallet signing or
  // on-chain activity — it's the same real PIL compositing, real DB
  // records, and (via the local stub) real HTTP calls that a browser
  // clicking through the NFT Generator's own multi-step UI would produce,
  // just without re-driving that UI here (already covered by its own
  // component tests). What actually needs a real browser is the
  // wallet-signing step below.
  const collectionRes = await request.post(`${API_BASE_URL}/nft/collections`, {
    headers: authHeaders,
    data: { name: 'E2E Candy Collection', description: 'Seeded by the e2e suite' },
  })
  expect(collectionRes.ok()).toBe(true)
  const { collection } = await collectionRes.json()

  const layerRes = await request.post(`${API_BASE_URL}/nft/collections/${collection.id}/layers`, {
    headers: authHeaders,
    data: { name: 'Background' },
  })
  expect(layerRes.ok()).toBe(true)
  const { layer } = await layerRes.json()

  const traitRes = await request.post(`${API_BASE_URL}/nft/layers/${layer.id}/traits`, {
    headers: authHeaders,
    multipart: {
      name: 'Blue',
      rarity_weight: '50',
      image: { name: 'blue.png', mimeType: 'image/png', buffer: Buffer.from(PNG_1X1_BASE64, 'base64') },
    },
  })
  expect(traitRes.ok()).toBe(true)

  const generateRes = await request.post(`${API_BASE_URL}/nft/collections/${collection.id}/generate`, {
    headers: authHeaders,
    data: { count: 1 },
  })
  expect(generateRes.ok()).toBe(true)
  const { items } = await generateRes.json()

  const publishRes = await request.post(`${API_BASE_URL}/nft/items/${items[0].id}/publish`, {
    headers: authHeaders,
  })
  // Real Pinata-shaped response from the local stub (e2e/setup/pinata_stub.py)
  // — a fake IpfsHash, but a real HTTP round trip through the real
  // ipfs.py code path, not a mocked function return.
  expect(publishRes.ok()).toBe(true)

  // The real wallet-signing part: launch the Candy Machine through the
  // actual UI. Real ephemeral-signer transactions from the sidecar, real
  // signatures from the fixture's keypair, real on-chain confirmation
  // against the local validator, real backend re-verification before
  // recording (candy_machine.record_candy_machine).
  await page.goto(`/mint?collection=${collection.id}`)

  const goLiveInput = page.getByLabel('Go-live date')
  // A go-live date already in the past — the public storefront step below
  // needs is_live to be true immediately, not after some future opening time.
  await goLiveInput.fill('2020-01-01T00:00')

  await page.getByRole('button', { name: 'Launch Candy Machine' }).click()

  await expect(page.getByText('Candy Machine created.')).toBeVisible({ timeout: 30_000 })

  // Mint from the public storefront this just linked to — a different
  // visitor's flow (no account, no auth), reusing the same wallet here
  // purely for simplicity (nothing stops a creator from also minting their
  // own drop). Real prepare -> real sign+send -> real on-chain confirmation.
  await page.getByRole('link', { name: /\/mint\/buy\// }).click()
  await expect(page).toHaveURL(/\/mint\/buy\//)

  // MintBuyPage.tsx only fetches status once on mount, with no client-side
  // retry — measured directly (a plain Node script polling this exact
  // endpoint every second, no browser involved) that a brand-new Candy
  // Machine account can take up to ~15s before a *fresh* RPC connection
  // resolves it, even at "confirmed" commitment. An ordinary propagation
  // characteristic of a bare single-node validator, not a bug — the
  // project's own real-devnet Candy Machine work hit the identical
  // "transient false alarm ... resolved on retry" case for this exact
  // route (see docs/REBUILD_PROGRESS.md). Poll via reload, matching what a
  // real visitor would do on seeing "drop not found" moments after a fresh link.
  for (let attempt = 0; !(await page.getByText('Live now').isVisible()) && attempt < 8; attempt++) {
    await page.waitForTimeout(3_000)
    await page.reload()
  }
  await expect(page.getByText('Live now')).toBeVisible({ timeout: 5_000 })
  await page.getByRole('button', { name: /^Mint for/ }).click()

  await expect(page.getByText('Minted!')).toBeVisible({ timeout: 30_000 })
})
