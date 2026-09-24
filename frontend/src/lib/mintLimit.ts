// The optional per-wallet mint limit on a Candy Machine drop (the mintLimit
// guard stores it as a u16). Empty means no limit.
export const MAX_MINT_LIMIT = 65535

export function parseMintLimit(text: string): { value: number | undefined; problem: string | null } {
  const trimmed = text.trim()
  if (!trimmed) return { value: undefined, problem: null }
  if (!/^\d+$/.test(trimmed) || Number(trimmed) < 1 || Number(trimmed) > MAX_MINT_LIMIT) {
    return { value: undefined, problem: `Max mints per wallet must be a whole number from 1 to ${MAX_MINT_LIMIT}, or empty for no limit` }
  }
  return { value: Number(trimmed), problem: null }
}
