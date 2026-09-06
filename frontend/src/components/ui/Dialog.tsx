import { useEffect, useId, useRef, type ReactNode } from 'react'

import { Button } from './Button'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  description?: string
  children?: ReactNode
}

// Minimal modal — a backdrop, Escape-to-close, closes on backdrop click, and
// focuses the panel on open so keyboard/screen-reader users land somewhere
// sensible rather than wherever focus happened to be. No focus trap (Tab can
// still leave the dialog) — fine for the one use case this exists for today
// (a confirm dialog with two buttons); revisit if a future dialog has more
// content worth trapping focus inside.
export function Dialog({ open, onClose, title, description, children }: DialogProps) {
  const panelRef = useRef<HTMLDivElement>(null)
  const titleId = useId()

  useEffect(() => {
    if (!open) return
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    panelRef.current?.focus()
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [open, onClose])

  if (!open) return null

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
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
    <Dialog open={open} onClose={onCancel} title={title} description={description}>
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
