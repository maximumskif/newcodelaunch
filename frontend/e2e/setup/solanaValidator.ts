import { Connection, LAMPORTS_PER_SOL, PublicKey } from '@solana/web3.js'

export const VALIDATOR_RPC_URL = 'http://127.0.0.1:8899'

// Matches e2e/fixtures/injectedSolanaWallet.ts's hardcoded keypair.
export const FIXTURE_WALLET_PUBLIC_KEY = 'FoEsHYn3QLcBMae9YmkYC57ogWamP7zUqKNeuBgh6VwG'

// Every program run-solana-validator.sh clones from devnet.
export const CORE_PROGRAM_ID = new PublicKey('CoREENxT6tW1HoK8ypY1SxRMZTcVPm7R94rH4PZNhX7d')
export const CORE_CANDY_MACHINE_PROGRAM_ID = new PublicKey('CMACYFENjoBMHzapRXyo1JZkVS6EtaDDzkjMrmQLvr4J')
// The Candy Machine's create() call wires in a Core Candy Guard account
// under the hood for its solPayment/startDate guards, even though this
// app's own code never references this program id directly — see
// run-solana-validator.sh's comment for how this one was found (decoding a
// failing transaction's account keys after the other two programs alone
// weren't enough).
export const CORE_CANDY_GUARD_PROGRAM_ID = new PublicKey('CMAGAKJ67e9hRZgfC5SFTbZH8MgEmtqazKXjmkaJjWTJ')
export const TOKEN_METADATA_PROGRAM_ID = new PublicKey('metaqbxxUerdq28cj1RbAWkYQm3ybzjb6a8bt518x1s')

// Playwright's webServer `port: 8899` readiness check (playwright.config.ts)
// only confirms solana-test-validator's RPC port is accepting connections —
// not that its `--clone-upgradeable-program` step (fetching these programs'
// real bytecode from devnet, see run-solana-validator.sh) has actually
// finished. The port opens before that completes, so without this, tests
// can start against a validator whose cloned programs aren't loaded yet,
// failing on-chain with "Program is not deployed" for what looks like a
// real bug but is really a startup race. Poll until each is genuinely ready.
export async function waitForClonedPrograms(connection: Connection, programIds: PublicKey[]) {
  const deadline = Date.now() + 60_000
  for (const programId of programIds) {
    for (;;) {
      const info = await connection.getAccountInfo(programId)
      if (info?.executable) break
      if (Date.now() > deadline) throw new Error(`Cloned program ${programId.toBase58()} never became ready`)
      await new Promise((resolve) => setTimeout(resolve, 500))
    }
  }
}

// solana-test-validator starts empty, unlike anvil, which pre-funds default
// accounts — each spec funds the fixture's real keypair itself, so any one
// spec can run alone.
export async function fundFixtureWallet(connection: Connection, sol = 10) {
  const signature = await connection.requestAirdrop(new PublicKey(FIXTURE_WALLET_PUBLIC_KEY), sol * LAMPORTS_PER_SOL)
  await connection.confirmTransaction(signature, 'confirmed')
}
