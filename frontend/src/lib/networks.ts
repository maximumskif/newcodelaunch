// Shared by NetworkContext.tsx (EVM) and candyMachineApi.ts (Solana) — both
// network lists share this {id, isTestnet} shape, so the fail-closed
// mainnet check (unrecognized network id → treated as mainnet, so a
// confirmation gate built on this stays showing rather than silently
// disappearing) only needs writing once.
export function isMainnetAmong<T extends { id: string; isTestnet: boolean }>(networks: T[], id: string): boolean {
  return !(networks.find((network) => network.id === id)?.isTestnet ?? false)
}
