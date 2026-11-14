// Crawls the built site under its real headers and fails on any
// Content-Security-Policy violation, enforced or report-only. Release
// checklist item 6: the full policy in deploy/Caddyfile is report-only until
// it's known not to break anything, and this is the part of that check a
// headless browser can do. Real wallet extensions (MetaMask, Phantom) still
// need a person on the live site.
//
//   node e2e/csp/crawl.mjs https://localhost [--insecure] [--max-pages 80]
//
// Starts at / and /tools and follows every same-origin link (dynamic pages
// such as /token/<network>/<address> only if something links them). On each
// page it opens the Solana wallet modal and the EVM connect flow (WalletConnect's
// QR modal when the build has a project id and no browser wallet is present),
// since the wallet adapters inject styles, fonts and frames of their own.
// CI's docker job runs it through Caddy.
import { chromium } from '@playwright/test'

const args = process.argv.slice(2)
const base = new URL(args.find((a) => !a.startsWith('--')) ?? 'https://localhost')
const insecure = args.includes('--insecure')
const maxPages = Number(args[args.indexOf('--max-pages') + 1]) || 80

const browser = await chromium.launch()
const context = await browser.newContext({ ignoreHTTPSErrors: insecure })
// securitypolicyviolation fires for report-only policies too (disposition
// "report"), so this sees what enforcing the policy would block.
await context.addInitScript(() => {
  window.__csp = []
  document.addEventListener('securitypolicyviolation', (e) => {
    window.__csp.push({
      directive: e.effectiveDirective,
      blocked: e.blockedURI,
      source: e.sourceFile ? `${e.sourceFile}:${e.lineNumber}` : '',
      sample: e.sample,
      disposition: e.disposition,
    })
  })
})

const queue = ['/', '/tools']
const seen = new Set(queue)
const violations = []
let visited = 0

async function tryClick(page, name) {
  const button = page.getByRole('button', { name, exact: true }).first()
  if (!(await button.isVisible().catch(() => false))) return false
  await button.click().catch(() => {})
  await page.waitForTimeout(1500)
  await page.keyboard.press('Escape').catch(() => {})
  return true
}

while (queue.length && visited < maxPages) {
  const path = queue.shift()
  const page = await context.newPage()
  page.on('pageerror', (err) => console.log(`  page error on ${path}: ${err.message}`))
  try {
    await page.goto(new URL(path, base).href, { waitUntil: 'networkidle', timeout: 30_000 })
  } catch (err) {
    console.log(`  ${path}: didn't settle (${err.message.split('\n')[0]}), checking what loaded`)
  }
  visited++

  const opened = []
  if (await tryClick(page, 'Connect Solana Wallet')) opened.push('solana modal')
  // With no browser wallet (headless), Connect EVM Wallet goes to
  // WalletConnect's QR modal itself; with one, the QR button is separate.
  if (await tryClick(page, 'Connect EVM Wallet')) opened.push('evm connect')
  if (await tryClick(page, 'Phone wallet (QR)')) opened.push('walletconnect modal')

  for (const href of await page.$$eval('a[href]', (as) => as.map((a) => a.getAttribute('href')))) {
    let url
    try {
      url = new URL(href, base)
    } catch {
      continue
    }
    if (url.origin !== base.origin || url.pathname.startsWith('/api/')) continue
    if (!seen.has(url.pathname)) {
      seen.add(url.pathname)
      queue.push(url.pathname)
    }
  }

  const found = await page.evaluate(() => window.__csp)
  console.log(`${found.length ? 'FAIL' : 'ok  '} ${path}${opened.length ? ` (+ ${opened.join(', ')})` : ''}`)
  for (const v of found) violations.push({ page: path, ...v })
  await page.close()
}
await browser.close()

console.log(`\n${visited} pages crawled, ${violations.length} CSP violations`)
const unique = new Map()
for (const v of violations) {
  const key = `${v.directive} ${v.blocked}`
  if (!unique.has(key)) unique.set(key, { ...v, pages: new Set() })
  unique.get(key).pages.add(v.page)
}
for (const v of unique.values()) {
  console.log(`- ${v.directive} blocked ${v.blocked || '(inline)'} [${v.disposition}] ${v.source} ${v.sample ? `"${v.sample}"` : ''}`)
  console.log(`  on ${[...v.pages].slice(0, 5).join(', ')}${v.pages.size > 5 ? ` and ${v.pages.size - 5} more` : ''}`)
}
if (visited < 10) {
  console.log(`only ${visited} pages reached; the crawl itself looks broken`)
  process.exit(1)
}
process.exit(violations.length ? 1 : 0)
