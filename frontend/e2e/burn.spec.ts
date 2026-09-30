import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import { createMint, getOrCreateAssociatedTokenAccount, mintTo } from '@solana/spl-token'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import { parseAbi, parseUnits, type Address } from 'viem'

import { deployAdvancedToken, freshAddress, installEvmWallet, publicClient } from './setup/evmToken'
import { FIXTURE_WALLET_PUBLIC_KEY, fundFixtureWallet, VALIDATOR_RPC_URL } from './setup/solanaValidator'

const here = path.dirname(fileURLToPath(import.meta.url))
const TOKEN_ABI = parseAbi(['function totalSupply() view returns (uint256)', 'function balanceOf(address) view returns (uint256)'])
const DEAD = '0x000000000000000000000000000000000000dEaD'

async function openBurn(page: import('@playwright/test').Page, url: string) {
  // In-app navigation keeps the wallet connection and sign-in.
  await page.evaluate((target) => {
    history.pushState({}, '', target)
    dispatchEvent(new PopStateEvent('popstate'))
  }, url)
}

async function burn(page: import('@playwright/test').Page, amount: string) {
  await page.getByLabel('amount to burn').fill(amount)
  await page.getByLabel(/Burned tokens are gone for good/).check()
  await page.getByRole('button', { name: new RegExp(`^\\[ burn ${amount.replace('.', '\\.')}`) }).click()
}

test('EVM: burn() lowers supply; a token without it goes to the dead address — on a real chain', async ({ page }) => {
  test.setTimeout(180_000)
  await installEvmWallet(page)

  // The advanced template has no burn(): deploying it also signs us in.
  const advanced = await deployAdvancedToken(page, { marketing: freshAddress(), liquidity: freshAddress() })

  // A basic token, which has burn().
  await page.getByRole('button', { name: /Basic ERC-20 Token/ }).click()
  await page.getByLabel(/^Token Name/).fill('Burn E2E')
  await page.getByLabel(/^Token Symbol/).fill('BRN')
  await page.getByLabel(/^Token Supply/).fill('1000')
  await page.getByRole('button', { name: 'Deploy' }).click()
  const deployed = page.getByTestId('deploy-result').getByText(/Deployed at/)
  await expect(deployed).toContainText(/0x[a-fA-F0-9]{40}/, { timeout: 30_000 })
  const basic = (await deployed.textContent())!.match(/0x[a-fA-F0-9]{40}/)![0] as Address
  expect(basic).not.toBe(advanced)
  const read = (token: Address, fn: 'totalSupply' | 'balanceOf', args: readonly [Address] | [] = []) =>
    publicClient.readContract({ address: token, abi: TOKEN_ABI, functionName: fn, args } as never) as Promise<bigint>

  await openBurn(page, `/tokens/burn?network=sepolia&token=${basic}`)
  await expect(page.getByTestId('burn-method')).toContainText('burn() function', { timeout: 15_000 })
  await burn(page, '250.5')
  await expect(page.getByText('Burned 250.5 BRN.')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => read(basic, 'totalSupply')).toBe(parseUnits('749.5', 18))
  await expect(page.getByTestId('burn-token')).toContainText('749.5')

  await openBurn(page, `/tokens/burn?network=sepolia&token=${advanced}`)
  await expect(page.getByTestId('burn-method')).toContainText('no burn function', { timeout: 15_000 })
  await burn(page, '100')
  await expect(page.getByText('Sent to the dead address: 100 ADV.')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => read(advanced, 'balanceOf', [DEAD])).toBe(parseUnits('100', 18))
  expect(await read(advanced, 'totalSupply')).toBe(parseUnits('1000000', 18))
})

test('Solana: a real SPL burn lowers the mint supply — against a local validator', async ({ page }) => {
  test.setTimeout(90_000)
  const connection = new Connection(VALIDATOR_RPC_URL, 'confirmed')
  await fundFixtureWallet(connection)
  const authority = Keypair.generate()
  await connection.confirmTransaction(await connection.requestAirdrop(authority.publicKey, 2 * LAMPORTS_PER_SOL), 'confirmed')
  const mint = await createMint(connection, authority, authority.publicKey, null, 6)
  const account = await getOrCreateAssociatedTokenAccount(connection, authority, mint, new PublicKey(FIXTURE_WALLET_PUBLIC_KEY))
  await mintTo(connection, authority, mint, account.address, authority, 1_000n * 10n ** 6n)

  await page.addInitScript({ path: path.join(here, '.generated', 'injectedSolanaWallet.bundle.js') })
  await page.goto(`/tokens/burn?chain=solana&mint=${mint.toBase58()}`)
  const connectButton = page.getByRole('button', { name: 'Connect Solana Wallet' })
  if (await connectButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await connectButton.click()
    await page.getByRole('button', { name: /Phantom/ }).click()
  }
  await expect(page.getByLabel('token to burn')).toHaveValue(mint.toBase58(), { timeout: 15_000 })
  await expect(page.getByTestId('burn-token')).toContainText('1,000')

  await burn(page, '400')
  await expect(page.getByText('Burned 400.')).toBeVisible({ timeout: 30_000 })
  expect((await connection.getTokenSupply(mint)).value.amount).toBe(String(600n * 10n ** 6n))
  await expect(page.getByTestId('burn-token')).toContainText('600')
})
