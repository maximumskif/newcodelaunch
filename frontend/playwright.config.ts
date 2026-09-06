import { defineConfig, devices } from '@playwright/test'

// Real end-to-end coverage over the actual stack — a real Flask backend, a
// real anvil chain, a real frontend build — not mocked at any layer except
// the wallet extension itself (see e2e/fixtures/injectedEvmWallet.ts and
// e2e/README.md for why that one substitution is a real key/signer, not a
// stubbed response). See docs/REBUILD_PROGRESS.md's "Testing & CI" entry.
export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.ts',
  globalSetup: './e2e/setup/globalSetup.ts',
  // Every test in this first pass shares one anvil chain + one backend DB —
  // running them in parallel would mean two tests racing over the same
  // chain nonce/state. Fine at today's scale (one real flow); revisit with
  // per-worker chains/DBs if this suite grows enough to need parallelism.
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['dot'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: 'http://localhost:5173',
    trace: 'retain-on-failure',
  },
  webServer: [
    {
      command: 'bash ./e2e/setup/run-anvil.sh',
      port: 8545,
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
    },
    {
      command: 'bash ./e2e/setup/run-backend.sh',
      url: 'http://localhost:5000/api/health',
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:5173',
      reuseExistingServer: !process.env.CI,
      timeout: 30_000,
      env: { VITE_SEPOLIA_RPC_URL: 'http://127.0.0.1:8545' },
    },
  ],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
})
