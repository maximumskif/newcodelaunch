// @vitest-environment node
// (jsdom's Uint8Array isn't the one the hashing library checks for, so
// deriving token account addresses fails there.)
import { Keypair, PublicKey } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { describe, expect, it } from 'vitest'

import { buildSolanaBatch, fromBaseUnits, isSolanaAddress, packSolanaBatches, parseRecipients, toBaseUnits } from './airdrop'

const evm = (a: string) => /^0x[0-9a-fA-F]{40}$/.test(a)
const A = '0x5FbDB2315678afecb367f032d93F642f64180aa3'
const B = '0xe7f1725E7734CE288F8367e1Bb143E90bb3F0512'

describe('amounts', () => {
  it('converts between whole tokens and base units exactly', () => {
    expect(toBaseUnits('12.5', 6)).toBe(12_500_000n)
    expect(toBaseUnits('1', 18)).toBe(10n ** 18n)
    expect(toBaseUnits('0.0000001', 6)).toBeNull()
    expect(toBaseUnits('1e5', 6)).toBeNull()
    expect(fromBaseUnits(1_234_500_000n, 6)).toBe('1,234.5')
  })
})

describe('parseRecipients', () => {
  it('reads commas, tabs and spaces, skips a header, and totals', () => {
    const result = parseRecipients(`address,amount\n${A}, 10\n${B}\t2.5\n\n`, 6, evm)
    expect(result.recipients.map((r) => [r.line, r.address, r.amount])).toEqual([[2, A, 10_000_000n], [3, B, 2_500_000n]])
    expect(result.total).toBe(12_500_000n)
    expect(result.problems).toEqual([])
  })

  it('reports every line it cannot use, with the reason', () => {
    const result = parseRecipients(`${A}, 10\n0x123, 5\n${B}, abc\n${B}, 0\n${A.toLowerCase()}, 1\njust-one-part`, 6, evm)
    expect(result.recipients).toHaveLength(1)
    expect(result.problems.map((p) => [p.line, p.reason])).toEqual([
      [2, 'not a valid address'],
      [3, 'not an amount (at most 6 decimals)'],
      [4, 'amount is zero'],
      [5, 'same address as line 1'],
      [6, 'expected "address, amount"'],
    ])
  })
})

describe('Solana batches', () => {
  const payer = Keypair.generate().publicKey
  const ctx = { payer, mint: Keypair.generate().publicKey, decimals: 6, tokenProgram: TOKEN_PROGRAM_ID, blockhash: new PublicKey(new Uint8Array(32).fill(7)).toBase58() }

  it('accepts real Solana keys only', () => {
    expect(isSolanaAddress(payer.toBase58())).toBe(true)
    expect(isSolanaAddress(A)).toBe(false)
  })

  it('packs as many recipients per transaction as fit, never over the size limit', () => {
    const recipients = Array.from({ length: 40 }, (_, i) => ({ line: i + 1, address: Keypair.generate().publicKey.toBase58(), amount: 1n }))
    const batches = packSolanaBatches(recipients, ctx)
    expect(batches.flat()).toEqual(recipients)
    expect(batches.length).toBeGreaterThan(1)
    for (const batch of batches) expect(buildSolanaBatch(batch, ctx).serialize().length).toBeLessThanOrEqual(1232)
    // Greedy: every batch but the last was full (one more wouldn't fit).
    const firstPlusOne = [...batches[0], batches[1][0]]
    expect(buildSolanaBatch(firstPlusOne, ctx).serialize().length).toBeGreaterThan(1232)
  })
})
