import { parseUnits } from 'viem'

// A positive amount typed by a person, with at most `decimals` places, in
// base units — or null for anything else (empty, zero, negative, too
// precise, not a number).
export function parseAmount(text: string, decimals: number): bigint | null {
  const trimmed = text.trim()
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return null
  if ((trimmed.split('.')[1] ?? '').length > decimals) return null
  const value = parseUnits(trimmed, decimals)
  return value > 0n ? value : null
}
