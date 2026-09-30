import { parseAbi } from 'viem'

// The Multisend template (backend contract_templates.py): one ERC-20 from
// the caller to many wallets, after approving it for the total.
export const MULTISEND_ABI = parseAbi(['function send(address token, address[] recipients, uint256[] amounts)'])
