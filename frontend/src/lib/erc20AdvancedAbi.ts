// The parts of contract_templates' erc20_advanced its owner manages after
// deploying (features/contracts/Erc20ManagePanel.tsx). `marketPairs`,
// `setMarketPair`, `isExcludedFromFees` and `renounceOwnership` only exist
// on contracts deployed from the 2026-09-24 template onward — the panel
// probes for them rather than assuming.
const view = (name: string, output: string, inputs: { name: string; type: string }[] = []) =>
  ({ type: 'function', name, stateMutability: 'view', inputs, outputs: [{ type: output }] }) as const
const write = (name: string, inputs: { name: string; type: string }[] = []) =>
  ({ type: 'function', name, stateMutability: 'nonpayable', inputs, outputs: [] }) as const

export const ERC20_ADVANCED_ABI = [
  view('owner', 'address'),
  view('symbol', 'string'),
  view('decimals', 'uint8'),
  view('tradingEnabled', 'bool'),
  view('buyTaxRate', 'uint256'),
  view('sellTaxRate', 'uint256'),
  view('marketingFee', 'uint256'),
  view('liquidityFee', 'uint256'),
  view('maxTransactionAmount', 'uint256'),
  view('maxWalletAmount', 'uint256'),
  view('marketingWallet', 'address'),
  view('liquidityWallet', 'address'),
  view('marketPairs', 'bool', [{ name: 'pair', type: 'address' }]),
  write('enableTrading'),
  write('updateTaxRates', [
    { name: '_buyTax', type: 'uint256' },
    { name: '_sellTax', type: 'uint256' },
  ]),
  write('updateWallets', [
    { name: '_marketing', type: 'address' },
    { name: '_liquidity', type: 'address' },
  ]),
  write('updateLimits', [
    { name: '_maxTx', type: 'uint256' },
    { name: '_maxWallet', type: 'uint256' },
  ]),
  write('excludeFromFees', [
    { name: 'account', type: 'address' },
    { name: 'excluded', type: 'bool' },
  ]),
  write('setMarketPair', [
    { name: 'pair', type: 'address' },
    { name: 'isPair', type: 'bool' },
  ]),
  write('renounceOwnership'),
] as const

// "3.5" (%) -> 350 (basis points), or null for anything that isn't a
// percentage from 0 to 10 with at most two decimals — the contract's cap.
export function percentToBps(text: string): number | null {
  if (!/^\d+(\.\d{1,2})?$/.test(text.trim())) return null
  const bps = Math.round(Number(text.trim()) * 100)
  return bps <= 1000 ? bps : null
}
