import type { ReactNode } from 'react'

interface Props {
  children: ReactNode
  className?: string
}

// role="alert" — found via the same real accessibility pass that fixed
// AppShell/Dropdown/Dialog's focus-loss bugs (see docs/REBUILD_PROGRESS.md):
// none of this app's ~15 scattered `{error && <p className="text-danger">}`
// error messages were wrapped in anything a screen reader announces
// automatically. A sighted user sees the red text appear the instant a
// deploy/upload/generate call fails; a screen reader user got nothing
// until they happened to re-explore the page. `role="alert"` is itself an
// implicit assertive live region that gets announced the moment it's
// inserted into the DOM — exactly this codebase's existing "only render
// the <p> when there's an error" conditional pattern, no restructuring
// needed to adopt it.
export function InlineError({ children, className = 'text-sm text-danger' }: Props) {
  return (
    <p role="alert" className={className}>
      {children}
    </p>
  )
}
