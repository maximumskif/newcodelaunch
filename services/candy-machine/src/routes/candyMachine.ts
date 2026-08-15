import { Router } from "express";
import {
  generateSigner,
  percentAmount,
  sol,
  type TransactionBuilder,
} from "@metaplex-foundation/umi";
import { createNft, TokenStandard } from "@metaplex-foundation/mpl-token-metadata";
import { addConfigLines, create } from "@metaplex-foundation/mpl-candy-machine";

import { createUmiForCreator, isSolanaNetwork, toPublicKey } from "../lib/umi.js";

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
    const sellerFee = percentAmount((body.sellerFeeBasisPoints ?? 500) / 100, 2);

    const collectionMint = generateSigner(umi);
    const collectionBuilder = createNft(umi, {
      mint: collectionMint,
      authority: creator,
      payer: creator,
      updateAuthority: creator,
      tokenOwner: creator.publicKey,
      name: body.collectionName,
      symbol: body.collectionSymbol,
      uri: body.collectionMetadataUri,
      sellerFeeBasisPoints: sellerFee,
      isCollection: true,
    });
    const collectionTx = await serializeSigned(umi, collectionBuilder);

    const candyMachine = generateSigner(umi);
    const maxNameLength = Math.max(...body.items.map((item) => utf8Length(item.name)));
    const maxUriLength = Math.max(...body.items.map((item) => utf8Length(item.uri)));

    const candyMachineBuilder = await create(umi, {
      candyMachine,
      collectionMint: collectionMint.publicKey,
      collectionUpdateAuthority: creator,
      itemsAvailable: body.items.length,
      symbol: body.collectionSymbol,
      sellerFeeBasisPoints: sellerFee,
      maxEditionSupply: 0,
      isMutable: true,
      creators: [{ address: creator.publicKey, verified: false, percentageShare: 100 }],
      configLineSettings: {
        prefixName: "",
        nameLength: maxNameLength,
        prefixUri: "",
        uriLength: maxUriLength,
        isSequential: false,
      },
      tokenStandard: TokenStandard.NonFungible,
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
