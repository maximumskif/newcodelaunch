import { parseAbi, type PublicClient } from 'viem'

import { ERC20_ABI } from './uniswapV2Abi'

// Our advanced ERC-20's transfer rules (and any token with the same
// functions): what a release from a vesting or lock contract has to fit,
// unless that contract is exempt.
export const TOKEN_LIMITS_ABI = parseAbi([
  'function owner() view returns (address)',
  'function tradingEnabled() view returns (bool)',
  'function maxTransactionAmount() view returns (uint256)',
  'function maxWalletAmount() view returns (uint256)',
  'function isExcludedFromFees(address account) view returns (bool)',
  'function excludeFromFees(address account, bool excluded)',
])

export interface TokenLimits {
  owner: string
  tradingEnabled: boolean
  maxTransaction: bigint
  maxWallet: bigint
  // The paying contract is exempt: none of the above applies.
  exempt: boolean
  // What the recipient holds now (counts against maxWallet).
  recipientBalance: bigint
}

// null when the token has no such limits — the probe reverts.
export async function readTokenLimits(client: PublicClient, token: `0x${string}`, payer: `0x${string}`, recipient: `0x${string}`): Promise<TokenLimits | null> {
  const read = <T,>(functionName: 'owner' | 'tradingEnabled' | 'maxTransactionAmount' | 'maxWalletAmount') =>
    client.readContract({ address: token, abi: TOKEN_LIMITS_ABI, functionName }) as Promise<T>
  try {
    const [owner, tradingEnabled, maxTransaction, maxWallet, exempt, recipientBalance] = await Promise.all([
      read<string>('owner'),
      read<boolean>('tradingEnabled'),
      read<bigint>('maxTransactionAmount'),
      read<bigint>('maxWalletAmount'),
      client.readContract({ address: token, abi: TOKEN_LIMITS_ABI, functionName: 'isExcludedFromFees', args: [payer] }),
      client.readContract({ address: token, abi: ERC20_ABI, functionName: 'balanceOf', args: [recipient] }),
    ])
    return { owner, tradingEnabled, maxTransaction, maxWallet, exempt, recipientBalance }
  } catch {
    return null
  }
}

// How much one release can pay right now: what's due, cut down to what the
// token lets the contract send and the recipient hold.
export function fitsLimits(due: bigint, limits: TokenLimits | null): bigint {
  if (!limits || limits.exempt) return due
  if (!limits.tradingEnabled) return 0n
  const room = limits.maxWallet > limits.recipientBalance ? limits.maxWallet - limits.recipientBalance : 0n
  return [due, limits.maxTransaction, room].reduce((a, b) => (b < a ? b : a))
}
