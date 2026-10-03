import { Button } from '../../components/ui/Button'
import type { TokenLimits } from '../../lib/tokenLimits'

// Why a vesting or lock contract can't pay everything at once: the token
// caps transfers (or hasn't enabled trading) and the contract isn't exempt.
// The token's owner gets a button to exempt it, which is the real fix.
export function TokenLimitsNote({
  limits,
  amount,
  canExempt,
  onExempt,
  busy,
  exempting,
}: {
  limits: TokenLimits
  amount: (n: bigint) => string
  canExempt: boolean
  onExempt: () => void
  busy: boolean
  exempting: boolean
}) {
  return (
    <div className="space-y-2 rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-ink-muted" data-testid="token-limits">
      {!limits.tradingEnabled ? (
        <p>Trading on this token isn't enabled yet, so nothing can be sent from this contract. Releases work once the token's owner enables trading.</p>
      ) : (
        <p>
          This token caps a transfer at {amount(limits.maxTransaction)} and a wallet at {amount(limits.maxWallet)}, and this contract isn't exempt — so releases
          come in parts that fit. Release again for the rest; the recipient may need to move tokens out first to make room.
        </p>
      )}
      {canExempt ? (
        <>
          <p className="text-ink">You own this token. Exempting this contract from its limits lets a release pay everything at once.</p>
          <Button size="sm" disabled={busy} isLoading={exempting} onClick={onExempt}>
            Exempt from the token's limits
          </Button>
        </>
      ) : (
        <p>The token's owner can exempt this contract from those limits (Manage → fee exclusion).</p>
      )}
    </div>
  )
}
