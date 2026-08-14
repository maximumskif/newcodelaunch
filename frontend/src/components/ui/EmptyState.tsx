import type { ReactNode } from 'react'

interface Props {
  title: string
  description?: string
  action?: ReactNode
  compact?: boolean
}

export function EmptyState({ title, description, action, compact = false }: Props) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border text-center ${
        compact ? 'py-6' : 'py-12'
      }`}
    >
      <p className="text-sm text-ink-muted">{title}</p>
      {description && <p className="max-w-sm text-xs text-ink-faint">{description}</p>}
      {action}
    </div>
  )
}
