import { forwardRef, type ButtonHTMLAttributes } from 'react'

import { IconSpinner } from './icons'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  isLoading?: boolean
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  primary: 'bg-accent-600 text-white hover:bg-accent-500',
  secondary: 'border border-border text-ink hover:bg-surface-hover',
  ghost: 'text-ink-muted hover:text-ink hover:bg-surface-hover',
  danger: 'bg-danger-strong text-white hover:bg-danger',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs gap-1',
  md: 'px-4 py-1.5 text-sm gap-1.5',
}

// For non-<button> elements that need to look like one — e.g. a react-router
// <Link> styled as a primary CTA. Keeps every button-shaped thing in the app
// visually identical without duplicating the variant/size class strings.
export function buttonClassName(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className = ''): string {
  return `inline-flex items-center justify-center rounded-md font-medium transition-colors duration-150 disabled:cursor-not-allowed disabled:opacity-40 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`
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
      className={buttonClassName(variant, size, className)}
      {...rest}
    >
      {isLoading && <IconSpinner className="h-3.5 w-3.5" />}
      {children}
    </button>
  )
})
