import { describe, expect, it } from 'vitest'

import { holdersCsv, snapshotFileName } from './snapshot'
import type { HolderSnapshot } from './tokenPagesApi'

const snapshot: HolderSnapshot = {
  chain: 'evm',
  network: 'sepolia',
  address: '0x5FbDB2315678afecb367f032d93F642f64180aa3',
  symbol: 'NOVA',
  decimals: 18,
  total_supply: '1000000000000000000000000',
  holder_count: 2,
  truncated: false,
  holders: [
    { address: '0xAa00000000000000000000000000000000000000', balance: '999000500000000000000000', share: 0.9990005 },
    { address: '0x000000000000000000000000000000000000dEaD', balance: '999500000000000000000', share: 0.0009995 },
  ],
  as_of: { block: 1234, latest: false },
  burn_addresses: ['0x000000000000000000000000000000000000dEaD'],
}

describe('holdersCsv', () => {
  it('writes exact, ungrouped balances and marks burn addresses', () => {
    expect(holdersCsv(snapshot)).toBe(
      'address,balance,percent_of_supply,note\n' +
        '0xAa00000000000000000000000000000000000000,999000.5,99.900050,\n' +
        '0x000000000000000000000000000000000000dEaD,999.5,0.099950,burn address\n',
    )
  })

  it('names the file after the token, network and block', () => {
    expect(snapshotFileName(snapshot)).toBe('holders-NOVA-sepolia-block-1234.csv')
  })
})
