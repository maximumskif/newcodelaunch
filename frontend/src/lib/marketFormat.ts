const SUBSCRIPT = '₀₁₂₃₄₅₆₇₈₉'

// Prices the way DEX screens show them: tiny ones as $0.0₅1234 (five zeros
// after the point, then the significant digits) instead of 1.234e-6.
export function formatPrice(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value >= 1) return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  if (value === 0) return '$0'
  // Zeros between the point and the first significant digit (0.0001 → 3).
  const zeros = Math.ceil(-Math.log10(value)) - 1
  if (zeros < 4) return `$${value.toPrecision(4)}`
  const digits = Math.round(value * 10 ** (zeros + 4)).toString().slice(0, 4)
  return `$0.0${[...String(zeros)].map((d) => SUBSCRIPT[Number(d)]).join('')}${digits}`
}

export function formatLarge(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—'
  if (value >= 1e12) return `$${(value / 1e12).toFixed(2)}T`
  if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
  if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
  if (value >= 1e3) return `$${(value / 1e3).toFixed(1)}K`
  return `$${value.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
}
