import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, type Page } from '@playwright/test'
import { createPublicClient, createTestClient, createWalletClient, defineChain, http, parseEther, type Address } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

// Shared by the specs that deploy an erc20_advanced token through the UI
// and then check its behaviour on the anvil chain directly.

const here = path.dirname(fileURLToPath(import.meta.url))

export const ANVIL_RPC_URL = 'http://127.0.0.1:8545'
// run-anvil.sh runs anvil with Sepolia's chain id, so the app's real config needs no changes.
export const anvil = defineChain({
  id: 11155111,
  name: 'anvil (as Sepolia)',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC_URL] } },
})

export const publicClient = createPublicClient({ chain: anvil, transport: http(ANVIL_RPC_URL) })
const testClient = createTestClient({ chain: anvil, mode: 'anvil', transport: http(ANVIL_RPC_URL) })

// anvil's default account #0 — the injected wallet the UI signs with.
export const ownerWallet = createWalletClient({
  account: privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'),
  chain: anvil,
  transport: http(ANVIL_RPC_URL),
})

// Fresh throwaway accounts per run, so nothing depends on (or disturbs) the
// anvil default accounts other specs use.
export async function fundedWallet() {
  const account = privateKeyToAccount(generatePrivateKey())
  await testClient.setBalance({ address: account.address, value: parseEther('1') })
  return createWalletClient({ account, chain: anvil, transport: http(ANVIL_RPC_URL) })
}

export const freshAddress = () => privateKeyToAccount(generatePrivateKey()).address

export async function installEvmWallet(page: Page) {
  // Order matters: this constant must be set before the wallet bundle's
  // IIFE runs (see fixtures/injectedEvmWallet.ts).
  await page.addInitScript(() => {
    ;(window as unknown as { __E2E_ANVIL_RPC_URL__: string }).__E2E_ANVIL_RPC_URL__ = 'http://127.0.0.1:8545'
  })
  await page.addInitScript({ path: path.join(here, '..', '.generated', 'injectedEvmWallet.bundle.js') })
}

// Signs in on the Token Launchpad and deploys an erc20_advanced with the
// template's default taxes (buy 3%, sell 5%, split 60/40) and a 1,000,000
// supply to the owner. Returns the token's address.
export async function deployAdvancedToken(
  page: Page,
  { marketing, liquidity, maxTx = '10000', maxWallet = '20000' }: { marketing: Address; liquidity: Address; maxTx?: string; maxWallet?: string },
): Promise<Address> {
  await page.goto('/tokens')
  await page.getByRole('button', { name: 'Connect EVM Wallet' }).click()
  await page.getByRole('button', { name: /^Sign in with/ }).click()
  await expect(page.getByText(/EVM · 0xf39f/i)).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: /Advanced ERC-20 Token/ }).click()
  await page.getByLabel(/^Token Name/).fill('Advanced E2E')
  await page.getByLabel(/^Token Symbol/).fill('ADV')
  await page.getByLabel(/^Token Supply/).fill('1000000')
  await page.getByLabel(/^Max Tx Amount/i).fill(maxTx)
  await page.getByLabel(/^Max Wallet Amount/i).fill(maxWallet)
  await page.getByLabel(/^Marketing Wallet/i).fill(marketing)
  await page.getByLabel(/^Liquidity Wallet/i).fill(liquidity)
  await page.getByRole('button', { name: 'Deploy' }).click()

  const deployedText = page.getByTestId('deploy-result').getByText(/Deployed at/)
  await expect(deployedText).toBeVisible({ timeout: 30_000 })
  return (await deployedText.textContent())!.match(/0x[a-fA-F0-9]{40}/)![0] as Address
}
