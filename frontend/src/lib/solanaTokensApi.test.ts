import { afterEach, describe, expect, it, vi } from 'vitest'

import { formatTokenAmount, maxSupplyFor, solanaTokensApi, validateTokenForm } from './solanaTokensApi'

describe('formatTokenAmount', () => {
  it('formats raw base units exactly, with grouping and trimmed fractions', () => {
    expect(formatTokenAmount('1234500', 2)).toBe('12,345')
    expect(formatTokenAmount('1234567', 2)).toBe('12,345.67')
    expect(formatTokenAmount('1000000000000000000', 9)).toBe('1,000,000,000')
    expect(formatTokenAmount('5', 0)).toBe('5')
  })

  it('handles a full u64 without float rounding', () => {
    expect(formatTokenAmount('18446744073709551615', 0)).toBe('18,446,744,073,709,551,615')
  })
})

describe('maxSupplyFor', () => {
  it('is u64 max divided by 10^decimals', () => {
    expect(maxSupplyFor(0)).toBe(18446744073709551615n)
    expect(maxSupplyFor(9)).toBe(18446744073n)
  })
})

describe('validateTokenForm', () => {
  it('accepts a normal token', () => {
    expect(validateTokenForm('My Token', 'MTK', '9', '1000000000')).toBeNull()
  })

  it.each([
    [['', 'MTK', '9', '1'], 'Give your token a name'],
    [['x'.repeat(33), 'MTK', '9', '1'], 'Name must be at most 32 bytes'],
    // 17 characters but 34 bytes — measured in UTF-8, like the program.
    [['é'.repeat(17), 'MTK', '9', '1'], 'Name must be at most 32 bytes'],
    [['My Token', 'TOOLONGSYMB', '9', '1'], 'Symbol must be at most 10 bytes'],
    [['My Token', 'MTK', '10', '1'], 'Decimals must be a whole number from 0 to 9'],
    [['My Token', 'MTK', '9', '0'], 'Supply must be a positive whole number of tokens'],
    [['My Token', 'MTK', '9', '1.5'], 'Supply must be a positive whole number of tokens'],
    [['My Token', 'MTK', '9', '20000000000'], 'At 9 decimals, supply can be at most 18,446,744,073 tokens'],
  ])('rejects %j', (args, message) => {
    expect(validateTokenForm(...(args as [string, string, string, string]))).toBe(message)
  })
})

describe('solanaTokensApi.prepare', () => {
  afterEach(() => vi.unstubAllGlobals())

  it('sends a multipart form, including the logo file only when there is one', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ mint: 'm', transaction: 't', metadata_uri: '' }) })
    vi.stubGlobal('fetch', fetchMock)

    const logo = new File(['png-bytes'], 'logo.png', { type: 'image/png' })
    await solanaTokensApi.prepare('tok', {
      network: 'solana_devnet',
      creator_wallet: 'Creator111',
      name: 'My Token',
      symbol: 'MTK',
      decimals: 6,
      supply: '1000',
      description: '',
      logo,
      revoke_mint_authority: false,
      revoke_freeze_authority: true,
    })

    const [url, init] = fetchMock.mock.calls[0]
    expect(url).toMatch(/\/solana-tokens\/prepare$/)
    const body = init.body as FormData
    expect(body.get('decimals')).toBe('6')
    expect(body.get('supply')).toBe('1000')
    expect(body.get('revoke_mint_authority')).toBe('false')
    expect(body.get('revoke_freeze_authority')).toBe('true')
    expect((body.get('logo') as File).name).toBe('logo.png')
  })
})
