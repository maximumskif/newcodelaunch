import type { Connector } from 'wagmi'

// Prefer the plain injected connector when a wallet is already injected
// (window.ethereum present): metaMask() wraps the full MetaMask SDK, which
// does its own extension-detection/deep-link/QR-code flow rather than just
// talking to an already-present injected provider — real friction for
// anyone with a non-MetaMask injected wallet (Rabby, Coinbase Wallet, etc.)
// or, as found while building real e2e coverage (see frontend/e2e/README.md),
// for automating a real signer at all. Falls back to the MetaMask-SDK
// connector, which can still deep-link to the mobile app or prompt install,
// when nothing is injected.
export function pickEvmConnector(connectors: readonly Connector[]): Connector | undefined {
  const hasInjectedProvider = typeof window !== 'undefined' && 'ethereum' in window
  return (hasInjectedProvider ? connectors.find((c) => c.id === 'injected') : undefined) ?? connectors[0]
}
