import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes, useLocation } from 'react-router-dom'
import { describe, expect, it, vi } from 'vitest'

import { CommandPalette } from './CommandPalette'

function Where() {
  const location = useLocation()
  return <p data-testid="where">{location.pathname + location.search}</p>
}

function renderPalette(onClose = vi.fn()) {
  render(
    <MemoryRouter initialEntries={['/']}>
      <Routes>
        <Route path="*" element={<><Where /><CommandPalette open onClose={onClose} /></>} />
      </Routes>
    </MemoryRouter>,
  )
  return onClose
}

describe('CommandPalette', () => {
  it('finds a tool by a keyword and opens it with Enter', async () => {
    const onClose = renderPalette()
    await userEvent.type(screen.getByRole('combobox'), 'uniswap')
    expect(screen.getAllByRole('option')[0]).toHaveTextContent('Pool on Uniswap / PancakeSwap')
    await userEvent.keyboard('{Enter}')
    expect(onClose).toHaveBeenCalled()
    expect(screen.getByTestId('where')).toHaveTextContent('/tokens/create')
  })

  it('lists tools that are coming, but will not open them', async () => {
    const onClose = renderPalette()
    await userEvent.type(screen.getByRole('combobox'), 'vesting')
    const option = screen.getByRole('option', { name: /Vesting/ })
    expect(option).toHaveAttribute('aria-disabled', 'true')
    await userEvent.click(option)
    expect(onClose).not.toHaveBeenCalled()
    expect(screen.getByTestId('where')).toHaveTextContent(/^\/$/)
  })

  it('moves with the arrow keys and closes on Escape', async () => {
    const onClose = renderPalette()
    const input = screen.getByRole('combobox')
    await userEvent.click(input)
    await userEvent.keyboard('{ArrowDown}')
    expect(screen.getAllByRole('option')[1]).toHaveAttribute('aria-selected', 'true')
    expect(input.getAttribute('aria-activedescendant')).toBe(screen.getAllByRole('option')[1].id)
    await userEvent.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalled()
  })
})
