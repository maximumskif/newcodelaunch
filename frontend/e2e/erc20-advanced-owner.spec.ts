import { expect, test } from '@playwright/test'
import { parseAbi, parseUnits, zeroAddress, type Address } from 'viem'

import { expectNoA11yViolations } from './setup/axe'
import { deployAdvancedToken, freshAddress, fundedWallet, installEvmWallet, ownerWallet, publicClient } from './setup/evmToken'

const TOKEN_ABI = parseAbi([
  'function owner() view returns (address)',
  'function tradingEnabled() view returns (bool)',
  'function maxTransactionAmount() view returns (uint256)',
  'function marketPairs(address) view returns (bool)',
  'function balanceOf(address) view returns (uint256)',
  'function transfer(address to, uint256 amount) returns (bool)',
])

const tokens = (amount: string) => parseUnits(amount, 18)

test.beforeEach(async ({ page }) => installEvmWallet(page))

test('an advanced ERC-20: trading gate, pair-based taxes split to the fee wallets, limits and renouncing — on a real chain', async ({
  page,
}) => {
  test.setTimeout(180_000)
  const holder = await fundedWallet()
  const pair = await fundedWallet() // stands in for a DEX pair: any address the owner registers
  const marketing = freshAddress()
  const liquidity = freshAddress()
  const outsider = freshAddress()

  // Buy 3% / sell 5% / split 60-40 are the template defaults.
  const token = await deployAdvancedToken(page, { marketing, liquidity })
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
  const owner = ownerWallet
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
  await expectNoA11yViolations(page, 'renounce-ownership dialog')
  await page.getByRole('dialog').getByRole('button', { name: 'Renounce ownership' }).click()
  await expect(panel.getByText('Ownership renounced', { exact: true })).toBeVisible({ timeout: 20_000 })
  await expect.poll(() => read<Address>('owner')).toBe(zeroAddress)
})
