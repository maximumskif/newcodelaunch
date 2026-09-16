import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  trigger: ReactNode
  children: ReactNode
  align?: 'left' | 'right'
  // Applied to the outer positioning wrapper, not the trigger button itself
  // — for callers in a `flex-wrap` row that need to control where this
  // dropdown (and thus its `align`-anchored menu) ends up sitting once
  // wrapped onto its own line, e.g. `ml-auto` to keep it pinned to that
  // line's right edge (see ProjectContextBar's "Switch project" trigger).
  className?: string
}

// Minimal click-toggle dropdown — closes on outside click or Escape.
// Not a full menu/listbox implementation (no roving tabindex); fine for the
// nav's small, mostly-link content. Revisit if a future use case needs more.
export function Dropdown({ trigger, children, align = 'left', className = '' }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    // Found via a real keyboard-only pass: tabbing into an open menu's
    // items, then pressing Escape, closed the menu but left focus behind —
    // the browser dropped it to <body> once the focused item unmounted, so
    // the next Tab restarted from the top of the page instead of
    // continuing from this trigger. Returning focus to the trigger here
    // matches the WAI-ARIA menu-button pattern and what Dialog.tsx already
    // does. Outside-click deliberately doesn't also refocus the trigger —
    // the user's click already moved their attention somewhere real.
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsOpen(false)
        triggerRef.current?.focus()
      }
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div ref={containerRef} className={`relative ${className}`}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={isOpen}
        onClick={() => setIsOpen((open) => !open)}
        className="flex items-center gap-1 text-ink-muted hover:text-ink"
      >
        {trigger}
      </button>
      {isOpen && (
        <div
          onClick={() => setIsOpen(false)}
          className={`absolute top-full z-20 mt-2 w-64 rounded-lg border border-border bg-surface p-1.5 shadow-md ${
            align === 'right' ? 'right-0' : 'left-0'
          }`}
        >
          {children}
        </div>
      )}
    </div>
  )
}
