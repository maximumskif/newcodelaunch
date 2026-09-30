import { describe, expect, it } from 'vitest'

import { ipfsImageCandidates, ipfsPath } from './ipfsGateways'

describe('ipfs gateways', () => {
  it('finds the CID path in gateway URLs and ipfs:// URIs', () => {
    expect(ipfsPath('https://gateway.pinata.cloud/ipfs/bafyABC')).toBe('bafyABC')
    expect(ipfsPath('https://x.mypinata.cloud/ipfs/bafyDIR/1.png')).toBe('bafyDIR/1.png')
    expect(ipfsPath('ipfs://bafyABC')).toBe('bafyABC')
    expect(ipfsPath('https://cdn.example.com/a.png')).toBeNull()
  })

  it('tries the given URL first, then gateways that allow embedding', () => {
    expect(ipfsImageCandidates('https://gateway.pinata.cloud/ipfs/bafyABC')).toEqual([
      'https://gateway.pinata.cloud/ipfs/bafyABC',
      'https://ipfs.io/ipfs/bafyABC',
      'https://dweb.link/ipfs/bafyABC',
    ])
    expect(ipfsImageCandidates('ipfs://bafyABC')).toEqual(['https://ipfs.io/ipfs/bafyABC', 'https://dweb.link/ipfs/bafyABC'])
    expect(ipfsImageCandidates('https://cdn.example.com/a.png')).toEqual(['https://cdn.example.com/a.png'])
  })
})
