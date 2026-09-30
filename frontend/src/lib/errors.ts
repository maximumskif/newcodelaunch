// One place that turns what wallets, RPCs and our API throw into a sentence
// a person can act on. Unknown errors pass through (first line only — viem
// and wallet errors append pages of request details), so nothing specific
// is ever hidden behind a generic message.

const RULES: [RegExp, string][] = [
  [/user rejected|user denied|rejected the request|request rejected|cancelled by user/i, 'You cancelled this in your wallet.'],
  [/insufficient funds|exceeds balance.*gas|gas required exceeds/i, "Your wallet doesn't have enough to pay the network fee for this."],
  [/found no record of a prior credit/i, 'This wallet has no SOL to pay the network fee.'],
  [/failed to fetch|networkerror|network request failed|load failed/i, "Couldn't reach the server or network. Check your connection and try again."],
  [/blockhash not found|block height exceeded|transaction expired/i, 'The network took too long and the transaction expired. Try again.'],
  [/chain mismatch|does not match the target chain|switch chain/i, 'Your wallet is on a different network. Switch it and try again.'],
]

export function errorMessage(err: unknown, fallback: string): string {
  if (!(err instanceof Error)) return fallback
  // viem's errors carry a one-line summary; the message is the long form.
  const short = (err as Error & { shortMessage?: string }).shortMessage
  const text = `${err.name} ${short ?? ''} ${err.message}`
  for (const [pattern, friendly] of RULES) if (pattern.test(text)) return friendly
  const first = (short || err.message).split('\n')[0].trim()
  return first || fallback
}
