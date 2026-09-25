import { parseAbi } from 'viem'

// contract_templates' token_timelock: one ERC-20 balance locked until
// releaseTime, then releasable (by anyone) only to the beneficiary.
export const TOKEN_TIMELOCK_ABI = parseAbi([
  'function token() view returns (address)',
  'function beneficiary() view returns (address)',
  'function releaseTime() view returns (uint256)',
  'function lockedAmount() view returns (uint256)',
  'function release()',
])
