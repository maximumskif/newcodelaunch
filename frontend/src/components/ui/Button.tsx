import { forwardRef, type ButtonHTMLAttributes } from 'react'

import { IconSpinner } from './icons'

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'danger'
export type ButtonSize = 'sm' | 'md' | 'lg'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  isLoading?: boolean
}

const VARIANT_CLASSES: Record<ButtonVariant, string> = {
  // Solid area color with dark text (the terminal redesign): the accent
  // scale follows the page's data-pillar, so a primary button is green in
  // Tokens, magenta in NFTs, and so on. Dark on these light accents is
  // above 8:1.
  primary: 'bg-accent-500 text-canvas hover:bg-accent-400',
  secondary: 'border border-border text-ink hover:border-border-strong hover:bg-surface-hover',
  ghost: 'text-ink-muted hover:text-ink hover:bg-surface-hover',
  danger: 'bg-danger-strong text-white hover:bg-danger-stronger',
}

const SIZE_CLASSES: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs gap-1',
  md: 'px-4 py-1.5 text-sm gap-1.5',
  // Primary calls to action (a storefront's mint button, hero CTAs).
  lg: 'px-6 py-3 text-base gap-2',
}

// For non-<button> elements that need to look like one — e.g. a react-router
// <Link> styled as a primary CTA. Keeps every button-shaped thing in the app
// visually identical without duplicating the variant/size class strings.
export function buttonClassName(variant: ButtonVariant = 'secondary', size: ButtonSize = 'md', className = ''): string {
  // transition-all (not transition-colors) so the glow/transform below
  // animate too, not just color — active:scale is a cheap, real tactile
  // press cue with no motion for prefers-reduced-motion (index.css's global
  // media query already zeroes every transition duration for that case).
  // whitespace-nowrap: a button shrinking below its label's natural width in
  // a tight flex row (e.g. two wallet-connect buttons on a phone-width
  // screen) should never wrap the label across multiple lines inside the
  // button — the row wrapping the buttons themselves is the right behavior,
  // not the text inside one.
  return `inline-flex items-center justify-center rounded-md font-mono font-medium whitespace-nowrap transition-all duration-150 ease-out active:scale-[0.97] disabled:cursor-not-allowed disabled:opacity-40 disabled:active:scale-100 ${VARIANT_CLASSES[variant]} ${SIZE_CLASSES[size]} ${className}`
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
