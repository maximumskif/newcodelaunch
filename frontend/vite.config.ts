import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
// vitest/config re-exports Vite's defineConfig with the `test` field typed —
// this is still a plain Vite config as far as `vite build`/`vite dev` are concerned.
import { configDefaults, defineConfig } from 'vitest/config'

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 5173,
  },
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    // Vitest's default include glob (**/*.{test,spec}.*) otherwise also
    // matches Playwright's e2e/*.spec.ts files — those use @playwright/test's
    // own `test`/`expect` globals, not Vitest's, and need the real
    // stack (backend, anvil) running via `npm run test:e2e`, not jsdom.
    // Extends (not replaces) Vitest's own exclude defaults.
    exclude: [...configDefaults.exclude, './e2e/**'],
  },
  build: {
    rollupOptions: {
      output: {
        // The wagmi/viem (EVM) and @solana/wallet-adapter-* (Solana) stacks
        // are the bulk of the >500KB warning — both are used by WalletConnect,
        // which renders on every page, so route-based splitting wouldn't help
        // (every route needs it). Splitting them into their own vendor chunks
        // doesn't shrink total bytes, but it separates rarely-changing wallet
        // libraries from app code for better long-term browser caching, and
        // each chunk is well under the 500KB warning threshold on its own.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@solana') || id.includes('bs58')) return 'vendor-solana'
          if (id.includes('/wagmi/') || id.includes('/viem/') || id.includes('/@wagmi/')) return 'vendor-evm'
          return undefined
        },
      },
    },
  },
})
