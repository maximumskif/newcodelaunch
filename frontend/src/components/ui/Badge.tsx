import type { ReactNode } from 'react'

export type BadgeTone = 'neutral' | 'success' | 'warning' | 'danger' | 'info' | 'accent'

interface Props {
  tone?: BadgeTone
  children: ReactNode
}

const TONE_CLASSES: Record<BadgeTone, string> = {
  neutral: 'bg-surface-hover text-ink-muted ring-border-strong',
  success: 'bg-success/10 text-success ring-success/30',
  warning: 'bg-warning/10 text-warning ring-warning/30',
  danger: 'bg-danger/10 text-danger ring-danger/30',
  info: 'bg-info/10 text-info ring-info/30',
  accent: 'bg-accent-500/10 text-accent-300 ring-accent-500/30',
}

// Status pill used for anything that means "state" — never decoration.
export function Badge({ tone = 'neutral', children }: Props) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ${TONE_CLASSES[tone]}`}>
      {children}
    </span>
  )
}
