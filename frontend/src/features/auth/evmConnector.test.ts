import { afterEach, describe, expect, it } from 'vitest'
import type { Connector } from 'wagmi'

import { pickEvmConnector, walletConnectConnector } from './evmConnector'

const injected = { id: 'injected' } as Connector
const walletConnect = { id: 'walletConnect' } as Connector
const w = window as unknown as { ethereum?: unknown }

describe('pickEvmConnector', () => {
  afterEach(() => {
    delete w.ethereum
  })

  it('uses the wallet in the browser when there is one', () => {
    w.ethereum = {}
    expect(pickEvmConnector([injected, walletConnect])).toBe(injected)
  })

  it('falls back to WalletConnect on a browser with no wallet, like a phone', () => {
    expect(pickEvmConnector([injected, walletConnect])).toBe(walletConnect)
  })

  it('has nothing to offer with no wallet and no WalletConnect project ID', () => {
    expect(pickEvmConnector([injected])).toBeUndefined()
    expect(walletConnectConnector([injected])).toBeUndefined()
  })
})
