interface Props {
  checked: boolean
  onChange: (checked: boolean) => void
  disabled?: boolean
  /** e.g. "deploys to", "launches on", "mints on" — the rest of the sentence is fixed. */
  verb: string
  /** e.g. "mainnet", "Solana Mainnet" */
  networkLabel: string
}

// Shared by DeployPanel/MintLaunchPage/MintBuyPage — was copy-pasted three
// times and had already drifted (DeployPanel's copy was missing `disabled`).
export function MainnetConfirmCheckbox({ checked, onChange, disabled, verb, networkLabel }: Props) {
  return (
    <label className="flex items-start gap-2 rounded-md border border-warning/30 bg-warning/5 px-3 py-2 text-sm text-ink-muted">
      <input
        type="checkbox"
        checked={checked}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
        className="mt-0.5"
      />
      <span>
        This {verb} <span className="font-medium text-ink">{networkLabel}</span> using real funds from your wallet —
        not reversible. I understand and want to continue.
      </span>
    </label>
  )
}
