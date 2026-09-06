# Candy Machine blockhash-expiry fix — implementation spec

Written 2026-09-05, not implemented. This is a precise, code-referenced spec
for the highest-value open fix on the Candy Machine surface (see
`docs/REBUILD_PROGRESS.md`'s second correctness-review-pass entry, and
`FEATURE_REGISTRY.md`'s Candy Machine rows). It's being handed off as a spec
rather than code because every prior Candy Machine change in this repo was
"verified for real against live devnet, not just typechecked" before being
trusted — this session has no funded devnet wallet or browser to meet that
same bar, and this is money-moving signing code. Implement this with that
verification available, not from typecheck alone.

## The problem, precisely

`services/candy-machine/src/routes/candyMachine.ts`'s `/prepare` route
builds up to 3 transactions in one call (`collectionTx`, then 1-2
`candyMachineTransactions` depending on whether config lines fit in the same
transaction as the create instruction — see `fitsInOneTransaction` at
`candyMachine.ts:161`). Each is finalized by `serializeSigned()`
(`candyMachine.ts:43-50`):

```ts
async function serializeSigned(umi, builder) {
  const withBlockhash = await builder.useV0().setLatestBlockhash(umi);
  const transaction = await withBlockhash.buildAndSign(umi);
  return Buffer.from(umi.transactions.serialize(transaction)).toString("base64");
}
```

`setLatestBlockhash(umi)` fetches **one** blockhash per call, at the moment
`/prepare` runs. `buildAndSign` immediately signs with whatever signers are
attached — for the collection/candy-machine transactions, that includes a
freshly `generateSigner(umi)`-created ephemeral keypair
(`candyMachine.ts:107`, `:123`) that exists only in this request's memory
and is discarded the instant the HTTP response is sent (see the module
docstring, `candyMachine.ts:52-64`, for why: this service must never retain
signing authority past the single transaction that needs it).

`frontend/src/features/mint/MintLaunchPage.tsx`'s launch loop then prompts
the wallet for each transaction **in sequence**, awaiting confirmation
before moving to the next. If a creator takes roughly a minute or more
across 2-3 wallet approvals (Solana's blockhash validity window is ~150
slots, roughly 60-90 seconds), a later transaction's baked-in blockhash can
expire before it's ever submitted.

**Why you can't just swap in a fresh blockhash and retry:** the ephemeral
signer's signature is computed over the whole message, blockhash included.
Changing the blockhash after the fact invalidates that signature — and the
ephemeral private key that produced it was never persisted anywhere and is
already gone by the time a retry would happen. Any fix has to generate the
ephemeral key and fetch the blockhash together, immediately before the
transaction is actually presented to the wallet — not minutes earlier in a
single upfront `/prepare` call.

## Option A — Solana durable nonces

Replace the recent-blockhash mechanism with a durable nonce account, whose
stored nonce value doesn't expire the way a recent blockhash does.

**What it requires:**
1. A new on-chain nonce account, created via `SystemProgram.createNonceAccount` — funded and owned by the **creator's** wallet (never this service, per the no-server-custody rule this app holds everywhere else). This is itself a transaction the creator must sign, and it locks a rent-exempt SOL balance in the account until it's later closed.
2. Every transaction that uses the nonce must include a `nonceAdvance` instruction as its *first* instruction, and use the nonce account's current stored value in place of `recentBlockhash`.
3. **The real complication**: advancing a nonce is a one-shot consumption — once any transaction referencing a given nonce value lands, that value rotates, invalidating every *other* pre-built transaction that also referenced it. A single nonce account can have exactly one pending transaction in flight at a time. This app's `/prepare` call needs to hand out 2-3 transactions at once (collection, candy machine [+ config lines]) — supporting that with durable nonces means **either**:
   - creating one nonce account per transaction in the sequence (2-3 nonce accounts, 2-3 extra creator-signed funding transactions before the flow even starts — worse UX than the problem being solved), or
   - restructuring the flow so only one transaction is ever "in flight" at a time (converges with Option B below, but with the added on-chain cost/complexity of nonce accounts for no extra benefit if you're restructuring anyway).
4. Nonce accounts should be closed (`nonceAdvance` + `SystemProgram` withdraw, or a dedicated close instruction) after use to return the locked rent to the creator — another step, another signature.

**Verdict:** technically correct, but adds real SOL cost and extra creator-facing approvals (funding + closing nonce accounts) to solve a problem that Option B solves without any new on-chain accounts. Only worth it if a future requirement specifically needs a transaction to remain valid for a long, unbounded time (e.g., an offline-signing flow) — not the case here.

## Option B — staged re-prepare (recommended)

Split `/prepare` into sequential, per-step calls, each generating its
ephemeral signer and fetching its blockhash immediately before that step is
handed to the wallet — so blockhash staleness is bounded by one wallet
approval, not the whole multi-step sequence.

**Sidecar (`services/candy-machine/src/routes/candyMachine.ts`):**
- `POST /internal/candy-machine/prepare-collection` — takes today's
  `collectionName`/`collectionSymbol`/`collectionMetadataUri`/
  `sellerFeeBasisPoints`/`creatorPublicKey`. Returns `{ collection_mint,
  transaction }` (today's `collectionTx` logic, unchanged internally —
  same ephemeral-signer-plus-noop-signer pattern, just its own endpoint).
- `POST /internal/candy-machine/prepare-candy-machine` — takes everything
  `/prepare` takes today *minus* the collection fields, *plus*
  `collectionMint` (the address returned by the step above, which the
  frontend now holds after that transaction's own confirmation). Builds
  and returns today's `candyMachineTransactions` logic, unchanged
  internally, with a **freshly fetched blockhash** at this later moment.
- Keep the existing `/prepare` as a thin wrapper calling both in sequence
  for any caller that doesn't need the staged behavor, or remove it if
  nothing else depends on the combined shape — check `grep` for other
  callers before deciding.

**Backend (`backend/app/services/candy_machine.py`):** `prepare_candy_machine`
currently makes one sidecar call and returns its result verbatim. Split into
`prepare_collection()` and `prepare_candy_machine_step()` mirroring the
sidecar's two endpoints — the validation currently in `prepare_candy_machine`
(published-items check, `MAX_ITEMS` pre-flight, IPFS collection-metadata
upload) belongs in the first step; item/price/go-live validation in the
second.

**Frontend (`frontend/src/features/mint/MintLaunchPage.tsx`):** today's
launch loop requests all transactions once, then signs+sends+confirms each
in a `for` loop. Change to: call `prepare-collection` → sign, send, confirm
that one transaction → **then** call `prepare-candy-machine` with the
confirmed `collection_mint` → sign, send, confirm. Each `prepare*` call now
happens right before its own wallet prompt, so the gap between "blockhash
fetched" and "blockhash submitted" is one wallet interaction, not the whole
flow.

**Cost of this option:** an extra backend/sidecar round trip between steps
(cheap, no new on-chain accounts, no extra creator-facing approvals beyond
what already exists), and a real API-contract change — `FEATURE_REGISTRY.md`
and `REBUILD_PROGRESS.md` both currently describe `/prepare` as a single
call; both need updating alongside the code, not after.

## Verification checklist before trusting this fix

Matching this project's own established standard for every prior Candy
Machine change (see `REBUILD_PROGRESS.md`'s "Verified for real against live
devnet, not just typechecked" entries):

- [ ] `tsc`/build clean on the sidecar and frontend (necessary, not sufficient).
- [ ] A real devnet run: generate a throwaway funded devnet wallet, click
      through the actual two-step launch flow in a browser, confirm both
      transactions land and `/status` shows the candy machine live.
- [ ] Deliberately introduce a delay between the two steps (e.g. pause 90+
      seconds between confirming the collection transaction and signing the
      candy-machine one) and confirm the second step's blockhash is still
      fresh — this is the actual regression case being fixed, not just the
      happy path.
- [ ] Confirm `record_candy_machine`'s existing idempotency/on-chain
      re-verification (see `docs/REBUILD_PROGRESS.md`'s 2026-08-19 entry)
      still behaves correctly against the new two-call shape.
