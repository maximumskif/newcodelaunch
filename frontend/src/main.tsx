import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import { WagmiProvider } from 'wagmi'

import App from './App.tsx'
import { AuthProvider } from './features/auth/AuthContext.tsx'
import { NetworkProvider } from './features/network/NetworkContext.tsx'
import './index.css'
import { SolanaWalletProvider } from './lib/solanaWallets.tsx'
import { wagmiConfig } from './lib/wagmiConfig.ts'

const queryClient = new QueryClient()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <SolanaWalletProvider>
          <AuthProvider>
            <NetworkProvider>
              <BrowserRouter>
                <App />
              </BrowserRouter>
            </NetworkProvider>
          </AuthProvider>
        </SolanaWalletProvider>
      </QueryClientProvider>
    </WagmiProvider>
  </StrictMode>,
)
