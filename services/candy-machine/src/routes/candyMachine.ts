import { Router } from "express";
import {
  generateSigner,
  publicKey,
  sol,
  type TransactionBuilder,
} from "@metaplex-foundation/umi";
import { createCollection, ruleSet } from "@metaplex-foundation/mpl-core";
import { addConfigLines, create, fetchCandyMachine, mintV1, mplCandyMachine } from "@metaplex-foundation/mpl-core-candy-machine";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";

import { createUmiForCreator, createUmiForWallet, isSolanaNetwork, SOLANA_NETWORKS } from "../lib/umi.js";

export const candyMachineRouter = Router();

// Real limit, not a guess — see docs/REBUILD_PROGRESS.md's Candy Machine
// entry. Mirrors the NFT generator's own MAX_ITEMS_PER_GENERATE_CALL cap
// (backend/app/services/nft_generation.py): a modest, documented ceiling
// rather than trying to support arbitrary-size drops in a first pass.
const MAX_ITEMS = 20;

interface PrepareItem {
  name: string;
  uri: string;
}

interface PrepareBody {
  network?: string;
  creatorPublicKey?: string;
  collectionName?: string;
  collectionSymbol?: string;
  collectionMetadataUri?: string;
  sellerFeeBasisPoints?: number;
  items?: PrepareItem[];
  priceSol?: number;
  goLiveDate?: string;
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

async function serializeSigned(umi: Parameters<TransactionBuilder["buildAndSign"]>[0], builder: TransactionBuilder): Promise<string> {
  // Force v0 explicitly rather than relying on Umi's default — the frontend
  // deserializes with @solana/web3.js's VersionedTransaction, which needs a
  // consistent, known wire format rather than "whatever Umi defaults to".
  const withBlockhash = await builder.useV0().setLatestBlockhash(umi);
  const transaction = await withBlockhash.buildAndSign(umi);
  return Buffer.from(umi.transactions.serialize(transaction)).toString("base64");
}

// Builds the (partially-signed) transactions needed to launch a real Candy
// Machine: create the Collection NFT, create the Candy Machine with a
// solPayment + startDate guard, and insert the config lines (one per item).
// Every transaction here is signed by this service's own freshly-generated,
// single-use, in-memory-only ephemeral account keypairs (collectionMint,
// candyMachine — required because those are brand-new on-chain accounts,
// same pattern every real Candy Machine tool uses) PLUS a *noop* signer for
// the creator's wallet, which leaves that signature slot empty. This
// service never holds the creator's key and never gains ongoing authority
// over the collection/candy machine — the creator's own connected wallet
// signs the missing slot client-side before anything gets sent. See
// docs/REBUILD_PROGRESS.md for why this signer model was chosen over a
// platform-held authority keypair.
candyMachineRouter.post("/prepare", async (req, res) => {
  const body = req.body as PrepareBody;

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
  if (!body.items || body.items.length === 0) {
    res.status(400).json({ error: "items must be a non-empty array" });
    return;
  }
  if (body.items.length > MAX_ITEMS) {
    res.status(400).json({ error: `at most ${MAX_ITEMS} items are supported per candy machine right now` });
    return;
  }
  if (!body.priceSol || body.priceSol <= 0) {
    res.status(400).json({ error: "priceSol must be a positive number" });
    return;
  }
  if (!body.goLiveDate) {
    res.status(400).json({ error: "goLiveDate is required" });
    return;
  }

  try {
    const umi = createUmiForCreator(body.network, body.creatorPublicKey);
    const creator = umi.identity;
    const sellerFeeBasisPoints = body.sellerFeeBasisPoints ?? 500;

    // Core Assets don't carry per-item symbol/royalties/creators/edition
    // settings the way Token Metadata NFTs did (that's why `symbol`,
    // `sellerFeeBasisPoints`, `maxEditionSupply`, `isMutable`, and `creators`
    // are gone from the candy machine call below) — royalties+creators now
    // live once on the Collection itself via the Royalties plugin.
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
    const collectionTx = await serializeSigned(umi, collectionBuilder);

    const candyMachine = generateSigner(umi);
    const maxNameLength = Math.max(...body.items.map((item) => utf8Length(item.name)));
    const maxUriLength = Math.max(...body.items.map((item) => utf8Length(item.uri)));

    const candyMachineBuilder = await create(umi, {
      candyMachine,
      collection: collectionMint.publicKey,
      collectionUpdateAuthority: creator,
      itemsAvailable: body.items.length,
      configLineSettings: {
        prefixName: "",
        nameLength: maxNameLength,
        prefixUri: "",
        uriLength: maxUriLength,
        isSequential: false,
      },
      guards: {
        solPayment: { lamports: sol(body.priceSol), destination: creator.publicKey },
        startDate: { date: body.goLiveDate },
      },
      groups: [],
    });

    const configLinesBuilder = addConfigLines(umi, {
      candyMachine: candyMachine.publicKey,
      authority: creator,
      index: 0,
      configLines: body.items,
    });

    // Pack config lines into the same transaction as the create instruction
    // when it fits (small drops, the common case at this item cap); split
    // into a separate transaction otherwise rather than guessing. Each is
    // independently valid — inserting config lines is a distinct, retryable
    // action, not something that leaves a "half-created" account if it runs
    // in its own transaction.
    const combined = candyMachineBuilder.add(configLinesBuilder);
    const candyMachineTransactions: string[] = [];
    if (combined.fitsInOneTransaction(umi)) {
      candyMachineTransactions.push(await serializeSigned(umi, combined));
    } else {
      candyMachineTransactions.push(await serializeSigned(umi, candyMachineBuilder));
      candyMachineTransactions.push(await serializeSigned(umi, configLinesBuilder));
    }

    res.json({
      collection_mint: collectionMint.publicKey,
      candy_machine: candyMachine.publicKey,
      transactions: [collectionTx, ...candyMachineTransactions],
    });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to build candy machine transactions" });
  }
});

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
    const umi = createUmi(SOLANA_NETWORKS[network]).use(mplCandyMachine());
    const account = await fetchCandyMachine(umi, publicKey(req.params.candyMachineId));
    const itemsAvailable = Number(account.data.itemsAvailable);
    const itemsRedeemed = Number(account.itemsRedeemed);
    res.json({
      items_available: itemsAvailable,
      items_redeemed: itemsRedeemed,
      items_remaining: Math.max(itemsAvailable - itemsRedeemed, 0),
    });
  } catch (error) {
    res.status(404).json({ error: error instanceof Error ? error.message : "Candy machine not found on-chain" });
  }
});

interface MintBody {
  network?: string;
  minterPublicKey?: string;
  collectionMint?: string;
  creatorPublicKey?: string;
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

  try {
    const umi = createUmiForWallet(body.network, body.minterPublicKey);
    const asset = generateSigner(umi);

    const builder = mintV1(umi, {
      candyMachine: publicKey(req.params.candyMachineId),
      asset,
      collection: publicKey(body.collectionMint),
      mintArgs: {
        solPayment: { destination: publicKey(body.creatorPublicKey) },
      },
    });

    const transaction = await serializeSigned(umi, builder);
    res.json({ transaction, nft_mint: asset.publicKey });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to build mint transaction" });
  }
});
