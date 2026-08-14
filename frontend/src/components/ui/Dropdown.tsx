import { useEffect, useRef, useState, type ReactNode } from 'react'

interface Props {
  trigger: ReactNode
  children: ReactNode
  align?: 'left' | 'right'
}

// Minimal click-toggle dropdown — closes on outside click or Escape.
// Not a full menu/listbox implementation (no roving tabindex); fine for the
// nav's small, mostly-link content. Revisit if a future use case needs more.
export function Dropdown({ trigger, children, align = 'left' }: Props) {
  const [isOpen, setIsOpen] = useState(false)
  const containerRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!isOpen) return

    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsOpen(false)
    }
    document.addEventListener('pointerdown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown)
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown)
    }
  }, [isOpen])

  return (
    <div ref={containerRef} className="relative">
      <button
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
