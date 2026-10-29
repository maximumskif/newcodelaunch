import { parseAbi } from 'viem'

import type { CurveTrade } from './tokenPagesApi'

// contract_templates' curve_token: a token that is its own market until it
// graduates. 80% of the supply sells on a constant-product curve with
// virtual reserves; buying the last of it moves the raised ETH and the other
// 20% into the network's V2 pool, LP burned. Every buy and sell pays a 1%
// fee in ETH, on top of a buy and out of a sale: 0.3% of the trade to the
// creator, 0.7% to the platform. Each share is kept apart from the reserve
// until it's sent on (claimCreatorFees(), withdrawFees()). Trades read the contract's own
// quoteBuy/quoteSell; this file's math (the contract's, in bigint) is for
// previews before there is a contract to ask.
export const CURVE_ABI = parseAbi([
  'function name() view returns (string)',
  'function symbol() view returns (string)',
  'function totalSupply() view returns (uint256)',
  'function curveSupply() view returns (uint256)',
  'function poolSupply() view returns (uint256)',
  'function graduationTarget() view returns (uint256)',
  'function virtualEth() view returns (uint256)',
  'function virtualTokens() view returns (uint256)',
  'function ethReserve() view returns (uint256)',
  'function tokensSold() view returns (uint256)',
  'function graduated() view returns (bool)',
  'function pair() view returns (address)',
  'function balanceOf(address owner) view returns (uint256)',
  'function FEE_BPS() view returns (uint256)',
  'function feeRecipient() view returns (address)',
  'function feesOwed() view returns (uint256)',
  'function creator() view returns (address)',
  'function creatorFeesOwed() view returns (uint256)',
  'function claimCreatorFees() returns (uint256 amount)',
  'function quoteBuy(uint256 value) view returns (uint256 tokens, uint256 cost, uint256 fee)',
  'function quoteSell(uint256 tokens) view returns (uint256 eth, uint256 fee)',
  'function buy(uint256 minTokens) payable returns (uint256 tokens)',
  'function sell(uint256 tokens, uint256 minEth) returns (uint256 eth)',
  'function withdrawFees() returns (uint256 amount)',
  'event Buy(address indexed buyer, uint256 eth, uint256 fee, uint256 tokens, uint256 ethReserve, uint256 tokensSold)',
  'event Sell(address indexed seller, uint256 tokens, uint256 eth, uint256 fee, uint256 ethReserve, uint256 tokensSold)',
  'event Graduated(address indexed pair, uint256 eth, uint256 tokens)',
  'event FeesWithdrawn(address indexed to, uint256 amount)',
  'event CreatorFeesClaimed(address indexed to, uint256 amount)',
])

// The template's FEE_BPS and CREATOR_FEE_BPS: 1% of every curve buy and
// sell, 0.3% of it to the creator.
export const FEE_BPS = 100n
export const CREATOR_FEE_BPS = 30n

const UNIT = 10n ** 18n

export interface CurveTerms {
  totalSupply: bigint
  curveSupply: bigint
  poolSupply: bigint
  target: bigint
  virtualEth: bigint
  virtualTokens: bigint
}

export interface CurveState {
  ethReserve: bigint
  tokensSold: bigint
}

// The contract's constants for a supply (whole tokens) and target (wei).
export function curveTerms(supplyWhole: bigint, target: bigint): CurveTerms {
  const totalSupply = supplyWhole * UNIT
  const curveSupply = (totalSupply * 4n) / 5n
  return {
    totalSupply,
    curveSupply,
    poolSupply: totalSupply - curveSupply,
    target,
    virtualEth: target / 3n,
    virtualTokens: curveSupply + (totalSupply * 4n) / 15n,
  }
}

const ceilDiv = (a: bigint, b: bigint) => (a + b - 1n) / b

// The contract's quoteBuy: for `value` paid, the tokens, what goes into the
// curve (cost) and the fee. cost + fee is all of `value`, except when it buys
// out the curve: then it's less, and the rest is refunded.
export function quoteBuy(terms: CurveTerms, state: CurveState, value: bigint): { tokens: bigint; cost: bigint; fee: bigint } {
  if (value <= 0n) return { tokens: 0n, cost: 0n, fee: 0n }
  const k = terms.virtualEth * terms.virtualTokens
  let cost = (value * 10000n) / (10000n + FEE_BPS)
  let tokens = terms.virtualTokens - state.tokensSold - ceilDiv(k, terms.virtualEth + state.ethReserve + cost)
  let fee = value - cost
  if (tokens >= terms.curveSupply - state.tokensSold) {
    tokens = terms.curveSupply - state.tokensSold
    cost = ceilDiv(k, terms.virtualTokens - terms.curveSupply) - terms.virtualEth - state.ethReserve
    fee = ceilDiv(cost * FEE_BPS, 10000n)
  }
  return { tokens, cost, fee }
}

// The contract's quoteSell: the ETH the seller receives, and the fee.
export function quoteSell(terms: CurveTerms, state: CurveState, tokens: bigint): { eth: bigint; fee: bigint } {
  if (tokens <= 0n || tokens > state.tokensSold) return { eth: 0n, fee: 0n }
  const k = terms.virtualEth * terms.virtualTokens
  const out = terms.virtualEth + state.ethReserve - ceilDiv(k, terms.virtualTokens - state.tokensSold + tokens)
  const fee = ceilDiv(out * FEE_BPS, 10000n)
  return { eth: out - fee, fee }
}

// Price of one whole token, in the native coin, at a point on the curve.
export function priceAt(terms: CurveTerms, state: CurveState): number {
  return Number(terms.virtualEth + state.ethReserve) / Number(terms.virtualTokens - state.tokensSold)
}

// Where the pool opens: the curve's last price, and the market cap there
// (5x the target: everything raised is paired with a fifth of the supply).
export function graduationPrice(terms: CurveTerms): number {
  return Number(terms.target) / Number(terms.poolSupply)
}

// Share of the raise reached, 0–1.
export const progress = (terms: Pick<CurveTerms, 'target'>, state: Pick<CurveState, 'ethReserve'>) =>
  terms.target > 0n ? Math.min(1, Number(state.ethReserve) / Number(terms.target)) : 0

// 1% slippage on whatever a trade quotes.
export const withSlippage = (amount: bigint) => (amount * 99n) / 100n

// A starting raise target per native coin — what the form suggests; the
// creator can change it. Testnets get a small one so a curve can be bought
// out with faucet coins.
export const SUGGESTED_TARGET: Record<string, string> = {
  ethereum: '4',
  base: '4',
  bsc: '20',
  polygon: '20000',
  sepolia: '0.02',
  base_sepolia: '0.02',
  bsc_testnet: '0.1',
}

// The backend's limits on the template's parameters.
export const MIN_SUPPLY = 1_000n
export const MAX_SUPPLY = 10n ** 15n
export const MIN_TARGET = 10n ** 15n
export const MAX_TARGET = 10n ** 24n

// The price after each of a curve's recent trades, oldest first: the
// curve's own state from the trade's event, through the contract's math.
// `fromLaunch` adds the launch price first (when these are all its trades).
export function pricePoints(terms: CurveTerms, trades: CurveTrade[], { fromLaunch = false } = {}): { trade: CurveTrade | null; price: number }[] {
  const after = [...trades].reverse().map((trade) => ({
    trade: trade as CurveTrade | null,
    price: priceAt(terms, { ethReserve: BigInt(trade.eth_reserve), tokensSold: BigInt(trade.tokens_sold) }),
  }))
  return fromLaunch ? [{ trade: null, price: priceAt(terms, { ethReserve: 0n, tokensSold: 0n }) }, ...after] : after
}
