import { Router } from "express";
import { generateSigner, none, percentAmount, publicKey } from "@metaplex-foundation/umi";
import { createAndMint, mplTokenMetadata, TokenStandard } from "@metaplex-foundation/mpl-token-metadata";
import {
  AuthorityType,
  createIdempotentAssociatedToken,
  findAssociatedTokenPda,
  mintTokensTo,
  setAuthority,
} from "@metaplex-foundation/mpl-toolbox";

import { createUmiForWallet, isSolanaNetwork } from "../lib/umi.js";
import { serializeSigned } from "../lib/transactions.js";

export const tokenRouter = Router();

// Token Metadata's own on-chain limits (MAX_NAME_LENGTH / MAX_SYMBOL_LENGTH
// / MAX_URI_LENGTH in the program) — checked here so an over-long value
// fails with a clean 400 instead of an on-chain error after a wallet
// approval. Byte lengths, not character counts: the program measures UTF-8.
const MAX_NAME_BYTES = 32;
const MAX_SYMBOL_BYTES = 10;
const MAX_URI_BYTES = 200;
const MAX_DECIMALS = 9;
const U64_MAX = (1n << 64n) - 1n;

interface PrepareTokenBody {
  network?: string;
  creatorPublicKey?: string;
  name?: string;
  symbol?: string;
  metadataUri?: string;
  decimals?: number;
  // Raw base units (supply x 10^decimals) as a decimal string — a u64 can
  // exceed Number.MAX_SAFE_INTEGER, so it never travels as a JSON number.
  amount?: string;
  revokeMintAuthority?: boolean;
  revokeFreezeAuthority?: boolean;
}

function utf8Length(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

// A classic SPL token (Token program, not Token-2022) with Metaplex Token
// Metadata — still what wallets, explorers, and DEX aggregators read a
// fungible token's name/symbol/logo from. One transaction: create the mint
// + metadata account, mint the full initial supply into the creator's own
// associated token account, then (by default) revoke the mint authority so
// the supply is fixed forever, and the freeze authority — which Token
// Metadata's createV1 sets to the creator for a Fungible mint (confirmed
// against a real validator, not assumed), and which would let the creator
// freeze any holder's tokens; DEX aggregators and token scanners flag
// exactly that as a rug risk, and nothing in this app ever freezes. Same
// signer model as the Candy Machine routes: the only real signature this service adds is a single-use,
// in-memory ephemeral keypair for the brand-new mint account; the creator's
// wallet is a noop signer here and signs (and pays) client-side. Authority
// over the token — update authority on the metadata, and the mint
// authority if it isn't revoked — belongs to the creator's wallet, never to
// this service.
tokenRouter.post("/prepare", async (req, res) => {
  const body = req.body as PrepareTokenBody;

  if (!body.network || !isSolanaNetwork(body.network)) {
    res.status(400).json({ error: "network must be one of: devnet, mainnet-beta" });
    return;
  }
  if (!body.creatorPublicKey) {
    res.status(400).json({ error: "creatorPublicKey is required" });
    return;
  }
  if (!body.name || utf8Length(body.name) > MAX_NAME_BYTES) {
    res.status(400).json({ error: `name is required and must be at most ${MAX_NAME_BYTES} bytes` });
    return;
  }
  if (!body.symbol || utf8Length(body.symbol) > MAX_SYMBOL_BYTES) {
    res.status(400).json({ error: `symbol is required and must be at most ${MAX_SYMBOL_BYTES} bytes` });
    return;
  }
  const metadataUri = body.metadataUri ?? "";
  if (utf8Length(metadataUri) > MAX_URI_BYTES) {
    res.status(400).json({ error: `metadataUri must be at most ${MAX_URI_BYTES} bytes` });
    return;
  }
  if (!Number.isInteger(body.decimals) || body.decimals! < 0 || body.decimals! > MAX_DECIMALS) {
    res.status(400).json({ error: `decimals must be an integer between 0 and ${MAX_DECIMALS}` });
    return;
  }
  if (typeof body.amount !== "string" || !/^[1-9][0-9]*$/.test(body.amount) || BigInt(body.amount) > U64_MAX) {
    res.status(400).json({ error: "amount must be a positive integer string that fits in a u64" });
    return;
  }

  try {
    const umi = createUmiForWallet(body.network, body.creatorPublicKey).use(mplTokenMetadata());
    const creator = umi.identity;
    const mint = generateSigner(umi);

    let builder = createAndMint(umi, {
      mint,
      authority: creator,
      name: body.name,
      symbol: body.symbol,
      uri: metadataUri,
      // Fungible tokens don't pay royalties — this field only means
      // anything to NFT marketplaces. 0, not Token Metadata's NFT-oriented
      // habit of 5%.
      sellerFeeBasisPoints: percentAmount(0),
      decimals: body.decimals!,
      amount: BigInt(body.amount),
      tokenOwner: creator.publicKey,
      tokenStandard: TokenStandard.Fungible,
    });

    if (body.revokeMintAuthority !== false) {
      builder = builder.add(
        setAuthority(umi, {
          owned: mint.publicKey,
          owner: creator,
          authorityType: AuthorityType.MintTokens,
          newAuthority: none(),
        }),
      );
    }

    if (body.revokeFreezeAuthority !== false) {
      builder = builder.add(
        setAuthority(umi, {
          owned: mint.publicKey,
          owner: creator,
          authorityType: AuthorityType.FreezeAccount,
          newAuthority: none(),
        }),
      );
    }

    const transaction = await serializeSigned(umi, builder);
    res.json({ mint: mint.publicKey, transaction });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to build token transaction" });
  }
});

interface TokenActionBody {
  network?: string;
  authorityPublicKey?: string;
  action?: string;
  // Raw base units (for "mint"), as a decimal string — see PrepareTokenBody.
  amount?: string;
}

const TOKEN_ACTIONS = ["mint", "revokeMint", "revokeFreeze"] as const;

// Owner tools for a token launched here with an authority kept: mint more
// into the authority's own wallet, or give up the mint / freeze authority
// for good. The authority's wallet is a noop signer — it signs client-side,
// and the program rejects anyone who isn't the current authority. No
// ephemeral signer: nothing new is created (the authority's token account
// is created only if it no longer exists).
tokenRouter.post("/:mint/prepare-action", async (req, res) => {
  const body = req.body as TokenActionBody;

  if (!body.network || !isSolanaNetwork(body.network)) {
    res.status(400).json({ error: "network must be one of: devnet, mainnet-beta" });
    return;
  }
  if (!body.authorityPublicKey) {
    res.status(400).json({ error: "authorityPublicKey is required" });
    return;
  }
  if (!TOKEN_ACTIONS.includes(body.action as (typeof TOKEN_ACTIONS)[number])) {
    res.status(400).json({ error: `action must be one of: ${TOKEN_ACTIONS.join(", ")}` });
    return;
  }
  if (body.action === "mint" && (typeof body.amount !== "string" || !/^[1-9][0-9]*$/.test(body.amount) || BigInt(body.amount) > U64_MAX)) {
    res.status(400).json({ error: "amount must be a positive integer string that fits in a u64" });
    return;
  }

  try {
    const umi = createUmiForWallet(body.network, body.authorityPublicKey);
    const authority = umi.identity;
    const mint = publicKey(req.params.mint);

    const ata = findAssociatedTokenPda(umi, { mint, owner: authority.publicKey });
    const builder =
      body.action === "mint"
        ? // The standard ATA program's idempotent create (a no-op if the
          // account exists), not mpl-toolbox's createTokenIfMissing: that
          // routes through Metaplex's separate mplTokenExtras program — an
          // extra on-chain dependency for no benefit here, and absent from
          // a local validator (found by probing one).
          createIdempotentAssociatedToken(umi, { ata, owner: authority.publicKey, mint }).add(
            mintTokensTo(umi, { mint, token: ata, mintAuthority: authority, amount: BigInt(body.amount!) }),
          )
        : setAuthority(umi, {
            owned: mint,
            owner: authority,
            authorityType: body.action === "revokeMint" ? AuthorityType.MintTokens : AuthorityType.FreezeAccount,
            newAuthority: none(),
          });

    const transaction = await serializeSigned(umi, builder);
    res.json({ transaction });
  } catch (error) {
    res.status(502).json({ error: error instanceof Error ? error.message : "Failed to build token action transaction" });
  }
});
