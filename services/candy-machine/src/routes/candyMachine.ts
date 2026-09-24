import { Router } from "express";
import { generateSigner, none, publicKey, sol, some, type PublicKey, type TransactionBuilder } from "@metaplex-foundation/umi";
import { setComputeUnitLimit } from "@metaplex-foundation/mpl-toolbox";
import { createCollection, ruleSet } from "@metaplex-foundation/mpl-core";
import {
  addConfigLines,
  create,
  fetchCandyGuard,
  fetchCandyMachine,
  getMerkleProof,
  updateCandyGuard,
  getMerkleRoot,
  mintV1,
  mplCandyMachine,
  route,
  safeFetchMintCounterFromSeeds,
} from "@metaplex-foundation/mpl-core-candy-machine";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

import { serializeSigned } from "../lib/transactions.js";
import { createUmiForCreator, createUmiForWallet, isSolanaNetwork, SOLANA_NETWORKS } from "../lib/umi.js";

export const candyMachineRouter = Router();

// The NFT generator's own per-collection ceiling. Drops this big work
// because items are stored compactly (see prepare-candy-machine) and loaded
// in batches after creation (prepare-config-lines) — ~55 items per
// transaction, so 10,000 is ~180 transactions, signed a batch at a time.
const MAX_ITEMS = 10_000;

// Token Metadata/Core name and URI limits, which the Candy Machine applies
// to prefix + per-item suffix.
const MAX_ITEM_NAME_BYTES = 32;
const MAX_ITEM_URI_BYTES = 200;

// Adding config lines is compute-heavy: a transaction full of them (by
// size) blew through the default 200k compute units on a real validator.
// Every creation/loading transaction asks for Solana's per-tx maximum.
const COMPUTE_UNITS = 1_400_000;

// Wallets approve batches with one prompt (signAllTransactions); a cap per
// request keeps any one prompt — and its blockhashes' ~60-90s lifetime —
// manageable. The frontend just asks again for the next batch.
const MAX_CONFIG_LINE_TRANSACTIONS = 20;

// An item's on-chain entry is only its suffix: its 1-based position, and
// that position's file in the collection's pinned metadata folder. The
// Candy Machine stores the shared name prefix and folder URI once.
function configLine(position: number) {
  return { name: String(position), uri: `${position}.json` };
}

// Greedily packs config lines from `fromIndex` into as few transactions as
// fit (size-wise, with the compute-limit instruction included), up to
// `maxTransactions`.
function configLineBatches(
  umi: ReturnType<typeof createUmiForCreator>,
  candyMachine: PublicKey,
  fromIndex: number,
  total: number,
  maxTransactions: number,
  first?: TransactionBuilder,
) {
  const builders: { builder: TransactionBuilder; to: number }[] = [];
  let index = fromIndex;
  let base = first;
  while (index < total && builders.length < maxTransactions) {
    const start = base ?? setComputeUnitLimit(umi, { units: COMPUTE_UNITS });
    const lines = (count: number) =>
      addConfigLines(umi, {
        candyMachine,
        index,
        configLines: Array.from({ length: count }, (_, i) => configLine(index + i + 1)),
      });
    let count = 0;
    while (index + count < total && start.add(lines(count + 1)).fitsInOneTransaction(umi)) count++;
    if (count === 0) {
      if (base) {
        // The creation transaction itself had no room left for any lines.
        builders.push({ builder: base, to: index });
        base = undefined;
        continue;
      }
      throw new Error("A single config line doesn't fit in a transaction");
    }
    builders.push({ builder: start.add(lines(count)), to: index + count });
    index += count;
    base = undefined;
  }
  if (base) builders.push({ builder: base, to: index });
  return builders;
}

// Allowlist phase (guard groups): a modest cap, same spirit as MAX_ITEMS.
// Proof size grows with log2(list size), so 2,000 wallets is an 11-hash
// proof — comfortably inside one mint transaction with the route call.
const MAX_ALLOWLIST = 2000;

// Guard group labels (the program caps a label at 6 bytes). A drop with an
// allowlist has exactly these two groups; one without has none and keeps
// its price/start date in the default guard set, exactly as before.
export const ALLOWLIST_GROUP = "wl";
export const PUBLIC_GROUP = "pub";

// Optional per-wallet mint limit, drop-wide. It always lives in the
// DEFAULT guard set, which the program applies to every group: one counter
// covers both phases, so a wallet's allowlist and public mints count
// against one limit. (Putting the same id in each group is rejected by the
// program — DuplicatedMintLimitId, found by probing a real validator — and
// separate ids per group would reset the count when public opens.)
const MINT_LIMIT_ID = 1;
const MAX_MINT_LIMIT = 65535; // the guard stores the limit as a u16

function mintLimitProblem(mintLimit: unknown): string | null {
  if (mintLimit === undefined || mintLimit === null) return null;
  return Number.isInteger(mintLimit) && (mintLimit as number) >= 1 && (mintLimit as number) <= MAX_MINT_LIMIT
    ? null
    : `mintLimit must be a whole number between 1 and ${MAX_MINT_LIMIT}`;
}

interface AllowlistPhase {
  addresses?: string[];
  priceSol?: number;
  startDate?: string;
}

function isValidPriceSol(value: unknown): value is number {
  // See the priceSol comment in /prepare-candy-machine for why these bounds.
  return typeof value === "number" && Number.isFinite(value) && value >= 0.000001 && value <= 1_000_000;
}

// Validates an allowlist phase against the public start date; returns an
// error message, or null if it's usable.
function allowlistProblem(allowlist: AllowlistPhase, publicStart: string): string | null {
  const addresses = allowlist.addresses;
  if (!Array.isArray(addresses) || addresses.length === 0) return "allowlist.addresses must be a non-empty array";
  if (addresses.length > MAX_ALLOWLIST) return `allowlist.addresses supports at most ${MAX_ALLOWLIST} wallets`;
  if (new Set(addresses).size !== addresses.length) return "allowlist.addresses must not contain duplicates";
  for (const address of addresses) {
    try {
      publicKey(address);
    } catch {
      return `allowlist.addresses contains an invalid wallet address: ${String(address).slice(0, 60)}`;
    }
  }
  if (!isValidPriceSol(allowlist.priceSol)) return "allowlist.priceSol must be a number between 0.000001 and 1,000,000";
  const start = Date.parse(allowlist.startDate ?? "");
  const end = Date.parse(publicStart);
  if (Number.isNaN(start)) return "allowlist.startDate must be a valid date";
  if (!(start < end)) return "allowlist.startDate must be before the public goLiveDate";
  return null;
}

// The drop's whole guard configuration — shared by creation and
// /:id/prepare-update, so a launch and a later edit with the same inputs
// produce the same on-chain config (and the backend's read-back check has
// exactly one shape to match). With an allowlist: two groups — the
// allowlist phase (merkle-root allowList + its own price, open from its
// start date until the public start) and the public phase — and nothing
// but the optional mint limit in the default set, so every mint must name
// a group. Without: price, start date (and mint limit) in the default set,
// no groups.
function buildGuardConfig(
  creator: PublicKey,
  priceSol: number,
  goLiveDate: string,
  allowlist?: AllowlistPhase,
  mintLimit?: number | null,
) {
  const limit = mintLimit ? { mintLimit: { id: MINT_LIMIT_ID, limit: mintLimit } } : {};
  if (!allowlist) {
    return {
      guards: {
        solPayment: { lamports: sol(priceSol), destination: creator },
        startDate: { date: goLiveDate },
        ...limit,
      },
      groups: [],
    };
  }
  return {
    guards: { ...limit },
    groups: [
      {
        label: ALLOWLIST_GROUP,
        guards: {
          allowList: { merkleRoot: getMerkleRoot(allowlist.addresses!) },
          solPayment: { lamports: sol(allowlist.priceSol!), destination: creator },
          startDate: { date: allowlist.startDate! },
          endDate: { date: goLiveDate },
        },
      },
      {
        label: PUBLIC_GROUP,
        guards: {
          solPayment: { lamports: sol(priceSol), destination: creator },
          startDate: { date: goLiveDate },
        },
      },
    ],
  };
}

// "Present in Umi's Option" -> plain value or null, for JSON responses.
function unwrap<T>(option: { __option: "Some"; value: T } | { __option: "None" }): T | null {
  return option.__option === "Some" ? option.value : null;
}

interface PrepareCollectionBody {
  network?: string;
  creatorPublicKey?: string;
  collectionName?: string;
  collectionSymbol?: string;
  collectionMetadataUri?: string;
  sellerFeeBasisPoints?: number;
}

interface PrepareCandyMachineBody {
  network?: string;
  creatorPublicKey?: string;
  collectionMint?: string;
  itemsCount?: number;
  // Shared by every item: "<collection name> #" and the metadata folder's
  // "ipfs://<cid>/". Each item adds only its number and "<number>.json".
  namePrefix?: string;
  uriPrefix?: string;
  priceSol?: number;
  goLiveDate?: string;
  allowlist?: AllowlistPhase;
  mintLimit?: number | null;
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

// Two-step launch flow (see docs/CANDY_MACHINE_BLOCKHASH_FIX_SPEC.md for the
// full design rationale). Both steps sign with this service's own
// freshly-generated, single-use, in-memory-only ephemeral account keypairs
// (collectionMint here, candyMachine in the next route — required because
// those are brand-new on-chain accounts, same pattern every real Candy
// Machine tool uses) PLUS a *noop* signer for the creator's wallet, which
// leaves that signature slot empty. This service never holds the creator's
// key and never gains ongoing authority over the collection/candy machine —
// the creator's own connected wallet signs the missing slot client-side
// before anything gets sent. See docs/REBUILD_PROGRESS.md for why this
// signer model was chosen over a platform-held authority keypair.
//
// Step 1: the Collection NFT only. Doesn't need items/priceSol/goLiveDate —
// those only matter to the Candy Machine creation in step 2 below.
candyMachineRouter.post("/prepare-collection", async (req, res) => {
  const body = req.body as PrepareCollectionBody;

  if (!body.network || !isSolanaNetwork(body.network)) {
    res.status(400).json({ error: `network must be one of: devnet, mainnet-beta` });
    return;
  }
  if (!body.creatorPublicKey) {
    res.status(400).json({ error: "creatorPublicKey is required" });
    return;
  }
  if (!body.collectionName || !body.collectionSymbol || !body.collectionMetadataUri) {
    res.status(400).json({ error: "collectionName, collectionSymbol and collectionMetadataUri are required" });
    return;
  }
  if (
    body.sellerFeeBasisPoints !== undefined &&
    (!Number.isInteger(body.sellerFeeBasisPoints) || body.sellerFeeBasisPoints < 0 || body.sellerFeeBasisPoints > 10000)
  ) {
    // 0-10000 basis points (0-100%) is the Royalties plugin's own valid
    // range — out-of-range values previously reached it unvalidated and
    // failed on-chain instead of with a clean 400 up front, wasting a
    // wallet approval to find out.
    res.status(400).json({ error: "sellerFeeBasisPoints must be an integer between 0 and 10000" });
    return;
  }

  try {
    const umi = createUmiForCreator(body.network, body.creatorPublicKey);
    const creator = umi.identity;
    const sellerFeeBasisPoints = body.sellerFeeBasisPoints ?? 500;

    // Core Assets don't carry per-item symbol/royalties/creators/edition
    // settings the way Token Metadata NFTs did (that's why `symbol`,
    // `sellerFeeBasisPoints`, `maxEditionSupply`, `isMutable`, and `creators`
    // are gone from the candy machine call in the next route) — royalties
    // and creators now live once on the Collection itself via the
    // Royalties plugin.
    const collectionMint = generateSigner(umi);
    const collectionBuilder = createCollection(umi, {
      collection: collectionMint,
      name: body.collectionName,
      uri: body.collectionMetadataUri,
      plugins: [
        {
          type: "Royalties",
          basisPoints: sellerFeeBasisPoints,
          creators: [{ address: creator.publicKey, percentage: 100 }],
          ruleSet: ruleSet("None"),
        },
      ],
    });
    const transaction = await serializeSigned(umi, collectionBuilder);

    res.json({ collection_mint: collectionMint.publicKey, transaction });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to build collection transaction" });
  }
});

// Step 2: Candy Machine creation + config lines, against an already-created
// `collectionMint` from step 1 above. Called by the frontend only after the
// step-1 transaction has been signed, sent, AND confirmed — so the
// ephemeral signer and the blockhash below are generated right before this
// step's own wallet prompt, not minutes earlier alongside step 1's. That
// gap is the actual fix: previously both steps were built together in one
// call, so a slow approval on step 1 could expire step 2's baked-in
// blockhash before it was ever submitted.
candyMachineRouter.post("/prepare-candy-machine", async (req, res) => {
  const body = req.body as PrepareCandyMachineBody;

  if (!body.network || !isSolanaNetwork(body.network)) {
    res.status(400).json({ error: `network must be one of: devnet, mainnet-beta` });
    return;
  }
  if (!body.creatorPublicKey) {
    res.status(400).json({ error: "creatorPublicKey is required" });
    return;
  }
  if (!body.collectionMint) {
    res.status(400).json({ error: "collectionMint is required" });
    return;
  }
  if (!Number.isInteger(body.itemsCount) || body.itemsCount! < 1 || body.itemsCount! > MAX_ITEMS) {
    res.status(400).json({ error: `itemsCount must be a whole number from 1 to ${MAX_ITEMS}` });
    return;
  }
  const itemsCount = body.itemsCount!;
  if (typeof body.namePrefix !== "string" || typeof body.uriPrefix !== "string" || !body.uriPrefix) {
    res.status(400).json({ error: "namePrefix and uriPrefix are required" });
    return;
  }
  const nameLength = String(itemsCount).length;
  const uriLength = `${itemsCount}.json`.length;
  if (utf8Length(body.namePrefix) + nameLength > MAX_ITEM_NAME_BYTES) {
    res.status(400).json({ error: `item names ("${body.namePrefix}${itemsCount}") must be at most ${MAX_ITEM_NAME_BYTES} bytes` });
    return;
  }
  if (utf8Length(body.uriPrefix) + uriLength > MAX_ITEM_URI_BYTES) {
    res.status(400).json({ error: `item URIs must be at most ${MAX_ITEM_URI_BYTES} bytes` });
    return;
  }
  // Beyond just ">0": Umi's sol() -> createAmountFromDecimals does
  // `multiplier.toString().split('.')` then `BigInt(...)` on the pieces.
  // JS numbers print in exponential notation ("1e-7") outside roughly
  // [1e-6, 1e21) — BigInt() can't parse that, so a value like 0.0000001
  // (still > 0, passing the old check) crashed with a raw SDK
  // SyntaxError instead of a clean validation error. These bounds are also
  // a reasonable sanity range for an actual mint price, not just a
  // workaround for the notation quirk.
  if (
    typeof body.priceSol !== "number" ||
    !Number.isFinite(body.priceSol) ||
    body.priceSol < 0.000001 ||
    body.priceSol > 1_000_000
  ) {
    res.status(400).json({ error: "priceSol must be a number between 0.000001 and 1,000,000" });
    return;
  }
  if (!body.goLiveDate) {
    res.status(400).json({ error: "goLiveDate is required" });
    return;
  }
  if (body.allowlist !== undefined) {
    const problem = allowlistProblem(body.allowlist, body.goLiveDate);
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }
  }
  const limitProblem = mintLimitProblem(body.mintLimit);
  if (limitProblem) {
    res.status(400).json({ error: limitProblem });
    return;
  }

  try {
    const umi = createUmiForCreator(body.network, body.creatorPublicKey);
    const creator = umi.identity;

    const candyMachine = generateSigner(umi);
    const candyMachineBuilder = await create(umi, {
      candyMachine,
      collection: publicKey(body.collectionMint),
      collectionUpdateAuthority: creator,
      itemsAvailable: itemsCount,
      configLineSettings: {
        prefixName: body.namePrefix,
        nameLength,
        prefixUri: body.uriPrefix,
        uriLength,
        isSequential: false,
      },
      ...buildGuardConfig(creator.publicKey, body.priceSol, body.goLiveDate, body.allowlist, body.mintLimit),
    });

    // The creation transaction carries as many items as still fit; the
    // rest load afterwards via prepare-config-lines, a batch per wallet
    // prompt. Only this one transaction is signed by the ephemeral
    // candyMachine key, so only this one is time-critical — later batches
    // are built fresh on request, from the chain's own itemsLoaded count.
    const [first] = configLineBatches(
      umi,
      candyMachine.publicKey,
      0,
      itemsCount,
      1,
      setComputeUnitLimit(umi, { units: COMPUTE_UNITS }).add(candyMachineBuilder),
    );
    const transactions = [await serializeSigned(umi, first.builder)];

    res.json({ candy_machine: candyMachine.publicKey, transactions, items_loaded: first.to });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to build candy machine transactions" });
  }
});

// Reads at "confirmed", not web3.js's default "finalized" — finalization
// trails confirmation by ~13s, so a drop the creator's wallet had just
// confirmed read as "not found" here for that long after launch (the
// e2e suite's storefront reload loop was working around exactly this).
// Same fix, for the same reason, as the backend's own Solana client
// (backend/app/services/blockchain.py's _get_solana_client).
const READ_COMMITMENT = "confirmed" as const;

// Live on-chain state for the public mint storefront (backend also stores
// price/go-live/creator data from launch time — that never changes, since
// there's no update-guard feature — but items_redeemed only exists
// on-chain and changes with every mint, so it's read fresh here rather than
// trusted from the backend's own DB). Read-only: no identity/payer needed,
// no noop-signer wallet involved.
candyMachineRouter.get("/:candyMachineId/status", async (req, res) => {
  const network = req.query.network;
  if (typeof network !== "string" || !isSolanaNetwork(network)) {
    res.status(400).json({ error: `network must be one of: devnet, mainnet-beta` });
    return;
  }

  try {
    const umi = createUmi(SOLANA_NETWORKS[network], READ_COMMITMENT).use(mplCandyMachine());
    const account = await fetchCandyMachine(umi, publicKey(req.params.candyMachineId));
    const itemsAvailable = Number(account.data.itemsAvailable);
    const itemsRedeemed = Number(account.itemsRedeemed);
    res.json({
      items_available: itemsAvailable,
      // How many items have actually been loaded (config lines) — a drop is
      // only complete once this equals items_available.
      items_loaded: account.itemsLoaded,
      items_redeemed: itemsRedeemed,
      items_remaining: Math.max(itemsAvailable - itemsRedeemed, 0),
    });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "Candy machine not found on-chain" });
  }
});

interface PrepareUpdateBody {
  network?: string;
  creatorPublicKey?: string;
  priceSol?: number;
  goLiveDate?: string;
  allowlist?: AllowlistPhase;
  mintLimit?: number | null;
}

// Edit a live drop's phases: replaces its whole guard configuration (public
// price/start, and adding, changing, or removing the allowlist phase) with
// what buildGuardConfig produces for the new inputs. The candy guard's
// authority is the creator's wallet — a noop signer here, like everywhere
// else in this service — so the creator signs this client-side; this
// service never gains the ability to change a drop. No ephemeral signer
// needed: nothing new is created.
candyMachineRouter.post("/:candyMachineId/prepare-update", async (req, res) => {
  const body = req.body as PrepareUpdateBody;

  if (!body.network || !isSolanaNetwork(body.network)) {
    res.status(400).json({ error: `network must be one of: devnet, mainnet-beta` });
    return;
  }
  if (!body.creatorPublicKey) {
    res.status(400).json({ error: "creatorPublicKey is required" });
    return;
  }
  if (!isValidPriceSol(body.priceSol)) {
    res.status(400).json({ error: "priceSol must be a number between 0.000001 and 1,000,000" });
    return;
  }
  if (!body.goLiveDate || Number.isNaN(Date.parse(body.goLiveDate))) {
    res.status(400).json({ error: "goLiveDate must be a valid date" });
    return;
  }
  if (body.allowlist !== undefined) {
    const problem = allowlistProblem(body.allowlist, body.goLiveDate);
    if (problem) {
      res.status(400).json({ error: problem });
      return;
    }
  }
  const limitProblem = mintLimitProblem(body.mintLimit);
  if (limitProblem) {
    res.status(400).json({ error: limitProblem });
    return;
  }

  try {
    const umi = createUmiForCreator(body.network, body.creatorPublicKey);
    const candyMachine = await fetchCandyMachine(umi, publicKey(req.params.candyMachineId), { commitment: READ_COMMITMENT });
    const builder = updateCandyGuard(umi, {
      candyGuard: candyMachine.mintAuthority,
      ...buildGuardConfig(umi.identity.publicKey, body.priceSol, body.goLiveDate, body.allowlist, body.mintLimit),
    });
    const transaction = await serializeSigned(umi, builder);
    res.json({ transaction });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to build guard update transaction" });
  }
});

interface ConfigLinesBody {
  network?: string;
  creatorPublicKey?: string;
}

// The next batch of item-loading transactions for a created Candy Machine.
// Where to resume and what to load both come from the chain — itemsLoaded,
// itemsAvailable — not from the caller, so an interrupted launch resumes
// exactly where it stopped. Signed by the creator (the machine's
// authority; anyone else is rejected on-chain).
candyMachineRouter.post("/:candyMachineId/prepare-config-lines", async (req, res) => {
  const body = req.body as ConfigLinesBody;
  if (!body.network || !isSolanaNetwork(body.network)) {
    res.status(400).json({ error: `network must be one of: devnet, mainnet-beta` });
    return;
  }
  if (!body.creatorPublicKey) {
    res.status(400).json({ error: "creatorPublicKey is required" });
    return;
  }
  try {
    const umi = createUmiForCreator(body.network, body.creatorPublicKey);
    const account = await fetchCandyMachine(umi, publicKey(req.params.candyMachineId), { commitment: READ_COMMITMENT });
    const total = Number(account.data.itemsAvailable);
    const batches = configLineBatches(umi, account.publicKey, account.itemsLoaded, total, MAX_CONFIG_LINE_TRANSACTIONS);
    const transactions = [];
    for (const batch of batches) transactions.push(await serializeSigned(umi, batch.builder));
    res.json({
      transactions,
      items_loaded: account.itemsLoaded,
      items_after: batches.length ? batches[batches.length - 1].to : account.itemsLoaded,
      items_available: total,
    });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to build config line transactions" });
  }
});

// How many times a wallet has minted from this drop, from the mintLimit
// guard's own on-chain counter (0 if it has never minted — the counter
// account only exists after a first mint). Read-only.
candyMachineRouter.get("/:candyMachineId/minted", async (req, res) => {
  const { network, wallet } = req.query;
  if (typeof network !== "string" || !isSolanaNetwork(network)) {
    res.status(400).json({ error: `network must be one of: devnet, mainnet-beta` });
    return;
  }
  if (typeof wallet !== "string" || !wallet) {
    res.status(400).json({ error: "wallet is required" });
    return;
  }

  try {
    const umi = createUmi(SOLANA_NETWORKS[network], READ_COMMITMENT).use(mplCandyMachine());
    const candyMachine = await fetchCandyMachine(umi, publicKey(req.params.candyMachineId));
    const counter = await safeFetchMintCounterFromSeeds(umi, {
      id: MINT_LIMIT_ID,
      user: publicKey(wallet),
      candyMachine: candyMachine.publicKey,
      candyGuard: candyMachine.mintAuthority,
    });
    res.json({ minted: counter ? counter.count : 0 });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "Candy machine not found on-chain" });
  }
});

// The drop's guard configuration as it actually is on-chain — the backend
// checks what a creator claims at record time against this, and never has
// to trust the client's word for prices, dates, or the allowlist.
candyMachineRouter.get("/:candyMachineId/guards", async (req, res) => {
  const network = req.query.network;
  if (typeof network !== "string" || !isSolanaNetwork(network)) {
    res.status(400).json({ error: `network must be one of: devnet, mainnet-beta` });
    return;
  }

  try {
    const umi = createUmi(SOLANA_NETWORKS[network], READ_COMMITMENT).use(mplCandyMachine());
    const candyMachine = await fetchCandyMachine(umi, publicKey(req.params.candyMachineId));
    const guard = await fetchCandyGuard(umi, candyMachine.mintAuthority);
    const describe = (guards: typeof guard.guards) => {
      const solPayment = unwrap(guards.solPayment);
      const startDate = unwrap(guards.startDate);
      const endDate = unwrap(guards.endDate);
      const allowList = unwrap(guards.allowList);
      const mintLimit = unwrap(guards.mintLimit);
      return {
        mint_limit: mintLimit ? mintLimit.limit : null,
        price_lamports: solPayment ? solPayment.lamports.basisPoints.toString() : null,
        payment_destination: solPayment ? solPayment.destination : null,
        start_date: startDate ? new Date(Number(startDate.date) * 1000).toISOString() : null,
        end_date: endDate ? new Date(Number(endDate.date) * 1000).toISOString() : null,
        merkle_root: allowList ? Buffer.from(allowList.merkleRoot).toString("hex") : null,
      };
    };
    res.json({
      default: describe(guard.guards),
      groups: guard.groups.map((group) => ({ label: group.label, ...describe(group.guards) })),
    });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "Candy guard not found on-chain" });
  }
});

// The merkle root of a wallet list, computed with the same SDK function the
// allowList guard was configured with — so the backend can compare a
// claimed allowlist against the root actually on-chain.
candyMachineRouter.post("/merkle-root", (req, res) => {
  const addresses = (req.body as { addresses?: unknown }).addresses;
  if (!Array.isArray(addresses) || addresses.length === 0 || !addresses.every((a) => typeof a === "string")) {
    res.status(400).json({ error: "addresses must be a non-empty array of strings" });
    return;
  }
  res.json({ merkle_root: Buffer.from(getMerkleRoot(addresses as string[])).toString("hex") });
});

interface MintBody {
  network?: string;
  minterPublicKey?: string;
  collectionMint?: string;
  creatorPublicKey?: string;
  // Set for a drop with phases: which guard group to mint through. For the
  // allowlist group, the full allowlist too, to build the minter's proof.
  group?: string;
  allowlist?: string[];
  // Set when the drop has a per-wallet mint limit: the guard needs its
  // counter id at mint time to find (and bump) this wallet's count.
  mintLimit?: boolean;
}

// Builds a buyer's mint transaction — the distinct "buy" flow deferred when
// /prepare above first shipped (see docs/REBUILD_PROGRESS.md). Same signer
// pattern as /prepare: a fresh, single-use, in-memory-only ephemeral
// signer for the brand-new NFT mint account, plus a noop signer for the
// buyer's own wallet (this service never holds the buyer's key either).
// No on-chain fetch is needed to build this: the guard's stored SOL amount
// is applied automatically by the on-chain program from what was set at
// creation, and the guard PDA is deterministically derived from
// `candyMachine` — `collectionMint` is the only account this instruction
// actually needs telling about beyond that, and it's exactly what the
// backend already has on file from the creator's own launch, so it's
// passed in rather than re-derived or re-fetched. `creatorPublicKey` is
// still required in the request body — it's where the guard's solPayment
// guard sends the mint price.
candyMachineRouter.post("/:candyMachineId/mint", async (req, res) => {
  const body = req.body as MintBody;

  if (!body.network || !isSolanaNetwork(body.network)) {
    res.status(400).json({ error: `network must be one of: devnet, mainnet-beta` });
    return;
  }
  if (!body.minterPublicKey) {
    res.status(400).json({ error: "minterPublicKey is required" });
    return;
  }
  if (!body.collectionMint || !body.creatorPublicKey) {
    res.status(400).json({ error: "collectionMint and creatorPublicKey are required" });
    return;
  }

  if (body.group !== undefined && body.group !== ALLOWLIST_GROUP && body.group !== PUBLIC_GROUP) {
    res.status(400).json({ error: `group must be "${ALLOWLIST_GROUP}" or "${PUBLIC_GROUP}"` });
    return;
  }
  if (body.group === ALLOWLIST_GROUP && (!Array.isArray(body.allowlist) || !body.allowlist.includes(body.minterPublicKey))) {
    res.status(400).json({ error: "minterPublicKey is not on this drop's allowlist" });
    return;
  }

  try {
    const umi = createUmiForWallet(body.network, body.minterPublicKey);
    const asset = generateSigner(umi);
    const candyMachine = publicKey(req.params.candyMachineId);
    const group = body.group ? some(body.group) : none<string>();
    const solPayment = { destination: publicKey(body.creatorPublicKey) as PublicKey };

    let builder = mintV1(umi, {
      candyMachine,
      asset,
      collection: publicKey(body.collectionMint),
      group,
      mintArgs: {
        solPayment,
        ...(body.group === ALLOWLIST_GROUP ? { allowList: { merkleRoot: getMerkleRoot(body.allowlist!) } } : {}),
        ...(body.mintLimit ? { mintLimit: { id: MINT_LIMIT_ID } } : {}),
      },
    });

    if (body.group === ALLOWLIST_GROUP) {
      // The allowList guard checks a proof PDA the route instruction
      // creates — prove membership first, in the same transaction.
      builder = route(umi, {
        candyMachine,
        guard: "allowList",
        group,
        routeArgs: {
          path: "proof",
          merkleRoot: getMerkleRoot(body.allowlist!),
          merkleProof: getMerkleProof(body.allowlist!, body.minterPublicKey),
        },
      }).add(builder);
    }

    const transaction = await serializeSigned(umi, builder);
    res.json({ transaction, nft_mint: asset.publicKey });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to build mint transaction" });
  }
});
