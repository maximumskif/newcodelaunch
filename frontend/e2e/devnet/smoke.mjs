// Real-network smoke test of the Solana flows — token launch, Candy Machine
// allowlist phase + per-wallet mint limit, editing a live drop — driven
// through the real backend API (run-stack.sh) with a real keypair, exactly
// as the browser would, minus the browser. The backend's own on-chain
// checks (record/verify steps) run against the real cluster, which is the
// point: they're the parts most sensitive to real-network timing.
//
//   node e2e/devnet/smoke.mjs --keypair ~/devnet.json            # devnet
//   node e2e/devnet/smoke.mjs --keypair k.json --airdrop \
//        --rpc http://127.0.0.1:8899                               # local
//
// Spends roughly 0.1 SOL of the keypair's devnet balance.
import { readFileSync } from 'node:fs'
import { parseArgs } from 'node:util'

import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'
import nacl from 'tweetnacl'

const { values: args } = parseArgs({
  options: {
    keypair: { type: 'string' },
    rpc: { type: 'string', default: 'https://api.devnet.solana.com' },
    api: { type: 'string', default: 'http://127.0.0.1:5100/api' },
    airdrop: { type: 'boolean', default: false },
  },
})
if (!args.keypair) throw new Error('--keypair <solana keypair json> is required')

const wallet = Keypair.fromSecretKey(Uint8Array.from(JSON.parse(readFileSync(args.keypair, 'utf8'))))
const me = wallet.publicKey.toBase58()
const connection = new Connection(args.rpc, 'confirmed')
const cluster = args.rpc.includes('devnet') ? '?cluster=devnet' : `?cluster=custom&customUrl=${encodeURIComponent(args.rpc)}`
const explorer = (kind, id) => `https://explorer.solana.com/${kind}/${id}${cluster}`
const PNGS = [
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=',
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==',
]

let token = null
const results = []

function check(label, condition, detail = '') {
  results.push({ label, ok: Boolean(condition) })
  console.log(`${condition ? 'PASS' : 'FAIL'}  ${label}${detail ? ` — ${detail}` : ''}`)
  if (!condition) throw new Error(`Check failed: ${label}`)
}

async function api(method, path, body, { multipart = false, expect = [200, 201] } = {}) {
  const headers = token ? { Authorization: `Bearer ${token}` } : {}
  if (body && !multipart) headers['Content-Type'] = 'application/json'
  const response = await fetch(`${args.api}${path}`, {
    method,
    headers,
    body: body ? (multipart ? body : JSON.stringify(body)) : undefined,
  })
  const data = await response.json().catch(() => ({}))
  if (!expect.includes(response.status)) {
    throw new Error(`${method} ${path} -> ${response.status}: ${data.error ?? JSON.stringify(data)}`)
  }
  return { status: response.status, data }
}

async function signAndSend(base64, label) {
  const tx = VersionedTransaction.deserialize(Buffer.from(base64, 'base64'))
  tx.sign([wallet])
  const signature = await connection.sendTransaction(tx)
  const confirmation = await connection.confirmTransaction(signature, 'confirmed')
  if (confirmation.value.err) throw new Error(`${label} failed on-chain: ${JSON.stringify(confirmation.value.err)}`)
  console.log(`      tx  ${label}: ${explorer('tx', signature)}`)
  return signature
}

const iso = (offsetMs) => new Date(Date.now() + offsetMs).toISOString()

async function main() {
  console.log(`wallet ${me} on ${args.rpc}`)
  if (args.airdrop) {
    await connection.confirmTransaction(await connection.requestAirdrop(wallet.publicKey, 2 * LAMPORTS_PER_SOL), 'confirmed')
  }
  const startBalance = await connection.getBalance(wallet.publicKey)
  check('wallet has at least 0.15 SOL to spend', startBalance >= 0.15 * LAMPORTS_PER_SOL, `${startBalance / LAMPORTS_PER_SOL} SOL`)

  // --- sign in with the wallet (real nonce + ed25519 signature) ----------
  const { data: nonce } = await api('POST', '/auth/nonce', { wallet_address: me, chain: 'solana' })
  const signature = bs58.encode(nacl.sign.detached(new TextEncoder().encode(nonce.message), wallet.secretKey))
  token = (await api('POST', '/auth/verify', { wallet_address: me, chain: 'solana', nonce: nonce.nonce, signature })).data.access_token
  check('signed in with the wallet', Boolean(token))

  // --- SPL token launch ---------------------------------------------------
  const form = new FormData()
  for (const [k, v] of Object.entries({
    network: 'solana_devnet', creator_wallet: me, name: 'Smoke Test Token', symbol: 'SMOKE',
    decimals: '6', supply: '1000000', description: '', revoke_mint_authority: 'true', revoke_freeze_authority: 'true',
  })) form.append(k, v)
  const { data: preparedToken } = await api('POST', '/solana-tokens/prepare', form, { multipart: true })
  const tokenSig = await signAndSend(preparedToken.transaction, 'SPL token')
  const { data: recordedToken } = await api('POST', '/solana-tokens', {
    network: 'solana_devnet', mint_address: preparedToken.mint, transaction_signature: tokenSig,
    creator_wallet: me, name: 'Smoke Test Token', symbol: 'SMOKE', metadata_uri: '',
  })
  check('token recorded after the backend re-verified it on-chain', recordedToken.token.mint_address === preparedToken.mint, explorer('address', preparedToken.mint))
  check('supply fixed and freeze authority revoked (read from the mint)', recordedToken.token.mint_authority_revoked && recordedToken.token.freeze_authority_revoked)
  const holding = await connection.getParsedTokenAccountsByOwner(wallet.publicKey, { mint: new PublicKey(preparedToken.mint) })
  check('wallet holds the full supply', holding.value[0]?.account.data.parsed.info.tokenAmount.uiAmountString === '1000000')

  // --- a published two-item collection (IPFS via the local stub) ----------
  const { data: { collection } } = await api('POST', '/nft/collections', { name: 'Smoke Drop', description: 'devnet smoke test' })
  const { data: { layer } } = await api('POST', `/nft/collections/${collection.id}/layers`, { name: 'Fur' })
  for (const [i, png] of PNGS.entries()) {
    const trait = new FormData()
    trait.append('name', `T${i}`)
    trait.append('rarity_weight', '50')
    trait.append('image', new Blob([Buffer.from(png, 'base64')], { type: 'image/png' }), `t${i}.png`)
    await api('POST', `/nft/layers/${layer.id}/traits`, trait, { multipart: true })
  }
  const { data: { job } } = await api('POST', `/nft/collections/${collection.id}/generate`, { count: 2 }, { expect: [202] })
  for (let status = job.status; status !== 'done'; ) {
    if (status === 'failed') throw new Error('generation failed')
    await new Promise((r) => setTimeout(r, 300))
    status = (await api('GET', `/nft/generation-jobs/${job.id}`)).data.job.status
  }
  const { data: { items } } = await api('GET', `/nft/collections/${collection.id}/items`)
  for (const item of items) await api('POST', `/nft/items/${item.id}/publish`)

  // --- Candy Machine: allowlist phase open now, public tomorrow, 1/wallet --
  const launch = {
    collection_id: collection.id, network: 'solana_devnet', creator_wallet: me,
    price_sol: 0.01, go_live_date: iso(24 * 3600e3), mint_limit: 1,
    allowlist: { addresses: [me, Keypair.generate().publicKey.toBase58()], price_sol: 0.005, start_date: iso(-3600e3) },
  }
  const { data: col } = await api('POST', '/mint/prepare-collection', launch)
  const sigs = [await signAndSend(col.transaction, 'collection')]
  const { data: cm } = await api('POST', '/mint/prepare-candy-machine', { ...launch, collection_mint: col.collection_mint })
  for (const [i, tx] of cm.transactions.entries()) sigs.push(await signAndSend(tx, `candy machine ${i + 1}/${cm.transactions.length}`))
  const { data: recordedDrop } = await api('POST', '/mint/candy-machines', {
    ...launch, collection_mint: col.collection_mint, candy_machine: cm.candy_machine,
    transaction_signatures: sigs, items_available: 2,
  })
  const drop = recordedDrop.candy_machine
  check('phased drop recorded after the backend read its guard groups back from the chain', drop.allowlist?.size === 2 && drop.mint_limit === 1, explorer('address', cm.candy_machine))

  let { data: status } = await api('GET', `/mint/public/${cm.candy_machine}?wallet=${me}`)
  check('storefront: allowlist phase, wallet eligible at 0.005 SOL', status.phase === 'allowlist' && status.allowlisted === true && status.mint_price_sol === 0.005)
  const outsider = Keypair.generate().publicKey.toBase58()
  check('a wallet not on the list is refused', (await api('POST', `/mint/public/${cm.candy_machine}/mint`, { minter_wallet: outsider }, { expect: [403] })).status === 403)

  const { data: mint1 } = await api('POST', `/mint/public/${cm.candy_machine}/mint`, { minter_wallet: me })
  await signAndSend(mint1.transaction, 'allowlist mint (proof route + mint)')
  status = (await api('GET', `/mint/public/${cm.candy_machine}?wallet=${me}`)).data
  check('mint counted by the on-chain mintLimit counter, limit reached', status.wallet_minted === 1 && status.limit_reached === true)
  check('a second mint is refused at the limit', (await api('POST', `/mint/public/${cm.candy_machine}/mint`, { minter_wallet: me }, { expect: [403] })).status === 403)

  // --- edit the live drop: drop the allowlist, public now at 0.02, 2/wallet
  const edit = { price_sol: 0.02, go_live_date: iso(-60e3), mint_limit: 2 }
  const { data: update } = await api('POST', `/mint/candy-machines/${drop.id}/prepare-update`, edit)
  const updateSig = await signAndSend(update.transaction, 'guard update')
  const { data: applied } = await api('POST', `/mint/candy-machines/${drop.id}/phases`, { ...edit, transaction_signature: updateSig })
  check('edit saved only after the backend read the new guards back', applied.candy_machine.allowlist === null && applied.candy_machine.mint_limit === 2)

  status = (await api('GET', `/mint/public/${cm.candy_machine}?wallet=${me}`)).data
  check('storefront: public phase at the new price, counter carried over', status.phase === 'public' && status.mint_price_sol === 0.02 && status.wallet_minted === 1)
  const { data: mint2 } = await api('POST', `/mint/public/${cm.candy_machine}/mint`, { minter_wallet: me })
  await signAndSend(mint2.transaction, 'public mint')

  const { data: dashboard } = await api('GET', '/mint/dashboard')
  const row = dashboard.drops.find((d) => d.candy_machine === cm.candy_machine)
  check('dashboard: 2 of 2 minted, revenue range spans every price', row.items_redeemed === 2 && row.revenue_min_sol === 0.01 && row.revenue_max_sol === 0.04, `${row.revenue_min_sol}–${row.revenue_max_sol} SOL`)

  const spent = (startBalance - (await connection.getBalance(wallet.publicKey))) / LAMPORTS_PER_SOL
  console.log(`\n${results.length}/${results.length} checks passed — spent ${spent.toFixed(4)} SOL`)
}

main().catch((error) => {
  console.error(`\nFAILED: ${error.message}`)
  process.exit(1)
})
