import { parseAbi } from 'viem'

// The slices of Uniswap V2 (and its PancakeSwap V2 fork — same interface)
// that adding liquidity for one of this app's tokens needs. See
// features/contracts/LiquidityPanel.tsx and backend services/liquidity.py.
export const UNISWAP_V2_ROUTER_ABI = parseAbi([
  'function addLiquidityETH(address token, uint256 amountTokenDesired, uint256 amountTokenMin, uint256 amountETHMin, address to, uint256 deadline) payable returns (uint256 amountToken, uint256 amountETH, uint256 liquidity)',
])

export const UNISWAP_V2_FACTORY_ABI = parseAbi(['function getPair(address tokenA, address tokenB) view returns (address pair)'])

export const UNISWAP_V2_PAIR_ABI = parseAbi([
  'function getReserves() view returns (uint112 reserve0, uint112 reserve1, uint32 blockTimestampLast)',
  'function token0() view returns (address)',
  'function totalSupply() view returns (uint256)',
  'function balanceOf(address owner) view returns (uint256)',
])

export const ERC20_ABI = parseAbi([
  'function symbol() view returns (string)',
  'function decimals() view returns (uint8)',
  'function balanceOf(address owner) view returns (uint256)',
  'function allowance(address owner, address spender) view returns (uint256)',
  'function approve(address spender, uint256 amount) returns (bool)',
])
