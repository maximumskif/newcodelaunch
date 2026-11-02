import type { Connector } from 'wagmi'

export const NO_EVM_WALLET =
  "No EVM wallet found. Install one such as MetaMask or Rabby, or open this site in your wallet app's browser."

// The WalletConnect connector, present only when the build has a project ID
// (VITE_WALLETCONNECT_PROJECT_ID, see lib/wagmiConfig.ts).
export function walletConnectConnector(connectors: readonly Connector[]): Connector | undefined {
  return connectors.find((c) => c.id === 'walletConnect')
}

// The wallet already in the browser (extension or a wallet app's built-in
// browser) when there is one: the plain injected connector talks to it
// directly. Otherwise WalletConnect, which shows a QR code on a computer and
// opens the wallet app on a phone. Undefined when neither can work.
//
// No MetaMask-SDK connector: wagmi's metaMask() needs @metamask/connect-evm,
// which isn't installed, so it failed whenever it was the fallback (any phone
// browser). WalletConnect covers MetaMask Mobile along with most other wallets.
export function pickEvmConnector(connectors: readonly Connector[]): Connector | undefined {
  const hasInjectedProvider = typeof window !== 'undefined' && 'ethereum' in window
  return (hasInjectedProvider ? connectors.find((c) => c.id === 'injected') : undefined) ?? walletConnectConnector(connectors)
}
