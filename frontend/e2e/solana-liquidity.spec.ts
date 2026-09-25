import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { expect, test } from '@playwright/test'
import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'
import raydiumSdk from '@raydium-io/raydium-sdk-v2'
import BN from 'bn.js'

import { expectNoA11yViolations } from './setup/axe'
import {
  FIXTURE_WALLET_PUBLIC_KEY as CREATOR_PUBLIC_KEY,
  fundFixtureWallet,
  RAYDIUM_CPMM_CONFIG_ID,
  RAYDIUM_CPMM_PROGRAM_ID,
  RAYDIUM_LOCK_AUTHORITY,
  RAYDIUM_LOCK_PROGRAM_ID,
  TOKEN_METADATA_PROGRAM_ID,
  VALIDATOR_RPC_URL,
  waitForClonedPrograms,
} from './setup/solanaValidator'

const { getCpmmPdaPoolId, Raydium, TxVersion } = raydiumSdk
const here = path.dirname(fileURLToPath(import.meta.url))
const WSOL = new PublicKey('So11111111111111111111111111111111111111112')
const connection = new Connection(VALIDATOR_RPC_URL, 'confirmed')

const tokenBalance = async (owner: PublicKey, mint: PublicKey) => {
  const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint })
  return accounts.value.reduce((sum, a) => sum + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n)
}

test.beforeAll(async () => {
  await waitForClonedPrograms(connection, [TOKEN_METADATA_PROGRAM_ID, RAYDIUM_CPMM_PROGRAM_ID, RAYDIUM_LOCK_PROGRAM_ID])
  await fundFixtureWallet(connection)
})

test.beforeEach(async ({ page }) => {
  await page.addInitScript({ path: path.join(here, '.generated', 'injectedSolanaWallet.bundle.js') })
})

test('Raydium liquidity for a launched SPL token: pool created, traded by another wallet, added to, withdrawn from and locked — on the real CPMM and lock programs', async ({
  page,
  browser,
}) => {
  test.setTimeout(150_000)

  await page.goto('/tokens?chain=solana')
  const connectButton = page.getByRole('button', { name: 'Connect Solana Wallet' })
  if (await connectButton.isVisible({ timeout: 3_000 }).catch(() => false)) {
    await connectButton.click()
    await page.getByRole('button', { name: /Phantom/ }).click()
  }
  await page.getByRole('button', { name: /^Sign in with/ }).click()
  await expect(page.getByText(new RegExp(`SOLANA · ${CREATOR_PUBLIC_KEY.slice(0, 6)}`))).toBeVisible({ timeout: 15_000 })

  // A fresh token (authorities revoked by default).
  await page.getByLabel('Token name').fill('Pool Token')
  await page.getByLabel('Symbol').fill('POOLT')
  await page.getByLabel('Initial supply (whole tokens)').fill('1000000')
  await page.getByLabel('Decimals').fill('6')
  await page.getByRole('button', { name: 'Launch token' }).click()
  await expect(page.getByText(/Pool Token \(POOLT\) launched/)).toBeVisible({ timeout: 45_000 })
  const mint = new PublicKey((await page.locator('p.font-mono').first().textContent())!.trim())
  const creator = new PublicKey(CREATOR_PUBLIC_KEY)

  // --- Create the pool: 100,000 POOLT + 1 SOL.
  const row = page.getByRole('row', { name: /Pool Token/ }).first()
  await row.getByRole('button', { name: 'Liquidity for POOLT' }).click()
  const panel = page.getByTestId('solana-liquidity')
  await expect(panel.getByText('No pool yet')).toBeVisible({ timeout: 20_000 })
  await expect(panel.getByText(/Raydium charges 0.15 SOL to create a pool/)).toBeVisible()
  await panel.getByLabel('POOLT to add').fill('100000')
  await panel.getByLabel('SOL to add').fill('1')
  await expect(panel.getByText('Starting price: 1 POOLT = 0.00001 SOL')).toBeVisible()
  await expectNoA11yViolations(page, 'Solana liquidity panel, no pool yet')

  const solBefore = await connection.getBalance(creator)
  await panel.getByRole('button', { name: 'Create pool' }).click()
  await expect(panel.getByText('Pool created.')).toBeVisible({ timeout: 60_000 })
  await expect(panel.getByTestId('solana-liquidity-history')).toContainText('Created the pool with 100,000 POOLT + 1 SOL')
  await expect(panel.getByText('Pool live')).toBeVisible()

  // On-chain, independently: the pool at the PDA Raydium derives, holding
  // exactly what was put in; the creator paid 1 SOL + the 0.15 SOL fee
  // (+ rent and fees).
  const [mint0, mint1] = Buffer.compare(mint.toBuffer(), WSOL.toBuffer()) < 0 ? [mint, WSOL] : [WSOL, mint]
  const poolId = getCpmmPdaPoolId(RAYDIUM_CPMM_PROGRAM_ID, RAYDIUM_CPMM_CONFIG_ID, mint0, mint1).publicKey
  await expect(panel.getByText(`Pool: ${poolId.toBase58()}`)).toBeVisible()
  const raydiumFor = (owner: PublicKey) =>
    Raydium.load({ connection, owner, cluster: 'devnet', disableFeatureCheck: true, disableLoadToken: true, blockhashCommitment: 'confirmed' })
  const reserves = async () => {
    const data = await (await raydiumFor(poolId)).cpmm.getRpcPoolInfo(poolId.toBase58(), true)
    const tokenIsA = data.mintA.equals(mint)
    return {
      token: BigInt((tokenIsA ? data.baseReserve : data.quoteReserve).toString()),
      sol: BigInt((tokenIsA ? data.quoteReserve : data.baseReserve).toString()),
      lpSupply: BigInt(data.lpAmount.toString()),
      lpMint: data.mintLp,
    }
  }
  const created = await reserves()
  expect({ token: created.token, sol: created.sol }).toEqual({ token: 100_000_000_000n, sol: 1_000_000_000n })
  expect(await tokenBalance(creator, mint)).toBe(900_000_000_000n)
  const spent = solBefore - (await connection.getBalance(creator))
  expect(spent > 1_150_000_000 && spent < 1_250_000_000).toBe(true)

  // --- Another wallet buys from the pool with 0.1 SOL (Raydium's own swap).
  // Pools open for trading a moment after creation (the program's open
  // time; a same-second swap fails NotApproved — found while probing).
  const buyer = Keypair.generate()
  await connection.confirmTransaction(await connection.requestAirdrop(buyer.publicKey, 2 * LAMPORTS_PER_SOL), 'confirmed')
  await page.waitForTimeout(2_000)
  const buyerRaydium = await raydiumFor(buyer.publicKey)
  const { poolInfo, poolKeys, rpcData } = await buyerRaydium.cpmm.getPoolInfoFromRpc(poolId.toBase58())
  const quote = buyerRaydium.cpmm.computeSwapAmount({
    pool: { ...rpcData, ...poolInfo } as never,
    amountIn: new BN(100_000_000),
    outputMint: mint,
    slippage: 0.01,
  })
  const { transaction: swapTx } = await buyerRaydium.cpmm.swap({
    poolInfo,
    poolKeys,
    inputAmount: new BN(100_000_000),
    swapResult: quote.swapResult,
    slippage: 0.01,
    baseIn: poolInfo.mintA.address === WSOL.toBase58(),
    txVersion: TxVersion.V0,
  })
  swapTx.sign([buyer])
  const swapSig = await connection.sendTransaction(swapTx)
  expect((await connection.confirmTransaction(swapSig, 'confirmed')).value.err).toBeNull()
  expect(await tokenBalance(buyer.publicKey, mint)).toBeGreaterThan(0n)
  const traded = await reserves()
  expect(traded.sol).toBeGreaterThan(created.sol)
  expect(traded.token).toBeLessThan(created.token)

  // --- The creator adds exactly 10,000 more POOLT at the new price.
  await panel.getByLabel('POOLT to add').fill('10000')
  await expect(panel.getByText(/up to 1% more if the price moves/)).toBeVisible()
  await panel.getByRole('button', { name: 'Add liquidity' }).click()
  await expect(panel.getByText('Liquidity added.')).toBeVisible({ timeout: 60_000 })
  // Deposits are in whole LP units, so up to a few base units of the
  // 10,000 can stay in the wallet as rounding — never more than asked.
  await expect(panel.getByTestId('solana-liquidity-history')).toContainText(/Added (10,000|9,999\.9999\d*) POOLT/)
  const deposited = await reserves()
  const added = deposited.token - traded.token
  expect(added <= 10_000_000_000n && added > 10_000_000_000n - 1_000n).toBe(true)
  expect(await tokenBalance(creator, mint)).toBe(900_000_000_000n - added)

  // --- ...and withdraws half of the position.
  const lpBefore = await tokenBalance(creator, deposited.lpMint)
  await expect(panel.getByTestId('solana-liquidity-withdraw')).toBeVisible()
  await panel.getByLabel('Share of your position (%)', { exact: true }).fill('50')
  await expectNoA11yViolations(page, 'Solana liquidity panel, live pool with withdrawal')
  await panel.getByRole('button', { name: 'Withdraw' }).click()
  await expect(panel.getByText('Liquidity withdrawn.')).toBeVisible({ timeout: 60_000 })
  await expect(panel.getByTestId('solana-liquidity-history')).toContainText('Withdrew')
  const lpAfter = await tokenBalance(creator, deposited.lpMint)
  expect(lpAfter).toBe(lpBefore - lpBefore / 2n)
  const withdrawn = await reserves()
  expect(withdrawn.lpSupply).toBe(deposited.lpSupply - lpBefore / 2n)
  expect(withdrawn.token).toBe(deposited.token - ((lpBefore / 2n) * deposited.token) / deposited.lpSupply)

  // --- Lock the rest of the position for good (Raydium Burn & Earn), behind
  // a can't-be-undone confirmation. The LP moves to the lock authority, and
  // the creator gets a Fee Key NFT.
  const nftsBefore = (await connection.getParsedTokenAccountsByOwner(creator, { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') })).value.filter(
    (a) => a.account.data.parsed.info.tokenAmount.decimals === 0 && a.account.data.parsed.info.tokenAmount.amount === '1',
  ).length
  const lock = panel.getByTestId('solana-liquidity-lock')
  await lock.getByLabel('Share of your position to lock (%)').fill('100')
  await lock.getByRole('button', { name: 'Lock forever…' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText("This can't be undone.")
  await expectNoA11yViolations(page, 'lock-forever confirmation')
  await dialog.getByRole('button', { name: 'Lock forever' }).click()
  await expect(panel.getByText('Liquidity locked for good.')).toBeVisible({ timeout: 60_000 })
  await expect(panel.getByTestId('solana-liquidity-history')).toContainText('LP tokens for good')

  expect(await tokenBalance(creator, withdrawn.lpMint)).toBe(0n)
  expect(await tokenBalance(RAYDIUM_LOCK_AUTHORITY, withdrawn.lpMint)).toBe(lpAfter)
  const nftsAfter = (await connection.getParsedTokenAccountsByOwner(creator, { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') })).value.filter(
    (a) => a.account.data.parsed.info.tokenAmount.decimals === 0 && a.account.data.parsed.info.tokenAmount.amount === '1',
  ).length
  expect(nftsAfter).toBe(nftsBefore + 1)
  // Everyone sees how much of the pool is locked; the creator has nothing
  // left to withdraw.
  const lockedPercent = ((Number(lpAfter) / Number(withdrawn.lpSupply)) * 100).toFixed(2)
  await expect(panel.getByText(`${lockedPercent}% locked forever`)).toBeVisible()
  await expect(panel.getByTestId('solana-liquidity-withdraw')).toBeHidden()

  // A buyer's view: the public page, in a fresh browser with no wallet.
  const stranger = await browser.newContext()
  const publicPage = await stranger.newPage()
  await publicPage.goto(`/token/solana_devnet/${mint.toBase58()}`)
  await expect(publicPage.getByRole('heading', { name: 'Pool Token (POOLT)' })).toBeVisible({ timeout: 20_000 })
  await expect(publicPage.getByText('Supply is fixed — no one can mint more')).toBeVisible()
  await expect(publicPage.getByText('No one can freeze holders’ tokens')).toBeVisible()
  await expect(publicPage.getByText(`${lockedPercent}% of the pool's liquidity is locked forever`, { exact: false })).toBeVisible()
  await expectNoA11yViolations(publicPage, 'public token page (Solana)')
  await stranger.close()
})
