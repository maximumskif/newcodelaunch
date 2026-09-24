import type { AllowlistPhaseState } from './useAllowlistPhase'

// The optional allowlist-phase section of a Candy Machine form — the same
// fields and checks whether launching a drop or editing a live one.
export function AllowlistPhaseFields({ phase, disabled }: { phase: AllowlistPhaseState; disabled: boolean }) {
  return (
    <fieldset className="space-y-3 rounded-md border border-border p-3">
      <legend className="px-1 text-sm text-ink-muted">Allowlist phase (optional)</legend>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="mt-0.5"
          checked={phase.enabled}
          disabled={disabled}
          onChange={(e) => phase.setEnabled(e.target.checked)}
        />
        <span>
          Add an allowlist phase before public minting opens
          <span className="block text-xs text-ink-faint">
            Only listed wallets can mint, at their own price, until public minting opens. Enforced on-chain.
          </span>
        </span>
      </label>
      {phase.enabled && (
        <>
          <label className="block text-sm text-ink-muted">
            Allowlisted wallets (one per line, or comma-separated)
            <textarea
              rows={4}
              value={phase.text}
              disabled={disabled}
              onChange={(e) => phase.setText(e.target.value)}
              className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 font-mono text-xs text-ink"
            />
          </label>
          <p className="text-xs text-ink-faint">
            {phase.parsed.addresses.length} wallet{phase.parsed.addresses.length === 1 ? '' : 's'}
            {phase.parsed.duplicates > 0 ? ` (${phase.parsed.duplicates} duplicate${phase.parsed.duplicates === 1 ? '' : 's'} removed)` : ''}
          </p>
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="block text-sm text-ink-muted">
              Allowlist price (SOL)
              <input
                type="number"
                min={0}
                step="0.01"
                value={phase.price}
                disabled={disabled}
                onChange={(e) => phase.setPrice(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
            <label className="block text-sm text-ink-muted">
              Allowlist start
              <input
                type="datetime-local"
                value={phase.start}
                disabled={disabled}
                onChange={(e) => phase.setStart(e.target.value)}
                className="mt-1 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-ink"
              />
            </label>
          </div>
          {phase.problem && <p className="text-xs text-warning">{phase.problem}</p>}
        </>
      )}
    </fieldset>
  )
}
