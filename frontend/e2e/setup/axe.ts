import AxeBuilder from '@axe-core/playwright'
import { expect, type Page } from '@playwright/test'

// A real axe-core WCAG 2 A/AA scan of the page as it is right now — for
// specs that build up real state (a deployed contract, a live pool) and
// want the panels only that state renders scanned too. Reduced motion is
// switched on first for the reason accessibility.spec.ts gives: mid-fade
// elements read as low-contrast.
export async function expectNoA11yViolations(page: Page, state: string) {
  await page.emulateMedia({ reducedMotion: 'reduce' })
  const { violations } = await new AxeBuilder({ page }).withTags(['wcag2a', 'wcag2aa']).analyze()
  const described = violations
    .map((v) => {
      const summaries = [...new Set(v.nodes.map((n) => n.failureSummary?.replace(/\n/g, ' ')))]
      return `[${v.impact}] ${v.id} (${v.nodes.length} node(s)): ${v.help}\n  ${summaries.join('\n  ')}`
    })
    .join('\n')
  expect(violations, `${state}:\n${described}`).toEqual([])
}
