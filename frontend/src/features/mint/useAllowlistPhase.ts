import { useState } from 'react'

import { MAX_ALLOWLIST, parseAllowlist } from '../../lib/allowlist'
import type { AllowlistPhaseInput } from '../../lib/candyMachineApi'

export interface AllowlistPhaseInitial {
  addresses: string[]
  price_sol: number
  // datetime-local value (local time), not ISO.
  start: string
}

// State, parsing, and validation for a Candy Machine's optional allowlist
// phase — shared by launching a drop (MintLaunchPage) and editing a live
// one's phases (EditPhasesDialog), so both check exactly the same things.
// `publicStart` is the public go-live as a datetime-local value.
export function useAllowlistPhase(publicStart: string, initial?: AllowlistPhaseInitial | null) {
  const [enabled, setEnabled] = useState(Boolean(initial))
  const [text, setText] = useState(initial ? initial.addresses.join('\n') : '')
  const [price, setPrice] = useState(initial ? String(initial.price_sol) : '0.05')
  const [start, setStart] = useState(initial?.start ?? '')
  const parsed = parseAllowlist(text)

  const problem = !enabled
    ? null
    : parsed.invalid.length > 0
      ? `Not a Solana wallet address: ${parsed.invalid.slice(0, 3).join(', ')}${parsed.invalid.length > 3 ? '…' : ''}`
      : parsed.addresses.length === 0
        ? 'Add at least one wallet to the allowlist'
        : parsed.addresses.length > MAX_ALLOWLIST
          ? `An allowlist can hold at most ${MAX_ALLOWLIST} wallets`
          : !start || !(Number(price) > 0)
            ? 'Set the allowlist price and start time'
            : publicStart && new Date(start) >= new Date(publicStart)
              ? 'The allowlist phase must start before the public go-live date'
              : null

  // What to send to the API — undefined when there's no allowlist phase.
  const input: AllowlistPhaseInput | undefined = enabled
    ? { addresses: parsed.addresses, price_sol: Number(price), start_date: start ? new Date(start).toISOString() : '' }
    : undefined

  return { enabled, setEnabled, text, setText, price, setPrice, start, setStart, parsed, problem, input }
}

export type AllowlistPhaseState = ReturnType<typeof useAllowlistPhase>

// ISO timestamp -> datetime-local input value, in the browser's local time.
export function toLocalInput(iso: string): string {
  const date = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`
}
