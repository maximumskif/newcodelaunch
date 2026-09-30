import { getAssociatedTokenAddressSync, TOKEN_2022_PROGRAM_ID, TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { type Connection, PublicKey } from '@solana/web3.js'

export interface WalletToken {
  mint: string
  decimals: number
  // Raw base units in the wallet's associated account for this mint.
  balance: bigint
  tokenProgram: PublicKey
}

// Fungible tokens the wallet holds (classic SPL and Token-2022), from its
// associated token accounts — the ones the Airdrop and Burn tools spend
// from. Other accounts for the same mint are left out, so each mint is
// listed once. NFTs (one unit, no decimals) are left out too.
export async function walletTokens(connection: Connection, owner: PublicKey): Promise<WalletToken[]> {
  const lists = await Promise.all(
    [TOKEN_PROGRAM_ID, TOKEN_2022_PROGRAM_ID].map(async (programId) => {
      const { value } = await connection.getParsedTokenAccountsByOwner(owner, { programId })
      return value.flatMap(({ pubkey, account }) => {
        const info = account.data.parsed.info
        const mint = info.mint as string
        const associated = getAssociatedTokenAddressSync(new PublicKey(mint), owner, true, programId)
        if (!associated.equals(pubkey)) return []
        return [{ mint, decimals: info.tokenAmount.decimals as number, balance: BigInt(info.tokenAmount.amount), tokenProgram: programId }]
      })
    }),
  )
  return lists.flat().filter((token) => token.balance > 0n && !(token.decimals === 0 && token.balance === 1n))
}
