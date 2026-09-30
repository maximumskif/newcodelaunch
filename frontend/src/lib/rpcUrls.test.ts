import { afterEach, describe, expect, it, vi } from 'vitest'

import { rpcOverride } from './rpcUrls'

describe('rpcOverride', () => {
  it('treats unset, empty and whitespace-only values as no override', () => {
    // '' is what an unforwarded Docker build arg bakes in (see rpcUrls.ts).
    expect(rpcOverride(undefined)).toBeUndefined()
    expect(rpcOverride('')).toBeUndefined()
    expect(rpcOverride('   ')).toBeUndefined()
  })

  it('passes a real URL through, trimmed', () => {
    expect(rpcOverride(' https://rpc.example.com/key ')).toBe('https://rpc.example.com/key')
  })
})

// The constants are resolved at import time, so each case stubs the env
// and re-imports a fresh copy of the modules.
describe('resolved RPC URLs', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
    vi.resetModules()
  })

  async function load() {
    vi.resetModules()
    const rpcUrls = await import('./rpcUrls')
    const { SOLANA_NETWORKS } = await import('./candyMachineApi')
    const { wagmiConfig } = await import('./wagmiConfig')
    return { rpcUrls, SOLANA_NETWORKS, wagmiConfig }
  }

  // The endpoints a chain's fallback transport tries, in order.
  function transportUrls(config: Awaited<ReturnType<typeof load>>['wagmiConfig'], chainId: number): string[] {
    const chain = config.chains.find((item) => item.id === chainId)!
    const transport = config._internal.transports[chainId as keyof typeof config._internal.transports]
    const { transports } = transport({ chain }).value as unknown as { transports: { value: { url: string } }[] }
    return transports.map((item) => item.value.url)
  }
  const transportUrl = (config: Awaited<ReturnType<typeof load>>['wagmiConfig'], chainId: number) => transportUrls(config, chainId)[0]

  it('falls back to public defaults when every override is empty', async () => {
    for (const name of [
      'VITE_SOLANA_RPC_URL',
      'VITE_SOLANA_DEVNET_RPC_URL',
      'VITE_SEPOLIA_RPC_URL',
      'VITE_ETHEREUM_RPC_URL',
      'VITE_POLYGON_AMOY_RPC_URL',
      'VITE_POLYGON_RPC_URL',
      'VITE_BSC_TESTNET_RPC_URL',
      'VITE_BSC_RPC_URL',
      'VITE_BASE_SEPOLIA_RPC_URL',
      'VITE_BASE_RPC_URL',
    ]) {
      vi.stubEnv(name, '')
    }
    const { rpcUrls, SOLANA_NETWORKS, wagmiConfig } = await load()

    expect(SOLANA_NETWORKS.map((network) => network.rpcUrl)).toEqual([
      'https://api.devnet.solana.com',
      'https://api.mainnet-beta.solana.com',
    ])
    // Every public endpoint, in order — never an empty URL.
    expect(transportUrls(wagmiConfig, 1)).toEqual(rpcUrls.EVM_PUBLIC_RPC_URLS.ethereum)
    expect(transportUrls(wagmiConfig, 56)).toEqual(rpcUrls.EVM_PUBLIC_RPC_URLS.bsc)
  })

  it('tries an override first, then the public endpoints; a local node alone', async () => {
    vi.stubEnv('VITE_POLYGON_RPC_URL', 'https://polygon.example')
    vi.stubEnv('VITE_SEPOLIA_RPC_URL', 'http://127.0.0.1:8545')
    const { rpcUrls, wagmiConfig } = await load()

    expect(transportUrls(wagmiConfig, 137)).toEqual(['https://polygon.example', ...rpcUrls.EVM_PUBLIC_RPC_URLS.polygon])
    expect(transportUrls(wagmiConfig, 11155111)).toEqual(['http://127.0.0.1:8545'])
  })

  it('wires each override to its own network', async () => {
    // Distinct value per variable, so a copy-paste slip (two chains reading
    // the same variable) fails here rather than in production.
    const overrides: Record<string, string> = {
      VITE_SEPOLIA_RPC_URL: 'https://sepolia.example',
      VITE_ETHEREUM_RPC_URL: 'https://ethereum.example',
      VITE_POLYGON_AMOY_RPC_URL: 'https://amoy.example',
      VITE_POLYGON_RPC_URL: 'https://polygon.example',
      VITE_BSC_TESTNET_RPC_URL: 'https://bsc-testnet.example',
      VITE_BSC_RPC_URL: 'https://bsc.example',
      VITE_BASE_SEPOLIA_RPC_URL: 'https://base-sepolia.example',
      VITE_BASE_RPC_URL: 'https://base.example',
      VITE_SOLANA_DEVNET_RPC_URL: 'https://solana-devnet.example',
      VITE_SOLANA_RPC_URL: 'https://solana-mainnet.example',
    }
    for (const [name, value] of Object.entries(overrides)) vi.stubEnv(name, value)
    const { rpcUrls, SOLANA_NETWORKS, wagmiConfig } = await load()

    expect(Object.fromEntries(SOLANA_NETWORKS.map((network) => [network.id, network.rpcUrl]))).toEqual({
      solana_devnet: 'https://solana-devnet.example',
      solana: 'https://solana-mainnet.example',
    })
    // solanaWallets.tsx's ConnectionProvider reads this same constant.
    expect(rpcUrls.SOLANA_MAINNET_RPC_URL).toBe('https://solana-mainnet.example')

    const byChainName = Object.fromEntries(
      wagmiConfig.chains.map((chain) => [chain.name, transportUrl(wagmiConfig, chain.id)]),
    )
    expect(byChainName).toEqual({
      Sepolia: 'https://sepolia.example',
      Ethereum: 'https://ethereum.example',
      'Polygon Amoy': 'https://amoy.example',
      Polygon: 'https://polygon.example',
      'BNB Smart Chain Testnet': 'https://bsc-testnet.example',
      'BNB Smart Chain': 'https://bsc.example',
      'Base Sepolia': 'https://base-sepolia.example',
      Base: 'https://base.example',
    })
  })
})
