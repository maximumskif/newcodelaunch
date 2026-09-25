import { Router, type Request, type Response } from "express";
import { Connection, PublicKey, VersionedTransaction } from "@solana/web3.js";
import { getMint, NATIVE_MINT, TOKEN_PROGRAM_ID } from "@solana/spl-token";
import {
  CpmmConfigInfoLayout,
  getCpmmPdaPoolId,
  getPdaLpMint,
  getPdaVault,
  Percent,
  Raydium,
  TxVersion,
} from "@raydium-io/raydium-sdk-v2";
import BN from "bn.js";

import { isSolanaNetwork, SOLANA_NETWORKS, type SolanaNetwork } from "../lib/umi.js";

export const raydiumRouter = Router();

// Raydium CPMM (the constant-product pools Raydium creates today, SPL token
// against wrapped SOL here). Addresses from the Raydium SDK's own constants
// (CREATE_CPMM_POOL_PROGRAM / _FEE_ACC, mainnet and DEVNET_PROGRAM_ID) and
// Raydium's cpmm-config API, each then checked on its chain on 2026-09-25:
// the program is an executable upgradeable program, the fee receiver a
// token account, and the config an account owned by the program. The
// config is the standard 0.25% fee tier (index 0) on both clusters. Its
// fees and pool-creation fee are read from the chain on every request, not
// hardcoded.
//
// The lock program is Raydium's "Burn & Earn": LP tokens sent to it are
// locked for good — it has no unlock — and the locker gets a Fee Key NFT
// that can claim the position's trading fees. Its program and authority
// (the SDK's LOCK_CPMM_PROGRAM / LOCK_CPMM_AUTH) were checked on both
// clusters the same way.
const CPMM: Record<
  SolanaNetwork,
  { programId: PublicKey; configId: PublicKey; poolFeeAccount: PublicKey; lockProgramId: PublicKey; lockAuthority: PublicKey }
> = {
  devnet: {
    programId: new PublicKey("DRaycpLY18LhpbydsBWbVJtxpNv9oXPgjRSfpF2bWpYb"),
    configId: new PublicKey("5MxLgy9oPdTC3YgkiePHqr3EoCRD9uLVYRQS2ANAs7wy"),
    poolFeeAccount: new PublicKey("3oE58BKVt8KuYkGxx8zBojugnymWmBiyafWgMrnb6eYy"),
    lockProgramId: new PublicKey("DRay25Usp3YJAi7beckgpGUC7mGJ2cR1AVPxhYfwVCUX"),
    lockAuthority: new PublicKey("7qWVV8UY2bRJfDLP4s37YzBPKUkVB46DStYJBpYbQzu3"),
  },
  "mainnet-beta": {
    programId: new PublicKey("CPMMoo8L3F4NbTegBCKVNunggL7H1ZpdTHKxQB5qKP1C"),
    configId: new PublicKey("D4FPEruKEHrG5TenZ2mpDGEfu1iUvTiqBxvpU8HLBvC2"),
    poolFeeAccount: new PublicKey("DNXgeM9EiiaAbaWvwjHj9fQQLAX5ZsfHyvmYUNRAdNC8"),
    lockProgramId: new PublicKey("LockrWmn6K5twhz3y9w1dQERbmgSaRkfnTeTKbpofwE"),
    lockAuthority: new PublicKey("3f7GcQFG397GAaEnv51zR6tsTVihYRydnydDD1cXekxH"),
  },
};

const U64_MAX = (1n << 64n) - 1n;
const MAX_SLIPPAGE_BPS = 500;

class BadRequest extends Error {}

function connectionFor(network: SolanaNetwork): Connection {
  return new Connection(SOLANA_NETWORKS[network], "confirmed");
}

function parseNetwork(value: unknown): SolanaNetwork {
  if (typeof value !== "string" || !isSolanaNetwork(value)) throw new BadRequest("network must be one of: devnet, mainnet-beta");
  return value;
}

function parseKey(value: unknown, name: string): PublicKey {
  try {
    if (typeof value !== "string") throw new Error();
    return new PublicKey(value);
  } catch {
    throw new BadRequest(`${name} must be a valid public key`);
  }
}

// Raw base units as a decimal string (u64 amounts don't survive JSON numbers).
function parseAmount(value: unknown, name: string): bigint {
  if (typeof value !== "string" || !/^\d+$/.test(value)) throw new BadRequest(`${name} must be a positive integer string`);
  const amount = BigInt(value);
  if (amount <= 0n || amount > U64_MAX) throw new BadRequest(`${name} must be between 1 and 2^64-1`);
  return amount;
}

function parseSlippage(value: unknown): number {
  if (value === undefined) return 100;
  if (typeof value !== "number" || !Number.isInteger(value) || value < 0 || value > MAX_SLIPPAGE_BPS) {
    throw new BadRequest(`slippageBps must be an integer from 0 to ${MAX_SLIPPAGE_BPS}`);
  }
  return value;
}

// The pool for (config, token, wrapped SOL) is a PDA over the two mints in
// byte order — derived here, never taken from a caller.
function sortedMints(mint: PublicKey): [PublicKey, PublicKey] {
  return Buffer.compare(mint.toBuffer(), NATIVE_MINT.toBuffer()) < 0 ? [mint, NATIVE_MINT] : [NATIVE_MINT, mint];
}

function poolAddress(network: SolanaNetwork, mint: PublicKey): PublicKey {
  const { programId, configId } = CPMM[network];
  const [mint0, mint1] = sortedMints(mint);
  return getCpmmPdaPoolId(programId, configId, mint0, mint1).publicKey;
}

async function readConfig(connection: Connection, network: SolanaNetwork) {
  const account = await connection.getAccountInfo(CPMM[network].configId);
  if (!account || !account.owner.equals(CPMM[network].programId)) throw new Error("Raydium CPMM fee config not found on-chain");
  const config = CpmmConfigInfoLayout.decode(account.data);
  return {
    id: CPMM[network].configId.toBase58(),
    index: config.index,
    protocolFeeRate: config.protocolFeeRate.toNumber(),
    tradeFeeRate: config.tradeFeeRate.toNumber(),
    fundFeeRate: config.fundFeeRate.toNumber(),
    createPoolFee: config.createPoolFee.toString(),
    creatorFeeRate: config.creatorFeeRate.toNumber(),
    disableCreatePool: config.disableCreatePool,
  };
}

// A classic-SPL mint (the only kind the Token Launchpad creates).
async function readMint(connection: Connection, mint: PublicKey) {
  const account = await connection.getAccountInfo(mint);
  if (!account || !account.owner.equals(TOKEN_PROGRAM_ID)) throw new BadRequest("mint is not a classic SPL token mint on this network");
  return getMint(connection, mint);
}

// The SDK, with the given wallet as owner — a public key only: it builds
// transactions naming that wallet, it never signs. Loaded per request so
// its view of the wallet's token accounts is current (a cached instance
// didn't see LP tokens minted after it loaded — found while probing).
function loadRaydium(connection: Connection, network: SolanaNetwork, owner: PublicKey) {
  return Raydium.load({
    connection,
    owner,
    cluster: network === "devnet" ? "devnet" : "mainnet",
    disableFeatureCheck: true,
    disableLoadToken: true,
    blockhashCommitment: "confirmed",
  });
}

async function readPool(connection: Connection, network: SolanaNetwork, mint: PublicKey) {
  const poolId = poolAddress(network, mint);
  const info = await connection.getAccountInfo(poolId);
  if (!info) return { poolId, pool: null };
  // Any owner works for reads; the pool's own id is a valid key.
  const raydium = await loadRaydium(connection, network, poolId);
  const data = await raydium.cpmm.getRpcPoolInfo(poolId.toBase58(), true);
  const tokenIsA = data.mintA.equals(mint);
  return {
    poolId,
    pool: {
      lpMint: data.mintLp,
      tokenReserve: BigInt((tokenIsA ? data.baseReserve : data.quoteReserve).toString()),
      solReserve: BigInt((tokenIsA ? data.quoteReserve : data.baseReserve).toString()),
      lpSupply: BigInt(data.lpAmount.toString()),
      lpDecimals: data.lpDecimals,
      openTime: Number(data.openTime.toString()),
      tokenIsA,
    },
  };
}

async function lpBalance(connection: Connection, owner: PublicKey, lpMint: PublicKey): Promise<bigint> {
  const accounts = await connection.getParsedTokenAccountsByOwner(owner, { mint: lpMint });
  return accounts.value.reduce((sum, a) => sum + BigInt(a.account.data.parsed.info.tokenAmount.amount), 0n);
}

function serialize(transaction: VersionedTransaction): string {
  return Buffer.from(transaction.serialize()).toString("base64");
}

function handle(fn: (req: Request, res: Response) => Promise<void>) {
  return async (req: Request, res: Response) => {
    try {
      await fn(req, res);
    } catch (err) {
      if (err instanceof BadRequest) {
        res.status(400).json({ error: err.message });
        return;
      }
      console.error(err);
      res.status(502).json({ error: err instanceof Error ? err.message : "Raydium request failed" });
    }
  };
}

// State of a token's SOL pool: the fee tier, whether the pool exists, its
// reserves, and — given an owner — that wallet's LP balance.
raydiumRouter.get(
  "/pool",
  handle(async (req, res) => {
    const network = parseNetwork(req.query.network);
    const mint = parseKey(req.query.mint, "mint");
    const connection = connectionFor(network);
    const [config, { poolId, pool }] = await Promise.all([readConfig(connection, network), readPool(connection, network, mint)]);
    let ownerLp: string | null = null;
    if (pool && typeof req.query.owner === "string") {
      ownerLp = (await lpBalance(connection, parseKey(req.query.owner, "owner"), pool.lpMint)).toString();
    }
    // Everything anyone has locked in this pool through Burn & Earn: the
    // lock authority's LP balance. Public — the trust figure buyers check.
    const lockedLp = pool ? (await lpBalance(connection, CPMM[network].lockAuthority, pool.lpMint)).toString() : null;
    res.json({
      programId: CPMM[network].programId.toBase58(),
      config,
      poolId: poolId.toBase58(),
      pool: pool && {
        lpMint: pool.lpMint.toBase58(),
        tokenReserve: pool.tokenReserve.toString(),
        solReserve: pool.solReserve.toString(),
        lpSupply: pool.lpSupply.toString(),
        lpDecimals: pool.lpDecimals,
        openTime: pool.openTime,
      },
      ownerLp,
      lockedLp,
    });
  }),
);

// Create the token's pool, seeded with exactly these amounts (they set the
// starting price). The owner pays Raydium's pool-creation fee too.
raydiumRouter.post(
  "/pool/prepare-create",
  handle(async (req, res) => {
    const network = parseNetwork(req.body?.network);
    const owner = parseKey(req.body?.owner, "owner");
    const mint = parseKey(req.body?.mint, "mint");
    const tokenAmount = parseAmount(req.body?.tokenAmount, "tokenAmount");
    const solAmount = parseAmount(req.body?.solAmount, "solAmount");
    const connection = connectionFor(network);

    const [config, mintInfo, { pool }] = await Promise.all([
      readConfig(connection, network),
      readMint(connection, mint),
      readPool(connection, network, mint),
    ]);
    if (config.disableCreatePool) throw new BadRequest("Raydium isn't accepting new pools on this fee tier right now");
    if (pool) throw new BadRequest("This token already has a Raydium pool — add liquidity to it instead");

    const raydium = await loadRaydium(connection, network, owner);
    const token = { address: mint.toBase58(), decimals: mintInfo.decimals, programId: TOKEN_PROGRAM_ID.toBase58() };
    const sol = { address: NATIVE_MINT.toBase58(), decimals: 9, programId: TOKEN_PROGRAM_ID.toBase58() };
    const { disableCreatePool: _disabled, ...feeConfig } = config;
    const { transaction, extInfo } = await raydium.cpmm.createPool({
      programId: CPMM[network].programId,
      poolFeeAccount: CPMM[network].poolFeeAccount,
      mintA: token,
      mintB: sol,
      mintAAmount: new BN(tokenAmount.toString()),
      mintBAmount: new BN(solAmount.toString()),
      startTime: new BN(0),
      feeConfig,
      associatedOnly: false,
      ownerInfo: { useSOLBalance: true },
      txVersion: TxVersion.V0,
    });
    if (!extInfo.address.poolId.equals(poolAddress(network, mint))) throw new Error("SDK pool address doesn't match the derived one");
    res.json({ transaction: serialize(transaction), poolId: extInfo.address.poolId.toBase58(), createPoolFee: config.createPoolFee });
  }),
);

// Add to an existing pool: up to `tokenAmount` of the token, and the SOL
// the pool's current ratio calls for — at most `slippageBps` more if the
// price moves before it lands. The program deposits in whole LP units, so
// a few base units of the token can stay behind as rounding (seen in the
// e2e run: 10,000 asked, 9,999.999991 deposited, after a trade). The SDK's
// default instead takes the slippage off the deposit — asking for 10,000
// tokens deposited 9,900, seen while probing.
raydiumRouter.post(
  "/pool/prepare-deposit",
  handle(async (req, res) => {
    const network = parseNetwork(req.body?.network);
    const owner = parseKey(req.body?.owner, "owner");
    const mint = parseKey(req.body?.mint, "mint");
    const tokenAmount = parseAmount(req.body?.tokenAmount, "tokenAmount");
    const slippageBps = parseSlippage(req.body?.slippageBps);
    const connection = connectionFor(network);

    const { poolId, pool } = await readPool(connection, network, mint);
    if (!pool || pool.tokenReserve === 0n || pool.lpSupply === 0n) throw new BadRequest("This token has no Raydium pool yet — create one first");
    const lpAmount = (tokenAmount * pool.lpSupply) / pool.tokenReserve;
    if (lpAmount === 0n) throw new BadRequest("That amount is too small to add");
    // The program rounds what it takes up; mirror that for the quote.
    const solNeeded = (lpAmount * pool.solReserve + pool.lpSupply - 1n) / pool.lpSupply;
    const maxSol = (solNeeded * BigInt(10_000 + slippageBps)) / 10_000n;

    const raydium = await loadRaydium(connection, network, owner);
    const { poolInfo, poolKeys } = await raydium.cpmm.getPoolInfoFromRpc(poolId.toBase58());
    const fee = (amount: bigint) => ({ amount: new BN(amount.toString()), fee: undefined, expirationTime: undefined });
    const { transaction } = await raydium.cpmm.addLiquidity({
      poolInfo,
      poolKeys,
      inputAmount: new BN(tokenAmount.toString()),
      baseIn: pool.tokenIsA,
      slippage: new Percent(slippageBps, 10_000),
      computeResult: {
        inputAmountFee: fee(tokenAmount),
        anotherAmount: fee(maxSol),
        maxAnotherAmount: fee(maxSol),
        liquidity: new BN(lpAmount.toString()),
      },
      txVersion: TxVersion.V0,
    });
    res.json({
      transaction: serialize(transaction),
      quote: { tokenAmount: tokenAmount.toString(), solAmount: solNeeded.toString(), maxSolAmount: maxSol.toString(), lpAmount: lpAmount.toString() },
    });
  }),
);

// Withdraw `lpAmount` of the owner's LP tokens: both sides back at the
// pool's ratio, each at least `slippageBps` below the quote. Wrapped SOL is
// unwrapped back to SOL.
raydiumRouter.post(
  "/pool/prepare-withdraw",
  handle(async (req, res) => {
    const network = parseNetwork(req.body?.network);
    const owner = parseKey(req.body?.owner, "owner");
    const mint = parseKey(req.body?.mint, "mint");
    const lpAmount = parseAmount(req.body?.lpAmount, "lpAmount");
    const slippageBps = parseSlippage(req.body?.slippageBps);
    const connection = connectionFor(network);

    const { poolId, pool } = await readPool(connection, network, mint);
    if (!pool || pool.lpSupply === 0n) throw new BadRequest("This token has no Raydium pool");
    const raydium = await loadRaydium(connection, network, owner);
    const { poolInfo, poolKeys } = await raydium.cpmm.getPoolInfoFromRpc(poolId.toBase58());
    const { transaction } = await raydium.cpmm.withdrawLiquidity({
      poolInfo,
      poolKeys,
      lpAmount: new BN(lpAmount.toString()),
      slippage: new Percent(slippageBps, 10_000),
      closeWsol: true,
      txVersion: TxVersion.V0,
    });
    res.json({
      transaction: serialize(transaction),
      quote: {
        tokenAmount: ((lpAmount * pool.tokenReserve) / pool.lpSupply).toString(),
        solAmount: ((lpAmount * pool.solReserve) / pool.lpSupply).toString(),
      },
    });
  }),
);

// Lock `lpAmount` of the owner's LP tokens for good with Raydium's Burn &
// Earn — no unlock exists. The owner gets a Fee Key NFT for the position.
// The NFT's mint is a new keypair the SDK generates and signs with here
// (single-use, never stored); the owner's wallet signs the rest.
raydiumRouter.post(
  "/pool/prepare-lock",
  handle(async (req, res) => {
    const network = parseNetwork(req.body?.network);
    const owner = parseKey(req.body?.owner, "owner");
    const mint = parseKey(req.body?.mint, "mint");
    const lpAmount = parseAmount(req.body?.lpAmount, "lpAmount");
    const connection = connectionFor(network);

    const { poolId, pool } = await readPool(connection, network, mint);
    if (!pool) throw new BadRequest("This token has no Raydium pool");
    if ((await lpBalance(connection, owner, pool.lpMint)) < lpAmount) throw new BadRequest("That's more LP tokens than this wallet holds");
    const raydium = await loadRaydium(connection, network, owner);
    const { poolInfo, poolKeys } = await raydium.cpmm.getPoolInfoFromRpc(poolId.toBase58());
    const { transaction, extInfo } = await raydium.cpmm.lockLp({
      poolInfo,
      poolKeys,
      lpAmount: new BN(lpAmount.toString()),
      programId: CPMM[network].lockProgramId,
      authProgram: CPMM[network].lockAuthority,
      withMetadata: true,
      txVersion: TxVersion.V0,
    });
    res.json({ transaction: serialize(transaction), feeNftMint: extInfo.nftMint.toBase58() });
  }),
);

// What a confirmed transaction did to a token's pool, read from the chain
// for the backend to judge: success, fee payer, whether the CPMM program
// ran, and how much each of the pool's two vaults gained or lost (from the
// transaction's own pre/post token balances). The pool and its vaults are
// derived from the mint, so a transaction touching some other pool reads as
// no change here.
raydiumRouter.get(
  "/transaction/:signature",
  handle(async (req, res) => {
    const network = parseNetwork(req.query.network);
    const mint = parseKey(req.query.mint, "mint");
    const connection = connectionFor(network);
    const tx = await connection.getTransaction(req.params.signature, { maxSupportedTransactionVersion: 0, commitment: "confirmed" });
    if (!tx || !tx.meta) {
      res.json({ status: "not_found" });
      return;
    }
    const keys = tx.transaction.message.getAccountKeys({ accountKeysFromLookups: tx.meta.loadedAddresses });
    const all = Array.from({ length: keys.length }, (_, i) => keys.get(i)!.toBase58());
    const { programId } = CPMM[network];
    const poolId = poolAddress(network, mint);
    const vault = (m: PublicKey) => getPdaVault(programId, poolId, m).publicKey.toBase58();
    const delta = (account: string) => {
      const index = all.indexOf(account);
      if (index < 0) return { delta: "0", created: false };
      const pre = tx.meta!.preTokenBalances?.find((b) => b.accountIndex === index);
      const post = tx.meta!.postTokenBalances?.find((b) => b.accountIndex === index);
      const before = BigInt(pre?.uiTokenAmount.amount ?? "0");
      const after = BigInt(post?.uiTokenAmount.amount ?? "0");
      return { delta: (after - before).toString(), created: !pre && Boolean(post) };
    };
    const tokenVault = delta(vault(mint));
    const solVault = delta(vault(NATIVE_MINT));
    // LP newly held by the lock authority for this pool's LP mint.
    const lpMint = getPdaLpMint(programId, poolId).publicKey.toBase58();
    const lockAuthority = CPMM[network].lockAuthority.toBase58();
    const lockedBalance = (balances: typeof tx.meta.postTokenBalances) =>
      (balances ?? [])
        .filter((b) => b.mint === lpMint && b.owner === lockAuthority)
        .reduce((sum, b) => sum + BigInt(b.uiTokenAmount.amount), 0n);
    const lockedDelta = lockedBalance(tx.meta.postTokenBalances) - lockedBalance(tx.meta.preTokenBalances);
    res.json({
      status: tx.meta.err ? "failed" : "success",
      feePayer: all[0],
      cpmmInvoked: all.includes(programId.toBase58()),
      lockInvoked: all.includes(CPMM[network].lockProgramId.toBase58()),
      lockedDelta: lockedDelta.toString(),
      poolId: poolId.toBase58(),
      tokenDelta: tokenVault.delta,
      solDelta: solVault.delta,
      poolCreated: tokenVault.created && solVault.created,
    });
  }),
);
