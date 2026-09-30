import { fromBaseUnits } from './airdrop'
import type { HolderSnapshot } from './tokenPagesApi'

// A holder snapshot as CSV: exact whole-token balances (no grouping, so a
// spreadsheet or the Airdrop tool reads them back unchanged), share of
// supply, and which rows are burn addresses.
export function holdersCsv(snapshot: HolderSnapshot): string {
  const burn = new Set(snapshot.burn_addresses.map((a) => a.toLowerCase()))
  const rows = snapshot.holders.map((holder) =>
    [holder.address, fromBaseUnits(BigInt(holder.balance), snapshot.decimals, { grouped: false }), (holder.share * 100).toFixed(6), burn.has(holder.address.toLowerCase()) ? 'burn address' : ''].join(','),
  )
  return ['address,balance,percent_of_supply,note', ...rows].join('\n') + '\n'
}

export function snapshotFileName(snapshot: HolderSnapshot): string {
  const when = snapshot.as_of.block !== null ? `block-${snapshot.as_of.block}` : new Date().toISOString().slice(0, 10)
  return `holders-${snapshot.symbol ?? snapshot.address.slice(0, 8)}-${snapshot.network}-${when}.csv`
}
