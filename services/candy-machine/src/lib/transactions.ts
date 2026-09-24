import type { TransactionBuilder } from "@metaplex-foundation/umi";

// Shared by every route that hands a partially-signed transaction back for
// the user's own wallet to finish signing (routes/candyMachine.ts,
// routes/token.ts).
export async function serializeSigned(umi: Parameters<TransactionBuilder["buildAndSign"]>[0], builder: TransactionBuilder): Promise<string> {
  // Force v0 explicitly rather than relying on Umi's default — the frontend
  // deserializes with @solana/web3.js's VersionedTransaction, which needs a
  // consistent, known wire format rather than "whatever Umi defaults to".
  //
  // setLatestBlockhash(umi) fetches ONE blockhash right now, at the moment
  // this function runs — and whatever ephemeral signer the caller attached
  // to `builder` (see generateSigner() calls in routes/) signs over that
  // blockhash immediately in buildAndSign(). That signature can't be
  // "refreshed" later: the ephemeral private key exists only in this
  // process's memory for the duration of this one request and is discarded
  // right after. This is exactly why routes/candyMachine.ts's /prepare-collection and
  // /prepare-candy-machine are two separate endpoints, called
  // sequentially by the frontend with a real wallet confirmation in
  // between, instead of one call building everything up front — see
  // docs/CANDY_MACHINE_BLOCKHASH_FIX_SPEC.md for the full writeup of the
  // bug this fixes and why a durable-nonce approach was rejected.
  const withBlockhash = await builder.useV0().setLatestBlockhash(umi);
  const transaction = await withBlockhash.buildAndSign(umi);
  return Buffer.from(umi.transactions.serialize(transaction)).toString("base64");
}
