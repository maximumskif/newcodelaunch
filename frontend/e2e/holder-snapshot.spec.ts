import { expect, test } from '@playwright/test'
import { createAccount, createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token'
import { Connection, Keypair, LAMPORTS_PER_SOL } from '@solana/web3.js'
import { parseAbi, parseUnits, type Address } from 'viem'

import { freshAddress, installEvmWallet, ownerWallet, publicClient } from './setup/evmToken'
import { VALIDATOR_RPC_URL } from './setup/solanaValidator'

const TRANSFER_ABI = parseAbi(['function transfer(address to, uint256 amount) returns (bool)'])

test('EVM: every holder of a token launched here, now and at a past block — on a real chain', async ({ page }) => {
  test.setTimeout(120_000)
  await installEvmWallet(page)
  await page.goto('/tokens/create')
  await page.getByRole('button', { name: 'Connect EVM Wallet' }).click()
  await page.getByRole('button', { name: /^Sign in with/ }).click()
  await expect(page.getByText(/EVM · 0xf39f/i)).toBeVisible({ timeout: 15_000 })
  await page.getByLabel(/^Token Name/).fill('Snapshot E2E')
  await page.getByLabel(/^Token Symbol/).fill('SNAP')
  await page.getByLabel(/^Token Supply/).fill('1000')
  await page.getByRole('button', { name: 'Deploy' }).click()
  const deployedText = page.getByTestId('deploy-result').getByText(/Deployed at/)
  await expect(deployedText).toBeVisible({ timeout: 30_000 })
  const token = (await deployedText.textContent())!.match(/0x[a-fA-F0-9]{40}/)![0] as Address

  const [a, b] = [freshAddress(), freshAddress()]
  const transferBlocks: bigint[] = []
  for (const [to, amount] of [[a, '300'], [b, '100'], ['0x000000000000000000000000000000000000dEaD', '50']] as const) {
    const hash = await ownerWallet.writeContract({ address: token, abi: TRANSFER_ABI, functionName: 'transfer', args: [to as Address, parseUnits(amount, 18)] })
    transferBlocks.push((await publicClient.waitForTransactionReceipt({ hash })).blockNumber)
  }
  // The block just before the first transfer: the token exists, nothing has
  // moved yet. (Reading the block number right after the UI's deploy can
  // lag behind it — seen here.)
  const before = transferBlocks[0] - 1n

  await page.goto(`/liquidity/snapshot?network=sepolia&address=${token}`)
  const result = page.getByTestId('snapshot-result')
  await expect(result.getByText('1,000 SNAP')).toBeVisible({ timeout: 20_000 })
  const rows = result.getByRole('row')
  await expect(rows).toHaveCount(5) // header + deployer, a, b, burn
  await expect(rows.nth(1)).toContainText('550') // 1000 - 300 - 100 - 50
  await expect(rows.nth(2)).toContainText(a)
  await expect(rows.nth(2)).toContainText('30.00%')
  await expect(rows.nth(4)).toContainText('(burn address)')

  // The CSV is what's on screen, exactly.
  const [download] = await Promise.all([page.waitForEvent('download'), result.getByRole('button', { name: /download csv/ }).click()])
  const csv = await (await download.createReadStream()).toArray().then((chunks) => Buffer.concat(chunks).toString())
  expect(csv).toContain(`${a},300,30.000000,`)
  expect(csv).toContain('0x000000000000000000000000000000000000dEaD,50,5.000000,burn address')

  // Before the transfers, the deployer held everything.
  await page.getByLabel('at block (optional)').fill(String(before))
  await page.getByRole('button', { name: '[ snapshot ]' }).click()
  await expect(result.getByText(`block ${Number(before).toLocaleString('en-US')}`)).toBeVisible({ timeout: 20_000 })
  await expect(rows).toHaveCount(2)
  await expect(rows.nth(1)).toContainText('100.00%')
})

test('Solana: holders are owners, their token accounts added together — against a local validator', async ({ page }) => {
  test.setTimeout(90_000)
  const connection = new Connection(VALIDATOR_RPC_URL, 'confirmed')
  const authority = Keypair.generate()
  await connection.confirmTransaction(await connection.requestAirdrop(authority.publicKey, 2 * LAMPORTS_PER_SOL), 'confirmed')
  const mint = await createMint(connection, authority, authority.publicKey, null, 2)
  const [alice, bob] = [Keypair.generate(), Keypair.generate()]
  const aliceMain = await getOrCreateAssociatedTokenAccount(connection, authority, mint, alice.publicKey)
  // A second, non-associated account for the same owner.
  const aliceSecond = await createAccount(connection, authority, mint, alice.publicKey, Keypair.generate())
  const bobMain = await getOrCreateAssociatedTokenAccount(connection, authority, mint, bob.publicKey)
  await mintTo(connection, authority, mint, aliceMain.address, authority, 60_00n)
  await mintTo(connection, authority, mint, aliceSecond, authority, 15_00n)
  await mintTo(connection, authority, mint, bobMain.address, authority, 25_00n)

  await page.goto(`/liquidity/snapshot?network=solana_devnet&address=${mint.toBase58()}`)
  const result = page.getByTestId('snapshot-result')
  await expect(result.getByText('as of', { exact: false })).toBeVisible({ timeout: 20_000 })
  const rows = result.getByRole('row')
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(1)).toContainText(alice.publicKey.toBase58())
  await expect(rows.nth(1)).toContainText('75')
  await expect(rows.nth(1)).toContainText('75.00%')
  await expect(rows.nth(2)).toContainText(bob.publicKey.toBase58())
  await expect(rows.nth(2)).toContainText('25.00%')
})
