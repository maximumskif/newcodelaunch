const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉'

// Prices the way DEX screens show them: tiny ones as $0.0₅1234 (five zeros
// after the point, then the significant digits) instead of 1.234e-6.
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  if (value === 0) return '$0'
  return `$${subscriptZeros(value) ?? value.toPrecision(4)}`
}

// 0.0₅1234 for a value under 0.0001; null when it doesn't need it.
function subscriptZeros(value: number): string | null {
  // Zeros between the point and the first significant digit (0.0001 → 3).
  const zeros = Math.ceil(-Math.log10(value)) - 1
  if (zeros < 4) return null
  const digits = Math.round(value * 10 ** (zeros + 4)).toString().slice(0, 4)
  return `0.0${[...String(zeros)].map((d) => SUBSCRIPT[Number(d)]).join('')}${digits}`
}

// The same idea without a currency, for amounts and prices in a coin:
// 660.87M, 1,234.5678, 0.002, 0.0₁₁8266.
export function formatAmount(value: number): string {
  if (value >= 1e6) return new Intl.NumberFormat('en-US', { notation: 'compact', maximumFractionDigits: 2 }).format(value)
  if (value >= 1 || value === 0) return value.toLocaleString('en-US', { maximumFractionDigits: 4 })
  return subscriptZeros(value) ?? String(Number(value.toPrecision(4)))
}

export function formatLarge(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}
