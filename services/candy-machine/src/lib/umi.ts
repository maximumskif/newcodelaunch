import { createNoopSigner, publicKey, type PublicKey, type Umi } from "@metaplex-foundation/umi";
import { createUmi } from "@metaplex-foundation/umi-bundle-defaults";
import { mplCandyMachine } from "@metaplex-foundation/mpl-candy-machine";
import { mplTokenMetadata } from "@metaplex-foundation/mpl-token-metadata";

// Testnet-first, same policy as the EVM side (see backend/app/services/blockchain.py) —
// devnet is the default network id; mainnet-beta requires the caller to say so explicitly.
// Public RPC endpoints are the default, same trade-off as the EVM side: fine
// for dev, override with a dedicated provider (Helius/QuickNode/etc) via env
// before doing anything at real volume.
export const SOLANA_NETWORKS = {
  devnet: process.env.SOLANA_DEVNET_RPC_URL ?? "https://api.devnet.solana.com",
  "mainnet-beta": process.env.SOLANA_MAINNET_RPC_URL ?? "https://api.mainnet-beta.solana.com",
} as const;

export type SolanaNetwork = keyof typeof SOLANA_NETWORKS;

export function isSolanaNetwork(value: string): value is SolanaNetwork {
  return value in SOLANA_NETWORKS;
}

/**
 * Builds a Umi instance whose identity/payer is a *noop* signer for the
 * given wallet — it can be used to construct transactions naming that
 * wallet as authority/payer, but it can never actually sign anything.
 * That's the whole point: this service never holds anyone's key (creator
 * or buyer), it only builds transactions for that wallet to sign
 * client-side (see services/candy-machine's auth middleware doc comment,
 * and docs/REBUILD_PROGRESS.md's Candy Machine signer-model decision).
 */
export function createUmiForWallet(network: SolanaNetwork, walletPublicKey: string): Umi {
  const umi = createUmi(SOLANA_NETWORKS[network]).use(mplCandyMachine()).use(mplTokenMetadata());
  const wallet = createNoopSigner(publicKey(walletPublicKey));
  umi.identity = wallet;
  umi.payer = wallet;
  return umi;
}

// Kept as a distinct name at call sites (candyMachine.ts's /prepare route)
// purely for readability — same generic noop-signer wallet umi underneath.
export const createUmiForCreator = createUmiForWallet;

export function toPublicKey(value: string): PublicKey {
  return publicKey(value);
}
