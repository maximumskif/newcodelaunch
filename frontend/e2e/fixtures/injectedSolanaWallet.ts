// Injected into the page via Playwright's addInitScript (bundled by
// e2e/setup/globalSetup.ts). Implements just enough of Phantom's injected
// interface (window.phantom.solana / window.solana, isPhantom, isConnected,
// connect/disconnect, signMessage, signTransaction/signAllTransactions) for
// @solana/wallet-adapter-wallets' PhantomWalletAdapter to detect and drive
// it — backed by a REAL keypair signing with real ed25519 (tweetnacl), not a
// mocked response. The backend verifies the resulting signature/transaction
// exactly as it would a real Phantom's. See frontend/e2e/README.md.
//
// Deliberately not a real Phantom/browser-extension automation: same
// rationale as injectedEvmWallet.ts — flaky in CI for no verification
// benefit over a real signature from a real key.
import { Connection, Keypair, PublicKey, type SendOptions, Transaction, VersionedTransaction } from '@solana/web3.js'
import bs58 from 'bs58'
import nacl from 'tweetnacl'

// A throwaway keypair used only by this e2e suite — never used anywhere
// real. Funded via a local `requestAirdrop` in the spec's own
// `test.beforeAll` (solana-test-validator starts empty, unlike anvil, which
// pre-funds default accounts, so nothing funds this automatically).
const SECRET_KEY_BASE58 =
  '29PtmHpRpsBgr25KzG62z2SF5BQP3DfYWwhG5NYuG1tkybhjyxf9zDJevQcGREaqSbr1CQGPYWgDuwhT81rrNkpz'

// Fixed local port solana-test-validator always runs on in this suite (see
// e2e/setup/run-solana-validator.sh) — unlike the EVM fixture's RPC URL,
// there's no "realistic fallback" concern here since this fixture only
// ever runs against that one local instance.
const VALIDATOR_RPC_URL = 'http://127.0.0.1:8899'

type SignableTransaction = Transaction | VersionedTransaction

class MiniEmitter {
  private listeners: Record<string, Array<(...args: unknown[]) => void>> = {}

  on(event: string, handler: (...args: unknown[]) => void) {
    ;(this.listeners[event] ??= []).push(handler)
    return this
  }

  off(event: string, handler: (...args: unknown[]) => void) {
    this.listeners[event] = (this.listeners[event] ?? []).filter((h) => h !== handler)
    return this
  }

  emit(event: string, ...args: unknown[]) {
    for (const handler of this.listeners[event] ?? []) handler(...args)
  }
}

function installFakeSolanaWallet() {
  const keypair = Keypair.fromSecretKey(bs58.decode(SECRET_KEY_BASE58))
  const emitter = new MiniEmitter()
  const connection = new Connection(VALIDATOR_RPC_URL, 'confirmed')

  // Duck-typed on purpose, not `transaction instanceof VersionedTransaction`:
  // this fixture is bundled by esbuild as its own standalone script, with
  // its own separate copy of @solana/web3.js — completely different from
  // the copy Vite bundles for the actual app. A transaction constructed by
  // the app's copy fails `instanceof` against this fixture's copy of the
  // same class even though it's a real VersionedTransaction (confirmed via
  // `cast run`-style debugging: real object, `'version' in transaction`
  // true, `instanceof` false) — the exact dual-package hazard
  // @solana/wallet-adapter-base's own `isVersionedTransaction` avoids by
  // checking `'version' in transaction` instead. Same fix here.
  const signOne = (transaction: SignableTransaction) => {
    if ('version' in transaction) {
      transaction.sign([keypair])
    } else {
      transaction.partialSign(keypair)
    }
    return transaction
  }

  const wallet = {
    isPhantom: true,
    publicKey: keypair.publicKey as PublicKey | null,
    isConnected: false,
    on: emitter.on.bind(emitter),
    off: emitter.off.bind(emitter),
    connect: async () => {
      wallet.isConnected = true
      emitter.emit('connect', keypair.publicKey)
    },
    disconnect: async () => {
      wallet.isConnected = false
      wallet.publicKey = null
      emitter.emit('disconnect')
    },
    signMessage: async (message: Uint8Array) => {
      const signature = nacl.sign.detached(message, keypair.secretKey)
      return { signature }
    },
    signTransaction: async <T extends SignableTransaction>(transaction: T): Promise<T> => signOne(transaction) as T,
    signAllTransactions: async <T extends SignableTransaction>(transactions: T[]): Promise<T[]> =>
      transactions.map((tx) => signOne(tx) as T),
    // PhantomWalletAdapter's own sendTransaction() (not the generic
    // BaseSignerWalletAdapter one) unconditionally calls this rather than
    // signTransaction() + a separate broadcast — sign with the real key,
    // then actually broadcast to the local validator ourselves.
    signAndSendTransaction: async (transaction: SignableTransaction, options?: SendOptions) => {
      signOne(transaction)
      const signature = await connection.sendRawTransaction(transaction.serialize(), options)
      return { signature }
    },
  }

  Object.defineProperty(window, 'isPhantomInstalled', { value: true, writable: false, configurable: true })
  Object.defineProperty(window, 'phantom', { value: { solana: wallet }, writable: false, configurable: true })
  Object.defineProperty(window, 'solana', { value: wallet, writable: false, configurable: true })
}

installFakeSolanaWallet()
