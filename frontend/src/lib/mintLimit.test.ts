import { describe, expect, it } from 'vitest'

import { parseMintLimit } from './mintLimit'

describe('parseMintLimit', () => {
  it('treats empty as no limit', () => {
    expect(parseMintLimit('  ')).toEqual({ value: undefined, problem: null })
  })

  it('accepts 1 to 65535', () => {
    expect(parseMintLimit('3')).toEqual({ value: 3, problem: null })
    expect(parseMintLimit('65535').value).toBe(65535)
  })

  it.each(['0', '65536', '2.5', '-1', 'x'])('rejects %j', (text) => {
    expect(parseMintLimit(text).problem).toMatch(/whole number from 1 to 65535/)
  })
})
