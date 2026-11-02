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
        // are needed on every page (the header's WalletConnect uses both), so
        // they load up front in their own vendor chunks: rarely-changing
        // libraries cached apart from app code. The pages themselves are
        // split by route (App.tsx, lib/lazyPage.ts) and load when visited.
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
