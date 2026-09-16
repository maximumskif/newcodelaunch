import path from 'node:path'
import { fileURLToPath } from 'node:url'

import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from '@playwright/test'

const here = path.dirname(fileURLToPath(import.meta.url))

// A real axe-core scan in a real Chromium browser — the "run axe DevTools
// or Lighthouse in a real browser before trusting [color contrast /
// focus-ring visibility] is fine" note this project's own accessibility
// review left open (docs/REBUILD_PROGRESS.md), blocked until now on having
// a real browser available at all in any sandbox this was built in.
async function auditPage(page: Page) {
  return new AxeBuilder({ page })
    // Best-practice rules (not WCAG failures) are noisy and mostly a matter
    // of house style — scoped to the two real, user-facing standards this
    // review is actually checking against.
    .withTags(['wcag2a', 'wcag2aa'])
    .analyze()
}

// 2026-10: the design pass's fade-up mount animations (index.css's
// animate-fade-up, applied via PageHero to every page) run for real for
// ~400-800ms after navigation — a scan that runs immediately after
// page.goto() can sample an element mid-fade, at genuinely-but-transiently
// lower opacity, which axe correctly reports as a real (if momentary)
// contrast shortfall no actual visitor experiences once the page settles a
// fraction of a second later. Confirmed by reproducing it two ways: a fixed
// 1.5s wait before scanning made every failure disappear, and reduced-motion
// emulation (set here, before any navigation, so it's active from first
// paint rather than trying to interrupt an animation already in flight) does
// too — this app's own global `@media (prefers-reduced-motion: reduce)`
// rule (index.css) already zeroes every animation/transition duration,
// which Playwright's `reducedMotion: 'reduce'` context option triggers for
// real. Using that rather than an arbitrary sleep: it's deterministic,
// doesn't slow the suite down, and is itself a real accessibility path
// worth scanning — WCAG's motion-sensitivity guidance (2.3.3) is exactly
// for viewers with this preference set, so testing what they actually see
// is strictly more rigorous than testing the default animated state.
test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' })
})

function describeViolations(violations: Awaited<ReturnType<typeof auditPage>>['violations']): string {
  return violations
    .map((v) => {
      const uniqueSummaries = [...new Set(v.nodes.map((n) => n.failureSummary?.replace(/\n/g, ' ')))]
      return `[${v.impact}] ${v.id} (${v.nodes.length} node(s)): ${v.help}\n  ${uniqueSummaries.join('\n  ')}`
    })
    .join('\n')
}

test('marketing homepage has no WCAG 2 A/AA violations', async ({ page }) => {
  await page.goto('/')
  const { violations } = await auditPage(page)
  expect(violations, describeViolations(violations)).toEqual([])
})

test.describe('authenticated app shell', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      ;(window as unknown as { __E2E_ANVIL_RPC_URL__: string }).__E2E_ANVIL_RPC_URL__ = 'http://127.0.0.1:8545'
    })
    await page.addInitScript({ path: path.join(here, '.generated', 'injectedEvmWallet.bundle.js') })
    await page.goto('/dashboard')
    await page.getByRole('button', { name: 'Connect EVM Wallet' }).click()
    await page.getByRole('button', { name: /^Sign in with/ }).click()
    await expect(page.getByText(/EVM · 0xf39f/i)).toBeVisible({ timeout: 15_000 })
  })

  for (const route of ['/dashboard', '/tokens', '/nft', '/market', '/defi', '/marketplace']) {
    test(`${route} has no WCAG 2 A/AA violations`, async ({ page }) => {
      await page.goto(route)
      const { violations } = await auditPage(page)
      expect(violations, describeViolations(violations)).toEqual([])
    })
  }
})
