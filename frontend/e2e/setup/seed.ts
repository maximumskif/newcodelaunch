import { expect, type APIRequestContext } from '@playwright/test'

export const API_BASE_URL = 'http://localhost:5000/api'
export const AUTH_STORAGE_KEY = 'nocode-launchpad.auth'

// Distinct 1x1 PNGs — one trait each, so N traits in one layer give exactly
// N unique generated items.
const TRAIT_PNGS: [string, string][] = [
  ['Blue', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII='],
  ['Red', 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg=='],
]

async function waitForGenerationJob(request: APIRequestContext, headers: Record<string, string>, jobId: string) {
  const deadline = Date.now() + 30_000
  for (;;) {
    const { job } = await (await request.get(`${API_BASE_URL}/nft/generation-jobs/${jobId}`, { headers })).json()
    if (job.status === 'done') return
    if (job.status === 'failed') throw new Error(`Generation job failed: ${job.error}`)
    if (Date.now() > deadline) throw new Error(`Generation job ${jobId} never finished`)
    await new Promise((resolve) => setTimeout(resolve, 200))
  }
}

// A collection with `count` (1-2) generated items, all published to IPFS
// (the Pinata stub), seeded through the real backend API — the NFT
// Generator's own upload UI is covered by nft-generator.spec.ts.
export async function seedPublishedCollection(
  request: APIRequestContext,
  headers: Record<string, string>,
  name: string,
  count: 1 | 2,
) {
  const { collection } = await (
    await request.post(`${API_BASE_URL}/nft/collections`, { headers, data: { name, description: 'Seeded by the e2e suite' } })
  ).json()
  const { layer } = await (
    await request.post(`${API_BASE_URL}/nft/collections/${collection.id}/layers`, { headers, data: { name: 'Fur' } })
  ).json()
  for (const [traitName, png] of TRAIT_PNGS.slice(0, count)) {
    const traitRes = await request.post(`${API_BASE_URL}/nft/layers/${layer.id}/traits`, {
      headers,
      multipart: {
        name: traitName,
        rarity_weight: '50',
        image: { name: `${traitName}.png`, mimeType: 'image/png', buffer: Buffer.from(png, 'base64') },
      },
    })
    expect(traitRes.ok()).toBe(true)
  }
  const generateRes = await request.post(`${API_BASE_URL}/nft/collections/${collection.id}/generate`, { headers, data: { count } })
  expect(generateRes.status()).toBe(202)
  await waitForGenerationJob(request, headers, (await generateRes.json()).job.id)

  const { items } = await (await request.get(`${API_BASE_URL}/nft/collections/${collection.id}/items`, { headers })).json()
  expect(items).toHaveLength(count)
  for (const item of items) {
    expect((await request.post(`${API_BASE_URL}/nft/items/${item.id}/publish`, { headers })).ok()).toBe(true)
  }
  const published = (await (await request.get(`${API_BASE_URL}/nft/collections/${collection.id}/items`, { headers })).json()).items
  published.sort((a: { token_index: number }, b: { token_index: number }) => a.token_index - b.token_index)
  return { collection, items: published as { id: string; ipfs_image_hash: string; attributes: unknown[] }[] }
}
