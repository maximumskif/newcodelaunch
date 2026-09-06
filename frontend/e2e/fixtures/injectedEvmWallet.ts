// Injected into the page via Playwright's addInitScript (see
// e2e/setup/buildFixtures.ts, which bundles this into a standalone script
// with esbuild before the test run). Implements just enough of EIP-1193
// (https://eips.ethereum.org/EIPS/eip-1193) for wagmi's `injected()`
// connector to detect a wallet and drive it — backed by a REAL private key
// and REAL viem signing/broadcasting against a local anvil chain, not a
// mocked response. The backend that verifies the resulting signature/
// transaction can't tell this apart from a real MetaMask signing the same
// key; that's the point — see docs/E2E_TESTING.md.
//
// Deliberately not a real MetaMask/browser-extension automation (e.g.
// Synpress): those are flaky in CI (unlocking with a seed phrase, extension
// popups, packaging an unpacked extension) for no verification benefit over
// a real signature from a real key, which is what this already provides.
import { createWalletClient, defineChain, http, publicActions, type Hex } from 'viem'
import { privateKeyToAccount } from 'viem/accounts'

// Anvil's well-known default account #0 — anvil funds this with 10000 ETH
// on every fresh start. Never used anywhere outside a local, ephemeral,
// throwaway chain (see e2e/setup/globalSetup.ts) — this key is public
// knowledge, printed by every `anvil` invocation.
const ANVIL_DEFAULT_PRIVATE_KEY: Hex = '0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80'

declare global {
  interface Window {
    __E2E_ANVIL_RPC_URL__?: string
  }
}

function installFakeEvmWallet() {
  const rpcUrl = window.__E2E_ANVIL_RPC_URL__ ?? 'http://127.0.0.1:8545'
  const account = privateKeyToAccount(ANVIL_DEFAULT_PRIVATE_KEY)
  // anvil is started with --chain-id 11155111 (see e2e/setup/run-anvil.sh)
  // to match Sepolia's real chain id exactly — this chain object exists
  // only so viem's typed client has one to reference, not because it's a
  // real network with a real RPC beyond the local anvil instance below.
  const localChain = defineChain({
    id: 11155111,
    name: 'Local Anvil (Sepolia chain id)',
    nativeCurrency: { name: 'Sepolia Ether', symbol: 'ETH', decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  })
  const client = createWalletClient({ account, chain: localChain, transport: http(rpcUrl) }).extend(publicActions)

  const listeners: Record<string, Array<(...args: unknown[]) => void>> = {}

  const provider = {
    isMetaMask: true,
    request: async ({ method, params }: { method: string; params?: unknown[] }): Promise<unknown> => {
      switch (method) {
        case 'eth_requestAccounts':
        case 'eth_accounts':
          return [account.address]
        case 'eth_chainId':
          return `0x${(await client.getChainId()).toString(16)}`
        case 'personal_sign': {
          const [message] = params as [Hex]
          return client.signMessage({ account, message: { raw: message } })
        }
        case 'eth_sendTransaction': {
          const [tx] = params as [Record<string, string>]
          return client.sendTransaction({
            account,
            to: tx.to as Hex | undefined,
            data: tx.data as Hex | undefined,
            value: tx.value ? BigInt(tx.value) : undefined,
            gas: tx.gas ? BigInt(tx.gas) : undefined,
          })
        }
        case 'wallet_switchEthereumChain':
        case 'wallet_addEthereumChain':
          // Single-chain local setup — nothing to switch to, but wagmi
          // expects this method to exist and resolve rather than throw.
          return null
        default:
          throw new Error(`[e2e fake wallet] unsupported EIP-1193 method: ${method}`)
      }
    },
    on: (event: string, handler: (...args: unknown[]) => void) => {
      ;(listeners[event] ??= []).push(handler)
    },
    removeListener: (event: string, handler: (...args: unknown[]) => void) => {
      listeners[event] = (listeners[event] ?? []).filter((h) => h !== handler)
    },
  }

  Object.defineProperty(window, 'ethereum', { value: provider, writable: false, configurable: true })
}

installFakeEvmWallet()
