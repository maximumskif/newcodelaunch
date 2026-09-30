import type { ReactNode } from 'react'

import { Button } from '../../components/ui/Button'
import type { ParseResult, Recipient } from '../../lib/airdrop'

export interface BatchResult {
  recipients: Recipient[]
  // Solana signature or EVM transaction hash.
  signature?: string
  error?: string
}

export const short = (address: string) => `${address.slice(0, 4)}…${address.slice(-4)}`

export function RecipientsField({ text, onChange, parsed, placeholder }: { text: string; onChange: (text: string) => void; parsed: ParseResult | null; placeholder: string }) {
  return (
    <>
      <label className="flex flex-col gap-1.5 text-sm">
        <span className="font-mono text-xs text-ink-faint">recipients — one per line: address, amount</span>
        <textarea
          value={text}
          onChange={(event) => onChange(event.target.value)}
          rows={10}
          spellCheck={false}
          placeholder={placeholder}
          className="rounded-md border border-border bg-canvas px-3 py-2 font-mono text-xs text-ink placeholder:text-ink-faint focus:border-accent-500 focus:outline-none"
        />
        <span className="text-xs text-ink-faint">Commas, tabs or spaces all work, so a spreadsheet column pastes straight in. A header line is skipped.</span>
      </label>
      {parsed && parsed.problems.length > 0 && (
        <div role="alert" className="space-y-1 rounded-md border border-warning/40 bg-warning/5 p-3 text-sm">
          <p className="text-ink">
            {parsed.problems.length} line{parsed.problems.length === 1 ? '' : 's'} can't be used — fix or remove {parsed.problems.length === 1 ? 'it' : 'them'}:
          </p>
          <ul className="max-h-40 space-y-0.5 overflow-y-auto font-mono text-xs text-ink-muted">
            {parsed.problems.map((problem) => (
              <li key={problem.line}>
                line {problem.line}: {problem.reason}
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  )
}

export function SummaryRow({ label, children, warn = false }: { label: string; children: ReactNode; warn?: boolean }) {
  return (
    <div className="flex justify-between gap-3">
      <dt className="text-ink-faint">{label}</dt>
      <dd className={warn ? 'text-warning' : 'text-ink'}>{children}</dd>
    </div>
  )
}

// What was sent, batch by batch, with a retry for the batches that failed.
export function AirdropLog({ results, txUrl, onRetry, busy }: { results: BatchResult[]; txUrl: (signature: string) => string; onRetry: () => void; busy: boolean }) {
  if (!results.length) return null
  const count = (list: BatchResult[]) => list.reduce((n, result) => n + result.recipients.length, 0)
  const failed = results.filter((result) => result.error)
  const sent = count(results) - count(failed)
  return (
    <section aria-labelledby="airdrop-log" className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="airdrop-log" className="font-mono text-sm font-semibold text-ink-faint">
          sent to {sent} of {count(results)} wallets
        </h2>
        {failed.length > 0 && !busy && (
          <Button size="sm" variant="secondary" onClick={onRetry}>
            retry failed ({count(failed)})
          </Button>
        )}
      </div>
      <ol className="space-y-1.5 rounded-lg border border-border bg-surface p-4 font-mono text-xs" data-testid="airdrop-log">
        {results.map((result, index) => (
          <li key={index} className="flex flex-wrap gap-x-3">
            <span className={result.error ? 'text-warning' : 'text-success'}>{result.error ? '✗' : '✓'}</span>
            <span className="text-ink">
              {result.recipients.length} wallet{result.recipients.length === 1 ? '' : 's'} (lines {result.recipients[0].line}–{result.recipients.at(-1)!.line})
            </span>
            {result.signature && (
              <a href={txUrl(result.signature)} target="_blank" rel="noreferrer" className="text-accent-300 hover:underline">
                {short(result.signature)} ↗
              </a>
            )}
            {result.error && <span className="break-all text-ink-muted">{result.error}</span>}
          </li>
        ))}
      </ol>
    </section>
  )
}

// Moves failed batches' recipients out of the log, for resending.
export function takeFailed(results: BatchResult[]): { kept: BatchResult[]; retry: Recipient[] } {
  return { kept: results.filter((result) => !result.error), retry: results.filter((result) => result.error).flatMap((result) => result.recipients) }
}
