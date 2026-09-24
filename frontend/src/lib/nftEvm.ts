import { parseEther } from 'viem'

// Helpers for deploying an NFT Generator collection as an ERC-721
// (features/nft/NftEvmDeployPage.tsx).

// Default symbol from the collection name: "Cool Apes" -> "COOLAPES",
// capped at 10 characters like the Solana side's Token Metadata limit.
export function defaultSymbol(name: string): string {
  return (name.toUpperCase().replace(/[^A-Z0-9]/g, '') || 'NFT').slice(0, 10)
}

// Native-token amount as typed ("0.05") -> wei string, or null if it isn't
// a plain non-negative decimal. parseEther alone accepts things like "1e3".
export function priceToWei(price: string): string | null {
  if (!/^\d+(\.\d{1,18})?$/.test(price.trim())) return null
  return parseEther(price.trim()).toString()
}
