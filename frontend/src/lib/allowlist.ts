// Parsing a pasted allowlist for a Candy Machine's allowlist phase
// (MintLaunchPage). The backend and sidecar validate every address for
// real; this just catches obvious mistakes before a wallet prompt.

export const MAX_ALLOWLIST = 2000

// Base58 (no 0, O, I, l) at a Solana public key's length.
const SOLANA_ADDRESS = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/

export interface ParsedAllowlist {
  // Unique, in the order first pasted.
  addresses: string[]
  invalid: string[]
  duplicates: number
}

// One wallet per line, or separated by commas/spaces — whatever a
// spreadsheet column or a Discord export pastes as.
export function parseAllowlist(text: string): ParsedAllowlist {
  const seen = new Set<string>()
  const invalid: string[] = []
  let duplicates = 0
  for (const entry of text.split(/[\s,;]+/).filter(Boolean)) {
    if (!SOLANA_ADDRESS.test(entry)) {
      invalid.push(entry)
    } else if (seen.has(entry)) {
      duplicates++
    } else {
      seen.add(entry)
    }
  }
  return { addresses: [...seen], invalid, duplicates }
}
