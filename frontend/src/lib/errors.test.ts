import { describe, expect, it } from 'vitest'

import { errorMessage } from './errors'

describe('errorMessage', () => {
  it('turns wallet and network failures into plain sentences', () => {
    expect(errorMessage(new Error('User rejected the request.\n\nRequest Arguments: …'), 'x')).toBe('You cancelled this in your wallet.')
    expect(errorMessage(Object.assign(new Error('long'), { name: 'WalletSignTransactionError' , message: 'User rejected the request.' }), 'x')).toBe('You cancelled this in your wallet.')
    expect(errorMessage(new Error('insufficient funds for gas * price + value'), 'x')).toBe("Your wallet doesn't have enough to pay the network fee for this.")
    expect(errorMessage(new Error('Attempt to debit an account but found no record of a prior credit.'), 'x')).toBe('This wallet has no SOL to pay the network fee.')
    expect(errorMessage(new TypeError('Failed to fetch'), 'x')).toMatch(/^Couldn't reach/)
  })

  it("keeps anything else, first line only, and prefers viem's short message", () => {
    expect(errorMessage(new Error('Name already taken'), 'x')).toBe('Name already taken')
    expect(errorMessage(Object.assign(new Error('The contract reverted.\n\nContract Call: …'), { shortMessage: 'Execution reverted: Trading not enabled' }), 'x')).toBe('Execution reverted: Trading not enabled')
    expect(errorMessage('not an error', 'Deploy failed')).toBe('Deploy failed')
  })
})
