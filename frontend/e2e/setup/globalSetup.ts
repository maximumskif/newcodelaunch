import path from 'node:path'
import { fileURLToPath } from 'node:url'

import { build } from 'esbuild'

const here = path.dirname(fileURLToPath(import.meta.url))

// Bundles the fake-wallet fixture (a real viem WalletClient over a real key,
// see e2e/fixtures/injectedEvmWallet.ts) into a single dependency-free
// script Playwright can inject into the page with addInitScript — that API
// only accepts a static file path, not a TS module with imports, so this
// has to happen before any test runs. Kept as a Playwright globalSetup
// (runs once per test run, not per-test) rather than a separate npm script
// so `npx playwright test` alone is enough to run everything.
export default async function globalSetup() {
  await build({
    entryPoints: [path.join(here, '..', 'fixtures', 'injectedEvmWallet.ts')],
    bundle: true,
    format: 'iife',
    target: 'es2020',
    outfile: path.join(here, '..', '.generated', 'injectedEvmWallet.bundle.js'),
  })
}
