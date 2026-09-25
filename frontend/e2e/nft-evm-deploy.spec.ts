import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import { createPublicClient, createWalletClient, defineChain, http, parseAbi, parseEther, type Address } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

import { expectNoA11yViolations } from './setup/axe'
import { AUTH_STORAGE_KEY, seedPublishedCollection } from './setup/seed'

const here = path.dirname(fileURLToPath(import.meta.url))

const ANVIL_RPC_URL = 'http://127.0.0.1:8545'
// The Pinata stub's gateway (run-backend.sh's PINATA_GATEWAY_URL).
const IPFS_GATEWAY = 'http://127.0.0.1:5555/ipfs/'

// anvil's default account #0 is the injected wallet (fixtures/injectedEvmWallet.ts);
// #1 plays a separate buyer who mints once public minting is on.
const CREATOR_ADDRESS: Address = '0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266'
const BUYER_PRIVATE_KEY = '0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d'

// run-anvil.sh runs anvil with Sepolia's chain id, so the app's real config needs no changes.
const anvil = defineChain({
  id: 11155111,
  name: 'anvil (as Sepolia)',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC_URL] } },
})

const ERC721_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function owner() view returns (address)',
  'function maxSupply() view returns (uint256)',
  'function mintPrice() view returns (uint256)',
  'function baseURI() view returns (string)',
  'function mintingEnabled() view returns (bool)',
  'function mint(address to, uint256 quantity) payable',
  'function ownerOf(uint256 tokenId) view returns (address)',
  'function tokenURI(uint256 tokenId) view returns (string)',
])

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __E2E_ANVIL_RPC_URL__: string }).__E2E_ANVIL_RPC_URL__ = 'http://127.0.0.1:8545'
  })
  await page.addInitScript({ path: path.join(here, '.generated', 'injectedEvmWallet.bundle.js') })
})

test('a real ERC-721 deploy of a generated collection: metadata folder pinned, deployed, minting enabled, tokenURI resolves', async ({
  page,
  request,
}) => {
  test.setTimeout(90_000)

  await page.goto('/nft')
  await page.getByRole('button', { name: 'Connect EVM Wallet' }).click()
  await page.getByRole('button', { name: /^Sign in with/ }).click()
  await expect(page.getByText(/EVM · 0xf39f/i)).toBeVisible({ timeout: 15_000 })

  const accessToken = await page.evaluate((key) => {
    const raw = localStorage.getItem(key)
    return raw ? (JSON.parse(raw).accessToken as string) : null
  }, AUTH_STORAGE_KEY)
  const headers = { Authorization: `Bearer ${accessToken}` }

  // A published two-item collection, seeded through the real API.
  const { collection, items: published } = await seedPublishedCollection(request, headers, 'E2E Cool Apes', 2)

  // The real part: deploy through the actual page, reached the way a user
  // reaches it (the NFT Generator hands off via ?collection=).
  await page.goto(`/nft/deploy-evm?collection=${collection.id}`)
  await expect(page.getByText(/2 of 2 generated items published/)).toBeVisible()
  await expect(page.getByLabel('Symbol')).toHaveValue('E2ECOOLAPE')
  await page.getByLabel('Mint price (ETH)').fill('0.01')
  await page.getByLabel('Max per wallet').fill('3')
  await page.getByRole('button', { name: 'Deploy ERC-721 collection' }).click()

  // metadata folder pinned (stub) -> real py-solc-x compile of the rendered
  // template (a display name with spaces, now a derived identifier) ->
  // signed + broadcast by the injected wallet's real key -> anvil receipt ->
  // backend re-verifies the receipt created this address from this sender
  // before recording it with the collection link.
  const deployed = page.getByText(/Deployed at 0x[0-9a-fA-F]{40}/)
  await expect(deployed).toBeVisible({ timeout: 45_000 })
  const contractAddress = (await deployed.textContent())!.match(/0x[0-9a-fA-F]{40}/)![0] as Address

  const publicClient = createPublicClient({ chain: anvil, transport: http(ANVIL_RPC_URL) })
  const read = <T,>(functionName: string, args: unknown[] = []) =>
    publicClient.readContract({ address: contractAddress, abi: ERC721_ABI, functionName, args } as never) as Promise<T>

  expect(await read<string>('name')).toBe('E2E Cool Apes')
  expect(await read<string>('symbol')).toBe('E2ECOOLAPE')
  expect((await read<Address>('owner')).toLowerCase()).toBe(CREATOR_ADDRESS.toLowerCase())
  expect(await read<bigint>('maxSupply')).toBe(2n)
  expect(await read<bigint>('mintPrice')).toBe(parseEther('0.01'))
  expect(await read<boolean>('mintingEnabled')).toBe(false)
  const baseUri = await read<string>('baseURI')
  expect(baseUri).toMatch(/^ipfs:\/\/Qm\w+\/$/)

  // The collection page now knows where it's deployed (nft_collection_id link).
  await expect(page.getByRole('link', { name: contractAddress })).toBeVisible()

  // Verified against the real deployed bytecode by the local verifying
  // Etherscan stub — including the identifier derived from a display name
  // with spaces ("E2E Cool Apes" -> contract E2ECoolApes).
  await page.getByRole('button', { name: 'Verify source' }).click()
  await expect(page.getByRole('link', { name: 'Source verified' })).toBeVisible({ timeout: 20_000 })

  // Switch public minting on — a real owner-only transaction from the page.
  await page.getByRole('button', { name: 'Enable public minting' }).click()
  await expect(page.getByText(/Public minting is on/)).toBeVisible({ timeout: 30_000 })
  expect(await read<boolean>('mintingEnabled')).toBe(true)

  // A different wallet buys two, paying the real price...
  const buyer = privateKeyToAccount(BUYER_PRIVATE_KEY)
  const buyerClient = createWalletClient({ account: buyer, chain: anvil, transport: http(ANVIL_RPC_URL) })
  const mintHash = await buyerClient.writeContract({
    address: contractAddress,
    abi: ERC721_ABI,
    functionName: 'mint',
    args: [buyer.address, 2n],
    value: parseEther('0.02'),
  })
  expect((await publicClient.waitForTransactionReceipt({ hash: mintHash })).status).toBe('success')
  expect(await read<Address>('ownerOf', [2n])).toBe(buyer.address)

  // ...and each token's URI resolves, through the IPFS gateway, to the
  // right generated item's metadata — token 1 -> first item, token 2 -> second.
  for (const tokenId of [1n, 2n]) {
    const tokenUri = await read<string>('tokenURI', [tokenId])
    expect(tokenUri).toBe(`${baseUri}${tokenId}.json`)
    const metadataRes = await request.get(tokenUri.replace('ipfs://', IPFS_GATEWAY))
    expect(metadataRes.ok()).toBe(true)
    const metadata = await metadataRes.json()
    expect(metadata.name).toBe(`E2E Cool Apes #${tokenId}`)
    expect(metadata.image).toBe(`ipfs://${published[Number(tokenId) - 1].ipfs_image_hash}`)
    expect(metadata.attributes).toEqual(published[Number(tokenId) - 1].attributes)
  }

  // Owner tools: the buyer paid 0.02 ETH into the contract. The creator
  // withdraws it, changes the price and pauses minting from the page's
  // Manage panel — each a real owner-only transaction from the injected
  // wallet, each checked on the chain directly afterwards.
  await page.reload()
  await page.getByRole('button', { name: 'Manage' }).click()
  const panel = page.getByTestId('erc721-manage')
  await expect(panel).toContainText('2 / 2 minted')
  await expect(panel).toContainText('0.02 ETH')
  await expectNoA11yViolations(page, 'populated ERC-721 deploy page with its Manage panel')

  const creatorBefore = await publicClient.getBalance({ address: CREATOR_ADDRESS })
  await panel.getByRole('button', { name: 'Withdraw to owner' }).click()
  await expect(panel.getByText('Proceeds withdrawn to the owner wallet.')).toBeVisible({ timeout: 30_000 })
  expect(await publicClient.getBalance({ address: contractAddress })).toBe(0n)
  // +0.02 ETH, minus the withdraw transaction's own gas.
  const creatorGain = (await publicClient.getBalance({ address: CREATOR_ADDRESS })) - creatorBefore
  expect(creatorGain > parseEther('0.019') && creatorGain < parseEther('0.02')).toBe(true)

  await panel.getByLabel('New mint price (ETH)').fill('0.05')
  await panel.getByRole('button', { name: 'Set price' }).click()
  await expect(panel.getByText('Mint price updated.')).toBeVisible({ timeout: 30_000 })
  expect(await read<bigint>('mintPrice')).toBe(parseEther('0.05'))

  await panel.getByRole('button', { name: 'Pause minting' }).click()
  await expect(panel.getByText('Minting status updated.')).toBeVisible({ timeout: 30_000 })
  expect(await read<boolean>('mintingEnabled')).toBe(false)
  await expect(panel).toContainText('Minting paused')
})
