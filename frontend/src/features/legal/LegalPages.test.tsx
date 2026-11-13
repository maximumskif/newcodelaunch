import { render, screen } from '@testing-library/react'
import { MemoryRouter } from 'react-router-dom'
import { describe, expect, it } from 'vitest'

import { UnauditedNotice } from '../tokens/UnauditedNotice'
import { LegalLinks } from './LegalLinks'
import { PrivacyPage, RisksPage, TermsPage } from './LegalPages'

const inRouter = (ui: React.ReactNode) => render(<MemoryRouter>{ui}</MemoryRouter>)

describe('legal pages', () => {
  it.each([
    ['terms', TermsPage, 'Terms of use'],
    ['privacy', PrivacyPage, 'Privacy'],
    ['risks', RisksPage, 'Risk disclosure'],
  ])('%s renders with the draft banner until reviewed', (_name, Page, title) => {
    inRouter(<Page />)
    expect(screen.getByRole('heading', { level: 1, name: title })).toBeInTheDocument()
    expect(screen.getByTestId('legal-draft')).toBeInTheDocument()
  })

  it('states the fees the contracts charge', () => {
    inRouter(<TermsPage />)
    expect(screen.getByText(/0\.7% to the platform and 0\.3% to the token/)).toBeInTheDocument()
    expect(screen.getByText(/0\.01 SOL/)).toBeInTheDocument()
  })

  it("says the contracts aren't audited and claims no audit", () => {
    const { container } = inRouter(<RisksPage />)
    expect(screen.getByRole('heading', { name: "The contracts aren't audited" })).toBeInTheDocument()
    expect(container.textContent).not.toMatch(/\baudited by\b|\baudit report\b/i)
  })

  it('doesn\'t invent an operator or contact when none is configured', () => {
    inRouter(<PrivacyPage />)
    expect(screen.queryByRole('link', { name: /@/ })).not.toBeInTheDocument()
    expect(screen.getAllByText(/contact details that will be listed here before launch/).length).toBeGreaterThan(0)
  })

  it('footer links point at all three pages', () => {
    inRouter(<LegalLinks />)
    const hrefs = screen.getAllByRole('link').map((a) => a.getAttribute('href'))
    expect(hrefs).toEqual(['/terms', '/privacy', '/risks'])
  })

  it('the unaudited notice links the risk disclosure', () => {
    inRouter(<UnauditedNotice native="ETH" />)
    expect(screen.getByRole('link', { name: 'Read the risks' })).toHaveAttribute('href', '/risks')
  })
})
