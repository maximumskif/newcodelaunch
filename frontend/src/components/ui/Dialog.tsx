import { useEffect, useId, useRef, type ReactNode } from 'react'

import { Button } from './Button'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
  // False while a confirmed action is in flight — Escape/backdrop-click
  // used to close the dialog unconditionally even then, which looked like
  // it cancelled the action (the confirm button's own `disabled`/isLoading
  // state was the only thing gated) while the request kept running
  // underneath and completed moments later anyway. Defaults to true so
  // every other Dialog usage is unaffected.
  dismissible?: boolean
}

// Minimal modal — a backdrop, Escape-to-close, closes on backdrop click, and
// focuses the panel on open so keyboard/screen-reader users land somewhere
// sensible rather than wherever focus happened to be. No focus trap (Tab can
// still leave the dialog) — fine for the one use case this exists for today
// (a confirm dialog with two buttons); revisit if a future dialog has more
// content worth trapping focus inside.
export function Dialog({ open, onClose, title, description, children, dismissible = true }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  // Split from the Escape-listener effect below on purpose: `onClose` isn't
  // memoized by any real caller, so an effect keyed on `[open, onClose,
  // dismissible]` re-runs on every render while the dialog stays open
  // (e.g. ConfirmDialog's own isConfirming toggling true/false mid-confirm)
  // — its cleanup would restore focus and its next run would re-capture
  // and re-focus the panel on every one of those renders, a real focus
  // flicker. Keying this effect on `[open]` alone means the
  // capture-on-open/restore-on-close pair only ever runs once per actual
  // open/close transition.
  useEffect(() => {
    if (!open) return
    // Whatever had focus right before this dialog opened (the button that
    // triggered it, in every real usage) — found via a real keyboard-only
    // pass: without restoring this on close, the browser dropped focus to
    // <body> the moment the focused panel unmounted, so a keyboard user
    // who opened then cancelled a *delete confirmation* lost their place
    // on the page entirely and had to tab from the very top to find it
    // again. A generic Dialog can't know its trigger ahead of time the way
    // a specific button's own ref could, so it captures whatever was
    // actually focused instead — the same restore-on-close behavior
    // WAI-ARIA's dialog pattern describes.
    const previouslyFocused = document.activeElement as HTMLElement | null
    panelRef.current?.focus()
    return () => previouslyFocused?.focus()
  }, [open])

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && dismissible) onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose, dismissible])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        className="absolute inset-0 bg-black/50"
        onClick={dismissible ? onClose : undefined}
        aria-hidden="true"
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        className="relative w-full max-w-sm rounded-lg border border-border bg-surface p-5 shadow-lg outline-none"
      >
        <h2 id={titleId} className="text-sm font-medium text-ink">
          {title}
        </h2>
        {description && <p className="mt-2 text-sm text-ink-muted">{description}</p>}
        {children && <div className="mt-4">{children}</div>}
      </div>
    </div>
  )
}

interface ConfirmDialogProps {
  open: boolean
  title: string
  description?: string
  confirmLabel?: string
  cancelLabel?: string
  isConfirming?: boolean
  onConfirm: () => void
  onCancel: () => void
}

// The specific case Dialog exists for right now: a destructive action (see
// ProjectsDashboard's delete button) that previously fired immediately on
// click with no way to back out. Not a generic "modal system" built ahead
// of need — this wraps Dialog for exactly the one real consumer that
// motivated building it.
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  isConfirming = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onClose={onCancel} title={title} description={description} dismissible={!isConfirming}>
      <div className="flex justify-end gap-2">
        <Button variant="secondary" size="sm" onClick={onCancel} disabled={isConfirming}>
          {cancelLabel}
        </Button>
        <Button variant="danger" size="sm" onClick={onConfirm} isLoading={isConfirming}>
          {confirmLabel}
        </Button>
      </div>
    </Dialog>
  )
}
