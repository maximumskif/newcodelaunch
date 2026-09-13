import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ConfirmDialog } from './Dialog'

describe('ConfirmDialog — dismiss while confirming', () => {
  it('closes via Escape and backdrop click when idle', () => {
    const onCancel = vi.fn()
    const { container } = render(
      <ConfirmDialog open title="Delete this?" onConfirm={vi.fn()} onCancel={onCancel} isConfirming={false} />,
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).toHaveBeenCalledTimes(1)

    const backdrop = container.querySelector('[aria-hidden="true"]')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop as Element)
    expect(onCancel).toHaveBeenCalledTimes(2)
  })

  it('ignores Escape and backdrop click while a confirm is in flight', () => {
    // Regression: the Cancel button was correctly disabled while isConfirming
    // was true, but Dialog's own Escape/backdrop-click handlers still fired
    // onCancel unconditionally — closing the dialog and looking like the
    // action was aborted while the in-flight request kept running and
    // completed anyway moments later.
    const onCancel = vi.fn()
    const { container } = render(
      <ConfirmDialog open title="Delete this?" onConfirm={vi.fn()} onCancel={onCancel} isConfirming />,
    )

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onCancel).not.toHaveBeenCalled()

    const backdrop = container.querySelector('[aria-hidden="true"]')
    expect(backdrop).not.toBeNull()
    fireEvent.click(backdrop as Element)
    expect(onCancel).not.toHaveBeenCalled()

    // The Cancel button itself stays disabled too, same as before.
    expect(screen.getByText('Cancel')).toBeDisabled()
  })
})
