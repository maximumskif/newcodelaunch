// The bonding-curve contracts hold buyers' coins until graduation and have
// not been independently audited. Say so plainly wherever money goes in:
// the launch page and the trade panel. Don't soften this or imply an audit
// until one has actually been done (docs/RELEASE_CHECKLIST.md, item 14).
export function UnauditedNotice({ native }: { native: string }) {
  return (
    <p role="note" className="rounded-md border border-warning/40 bg-warning/5 p-3 text-xs text-ink-muted" data-testid="unaudited-notice">
      <span className="font-medium text-ink">Not audited.</span> The bonding-curve contract hasn&apos;t been independently audited. Until it graduates, a
      curve holds the {native} its buyers pay in, and a bug in its code could lose that {native} with no way to get it back. Only put in what you can
      afford to lose.
    </p>
  )
}
