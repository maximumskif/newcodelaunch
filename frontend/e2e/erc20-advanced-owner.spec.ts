import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import { createPublicClient, createTestClient, createWalletClient, defineChain, http, parseAbi, parseEther, parseUnits, zeroAddress, type Address } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'

const here = path.dirname(fileURLToPath(import.meta.url))

const ANVIL_RPC_URL = 'http://127.0.0.1:8545'
const anvil = defineChain({
  id: 11155111,
  name: 'anvil (as Sepolia)',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: { default: { http: [ANVIL_RPC_URL] } },
})

const TOKEN_ABI = parseAbi([
  'function owner() view returns (address)',
  'function tradingEnabled() view returns (bool)',
  'function maxTransactionAmount() view returns (uint256)',
  'function marketPairs(address) view returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
])

const publicClient = createPublicClient({ chain: anvil, transport: http(ANVIL_RPC_URL) })
const testClient = createTestClient({ chain: anvil, mode: 'anvil', transport: http(ANVIL_RPC_URL) })
const tokens = (amount: string) => parseUnits(amount, 18)

// Fresh throwaway accounts per run, so nothing here depends on (or disturbs)
// the anvil default accounts other specs use. Only the owner — anvil #0,
// the injected wallet — acts through the UI.
async function fundedWallet() {
  const account = privateKeyToAccount(generatePrivateKey())
  await testClient.setBalance({ address: account.address, value: parseEther('1') })
  return createWalletClient({ account, chain: anvil, transport: http(ANVIL_RPC_URL) })
}

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    ;(window as unknown as { __E2E_ANVIL_RPC_URL__: string }).__E2E_ANVIL_RPC_URL__ = 'http://127.0.0.1:8545'
  })
  await page.addInitScript({ path: path.join(here, '.generated', 'injectedEvmWallet.bundle.js') })
})

test('an advanced ERC-20: trading gate, pair-based taxes split to the fee wallets, limits and renouncing — on a real chain', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const holder = await fundedWallet()
  const pair = await fundedWallet() // stands in for a DEX pair: any address the owner registers
  const marketing = privateKeyToAccount(generatePrivateKey()).address
  const liquidity = privateKeyToAccount(generatePrivateKey()).address
  const outsider = privateKeyToAccount(generatePrivateKey()).address

  await page.goto('/tokens')
  await page.getByRole('button', { name: 'Connect EVM Wallet' }).click()
  await page.getByRole('button', { name: /^Sign in with/ }).click()
  await expect(page.getByText(/EVM · 0xf39f/i)).toBeVisible({ timeout: 15_000 })

  await page.getByRole('button', { name: /Advanced ERC-20 Token/ }).click()
  await page.getByLabel(/^Token Name/).fill('Advanced E2E')
  await page.getByLabel(/^Token Symbol/).fill('ADV')
  await page.getByLabel(/^Token Supply/).fill('1000000')
  await page.getByLabel(/^Max Tx Amount/i).fill('10000')
  await page.getByLabel(/^Max Wallet Amount/i).fill('20000')
  await page.getByLabel(/^Marketing Wallet/i).fill(marketing)
  await page.getByLabel(/^Liquidity Wallet/i).fill(liquidity)
  // Buy 3% / sell 5% / split 60-40 are the template defaults.
  await page.getByRole('button', { name: 'Deploy' }).click()

  const deployedText = page.getByTestId('deploy-result').getByText(/Deployed at/)
  await expect(deployedText).toBeVisible({ timeout: 30_000 })
  const token = (await deployedText.textContent())!.match(/0x[a-fA-F0-9]{40}/)![0] as Address
  // Polled: right after a receipt, anvil can briefly answer eth_call from
  // the block before it (seen here: the UI's receipt in, a read from this
  // process still on the old state).
  const read = <T>(functionName: 'owner' | 'tradingEnabled' | 'balanceOf' | 'maxTransactionAmount' | 'marketPairs', args: readonly [Address] | [] = []) =>
    publicClient.readContract({ address: token, abi: TOKEN_ABI, functionName, args } as never) as Promise<T>
  const send = async (from: typeof holder, to: Address, amount: bigint) => {
    const hash = await from.writeContract({ address: token, abi: TOKEN_ABI, functionName: 'transfer', args: [to, amount] })
    return publicClient.waitForTransactionReceipt({ hash })
  }

  // The owner is fee-excluded, so it can hand out tokens before trading
  // opens — to a holder, and to the "pair" as its pool side.
  const owner = createWalletClient({
    account: privateKeyToAccount('0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'),
    chain: anvil,
    transport: http(ANVIL_RPC_URL),
  })
  await send(owner, holder.account.address, tokens('5000'))
  await send(owner, pair.account.address, tokens('5000'))

  // Before trading is enabled, holders can't move it at all.
  await expect(send(holder, outsider, tokens('1'))).rejects.toThrow(/Trading not enabled/)

  await page.getByRole('button', { name: `Manage ${token}` }).click()
  const panel = page.getByTestId('erc20-manage')
  await expect(panel.getByText('Trading not enabled')).toBeVisible({ timeout: 15_000 })
  await expect(panel.getByText('Buy 3% · Sell 5% · split 60/40')).toBeVisible()
  await panel.getByRole('button', { name: 'Enable trading' }).click()
  await expect(panel.getByText('Trading is enabled.')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => read<boolean>('tradingEnabled')).toBe(true)

  // A plain wallet-to-wallet transfer is untaxed.
  await send(holder, outsider, tokens('100'))
  await expect.poll(() => read<bigint>('balanceOf', [outsider])).toBe(tokens('100'))

  await panel.getByLabel('Pair address').fill(pair.account.address)
  await panel.getByRole('button', { name: 'Register', exact: true }).click()
  await expect(panel.getByText('Market pair updated.')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => read<boolean>('marketPairs', [pair.account.address])).toBe(true)

  // Sell (holder -> pair): 5% of 1000 = 50, split 30 marketing / 20 liquidity.
  await send(holder, pair.account.address, tokens('1000'))
  await expect.poll(() => read<bigint>('balanceOf', [pair.account.address])).toBe(tokens('5950'))
  await expect.poll(() => read<bigint>('balanceOf', [marketing])).toBe(tokens('30'))
  await expect.poll(() => read<bigint>('balanceOf', [liquidity])).toBe(tokens('20'))

  // Buy (pair -> holder): 3% of 100 = 3, split 1.8 / 1.2.
  await send(pair, holder.account.address, tokens('100'))
  await expect.poll(() => read<bigint>('balanceOf', [holder.account.address])).toBe(tokens('3997'))
  await expect.poll(() => read<bigint>('balanceOf', [marketing])).toBe(tokens('31.8'))
  await expect.poll(() => read<bigint>('balanceOf', [liquidity])).toBe(tokens('21.2'))

  // Tighter limits, in whole tokens.
  await panel.getByLabel('Max transaction').fill('500')
  await panel.getByLabel('Max wallet').fill('1000')
  await panel.getByLabel('Max wallet').locator('..').getByRole('button', { name: 'Set' }).click()
  await expect(panel.getByText('Limits updated.')).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => read<bigint>('maxTransactionAmount')).toBe(tokens('500'))
  await expect(send(holder, outsider, tokens('600'))).rejects.toThrow(/Transfer amount exceeds maximum/)
  await send(holder, outsider, tokens('400'))
  await send(holder, outsider, tokens('400')) // outsider now holds 900
  await expect(send(holder, outsider, tokens('200'))).rejects.toThrow(/Wallet amount exceeds maximum/)
  // A registered pair already holds far more than the 1000 wallet cap and
  // can still receive sells — capping it would make every sell revert.
  await send(holder, pair.account.address, tokens('400'))

  // Renouncing: confirmed in a dialog, then nobody owns it.
  await panel.getByRole('button', { name: 'Renounce ownership…' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Renounce ownership' }).click()
  await expect(panel.getByText('Ownership renounced', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => read<Address>('owner')).toBe(zeroAddress)
})
