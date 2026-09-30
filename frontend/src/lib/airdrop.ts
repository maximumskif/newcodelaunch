// Airdrop logic shared by both chains: turning pasted "address, amount"
// lines into recipients, and (Solana) packing recipients into as few
// transactions as fit.

import {
  createAssociatedTokenAccountIdempotentInstruction,
  createTransferCheckedInstruction,
  getAssociatedTokenAddressSync,
} from '@solana/spl-token'
import { PublicKey, TransactionMessage, VersionedTransaction, type TransactionInstruction } from '@solana/web3.js'

export interface Recipient {
  line: number
  address: string
  // Base units (the token's smallest unit), as a bigint.
  amount: bigint
}

export interface ParseResult {
  recipients: Recipient[]
  problems: { line: number; text: string; reason: string }[]
  total: bigint
}

// "12.5" with 6 decimals → 12500000n. Rejects more decimals than the token has.
export function toBaseUnits(text: string, decimals: number): bigint | null {
  const match = text.trim().match(/^(\d+)(?:\.(\d+))?$/)
  if (!match) return null
  const [, whole, fraction = ''] = match
  if (fraction.length > decimals) return null
  return BigInt(whole) * 10n ** BigInt(decimals) + BigInt(fraction.padEnd(decimals, '0') || '0')
}

// 12500000n with 6 decimals → "12.5" ("1,234.5" grouped for display;
// ungrouped for files other tools read back, like a CSV).
export function fromBaseUnits(amount: bigint, decimals: number, { grouped = true } = {}): string {
  const scale = 10n ** BigInt(decimals)
  const whole = amount / scale
  const fraction = (amount % scale).toString().padStart(decimals, '0').replace(/0+$/, '')
  return `${grouped ? whole.toLocaleString('en-US') : whole.toString()}${fraction ? `.${fraction}` : ''}`
}

// One recipient per line: address and amount, separated by a comma, tab or
// spaces (so a pasted CSV or spreadsheet column works). Blank lines and a
// header line are skipped; a line that doesn't parse is reported, not
// silently dropped; the same address twice is reported too.
export function parseRecipients(
  text: string,
  decimals: number,
  isValidAddress: (address: string) => boolean,
): ParseResult {
  const recipients: Recipient[] = []
  const problems: ParseResult['problems'] = []
  const seen = new Map<string, number>()
  text.split(/\r?\n/).forEach((raw, index) => {
    const line = index + 1
    const trimmed = raw.trim()
    if (!trimmed) return
    const parts = trimmed.split(/[\s,;]+/).filter(Boolean)
    if (index === 0 && parts.length >= 2 && !isValidAddress(parts[0]) && toBaseUnits(parts[1], decimals) === null) return // header
    if (parts.length !== 2) {
      problems.push({ line, text: trimmed, reason: 'expected "address, amount"' })
      return
    }
    const [address, amountText] = parts
    if (!isValidAddress(address)) {
      problems.push({ line, text: trimmed, reason: 'not a valid address' })
      return
    }
    const amount = toBaseUnits(amountText, decimals)
    if (amount === null || amount === 0n) {
      problems.push({ line, text: trimmed, reason: amount === 0n ? 'amount is zero' : `not an amount (at most ${decimals} decimals)` })
      return
    }
    const key = address.toLowerCase()
    if (seen.has(key)) {
      problems.push({ line, text: trimmed, reason: `same address as line ${seen.get(key)}` })
      return
    }
    seen.set(key, line)
    recipients.push({ line, address, amount })
  })
  return { recipients, problems, total: recipients.reduce((sum, r) => sum + r.amount, 0n) }
}

// Any 32-byte base58 key: wallets, and program-owned accounts too (their
// token account is created with allowOwnerOffCurve).
export function isSolanaAddress(address: string): boolean {
  try {
    new PublicKey(address)
    return true
  } catch {
    return false
  }
}

// Solana's packet limit for a serialized transaction.
const MAX_TX_BYTES = 1232

export interface SolanaBatchContext {
  payer: PublicKey
  mint: PublicKey
  decimals: number
  tokenProgram: PublicKey
  blockhash: string
}

function instructionsFor(recipient: Recipient, ctx: SolanaBatchContext): TransactionInstruction[] {
  const owner = new PublicKey(recipient.address)
  const source = getAssociatedTokenAddressSync(ctx.mint, ctx.payer, false, ctx.tokenProgram)
  const destination = getAssociatedTokenAddressSync(ctx.mint, owner, true, ctx.tokenProgram)
  return [
    // Idempotent: a no-op when the recipient already has the account.
    createAssociatedTokenAccountIdempotentInstruction(ctx.payer, destination, owner, ctx.mint, ctx.tokenProgram),
    createTransferCheckedInstruction(source, ctx.mint, destination, ctx.payer, recipient.amount, ctx.decimals, [], ctx.tokenProgram),
  ]
}

function build(recipients: Recipient[], ctx: SolanaBatchContext): VersionedTransaction {
  const message = new TransactionMessage({
    payerKey: ctx.payer,
    recentBlockhash: ctx.blockhash,
    instructions: recipients.flatMap((r) => instructionsFor(r, ctx)),
  }).compileToV0Message()
  return new VersionedTransaction(message)
}

// Packs recipients into transactions greedily: each takes as many as fit
// the size limit. An unsigned transaction serializes with zeroed signature
// slots, so the measured size is the signed size.
export function packSolanaBatches(recipients: Recipient[], ctx: SolanaBatchContext): Recipient[][] {
  const batches: Recipient[][] = []
  let current: Recipient[] = []
  for (const recipient of recipients) {
    const candidate = [...current, recipient]
    if (current.length > 0 && build(candidate, ctx).serialize().length > MAX_TX_BYTES) {
      batches.push(current)
      current = [recipient]
    } else {
      current = candidate
    }
  }
  if (current.length) batches.push(current)
  return batches
}

export function buildSolanaBatch(recipients: Recipient[], ctx: SolanaBatchContext): VersionedTransaction {
  return build(recipients, ctx)
}
