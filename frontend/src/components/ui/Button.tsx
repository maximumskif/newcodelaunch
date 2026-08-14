import { forwardRef, type ButtonHTMLAttributes } from 'react'

import { IconSpinner } from './icons'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'
type Size = 'sm' | 'md'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  isLoading?: boolean
}

const VARIANT_CLASSES: Record<Variant, string> = {
  primary: 'bg-accent-600 text-white hover:bg-accent-500',
  secondary: 'border border-border text-ink hover:bg-surface-hover',
  ghost: 'text-ink-muted hover:text-ink hover:bg-surface-hover',
  danger: 'bg-danger-strong text-white hover:bg-danger',
}

const SIZE_CLASSES: Record<Size, string> = {
  sm: 'px-2.5 py-1 text-xs gap-1',
  md: 'px-4 py-1.5 text-sm gap-1.5',
}

// The one place button styling is decided app-wide — every feature should
// reach for this instead of hand-rolling `rounded-md bg-accent-600 px-4...`.
export const Button = forwardRef<HTMLButtonElement, Props>(function Button(
  { variant = 'secondary', size = 'md', isLoading = false, disabled, className = '', children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center rounded-md font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`}
      {...rest}
    >
      {isLoading && <IconSpinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  )
})
