import type { HTMLAttributes } from 'react'

type Padding = 'sm' | 'md' | 'lg'
type Rounded = 'lg' | 'xl'

interface Props extends HTMLAttributes<HTMLDivElement> {
  padding?: Padding
  // 'lg' (default) matches every existing Card; 'xl' is for marketing/
  // feature cards specifically — see index.css's --radius-xl comment for
  // why that's a separate token from the form-control radii.
  rounded?: Rounded
  // Lifts on hover (border, background, and a subtle shadow) — for a Card
  // that's itself a click target (a Link-wrapped feature/grid card), not a
  // static content container. Off by default so every existing static
  // usage is visually unchanged.
  interactive?: boolean
  // The second, more opaque surface tier (index.css's --color-surface-raised)
  // — for a card nested inside another Card/section, so it reads as sitting
  // above its parent instead of blending into the same flat plane.
  raised?: boolean
}

const PADDING_CLASSES: Record<Padding, string> = {
  sm: 'p-3',
  md: 'p-5',
  lg: 'p-8',
}

const ROUNDED_CLASSES: Record<Rounded, string> = {
  lg: 'rounded-lg',
  xl: 'rounded-xl',
}

// The one surface-container style used app-wide. Deliberately restrained —
// rounded-lg (not -2xl/-3xl) by default, a subtle border, no shadow/glow
// unless interactive.
export function Card({
  padding = 'md',
  rounded = 'lg',
  interactive = false,
  raised = false,
  className = '',
  children,
  ...rest
}: Props) {
  const surface = raised ? 'bg-surface-raised' : 'bg-surface'
  const hover = interactive
    ? `transition-all duration-200 ease-out hover:-translate-y-0.5 hover:border-border-strong hover:shadow-elevated ${raised ? 'hover:bg-surface-raised-hover' : 'hover:bg-surface-hover'}`
    : ''
  return (
    <div
      className={`${ROUNDED_CLASSES[rounded]} border border-border ${surface} ${hover} ${PADDING_CLASSES[padding]} ${className}`}
      {...rest}
    >
      {children}
    </div>
  )
}
