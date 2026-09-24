import { describe, expect, it } from 'vitest'

import { parseAllowlist } from './allowlist'

const A = 'FoEsHYn3QLcBMae9YmkYC57ogWamP7zUqKNeuBgh6VwG'
const B = '9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM'

describe('parseAllowlist', () => {
  it('accepts one per line or comma/space separated, de-duplicating in paste order', () => {
    expect(parseAllowlist(`${A}\n${B}, ${A}\n\n`)).toEqual({ addresses: [A, B], invalid: [], duplicates: 1 })
  })

  it('flags anything that is not a Solana address', () => {
    const parsed = parseAllowlist(`${A}\n0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266\nhello`)
    expect(parsed.addresses).toEqual([A])
    expect(parsed.invalid).toEqual(['0xf39Fd6e51aad88F6F4ce6aB8827279cffFb92266', 'hello'])
  })

  it('handles empty input', () => {
    expect(parseAllowlist('   ')).toEqual({ addresses: [], invalid: [], duplicates: 0 })
  })
})
