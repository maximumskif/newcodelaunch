import type { HTMLAttributes } from 'react'

type Padding = 'sm' | 'md' | 'lg'

interface Props extends HTMLAttributes<HTMLDivElement> {
  padding?: Padding
}

const PADDING_CLASSES: Record<Padding, string> = {
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-8',
}

// The one surface-container style used app-wide. Deliberately restrained —
// rounded-lg (not -2xl/-3xl), a subtle border, no shadow/glow by default.
export function Card({ padding = 'md', className = '', children, ...rest }: Props) {
  return (
    <div className={`rounded-lg border border-border bg-surface ${PADDING_CLASSES[padding]} ${className}`} {...rest}>
      {children}
    </div>
  )
}
