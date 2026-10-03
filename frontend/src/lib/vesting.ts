import { parseAbi } from 'viem'

// contract_templates' token_vesting: one ERC-20 balance paid out linearly
// from startTime to endTime, nothing before cliffTime; release() (anyone may
// call it) pays what has vested to the beneficiary only; releasePart(amount)
// pays some of it, for tokens that cap a transfer.
export const TOKEN_VESTING_ABI = parseAbi([
  'function token() view returns (address)',
  'function beneficiary() view returns (address)',
  'function startTime() view returns (uint256)',
  'function cliffTime() view returns (uint256)',
  'function endTime() view returns (uint256)',
  'function released() view returns (uint256)',
  'function releasable() view returns (uint256)',
  'function release()',
  'function releasePart(uint256 amount)',
])

export interface Schedule {
  // Unix seconds.
  start: number
  cliff: number
  end: number
}

// The contract's vestedAmount(), for previews: total is what it holds plus
// what it has already paid out.
export function vestedAt(total: bigint, { start, cliff, end }: Schedule, timestamp: number): bigint {
  if (timestamp < cliff) return 0n
  if (timestamp >= end) return total
  return (total * BigInt(timestamp - start)) / BigInt(end - start)
}

// Calendar months, as people say them ("a 12-month vest with a 3-month
// cliff"). 31 Jan + 1 month lands on 3 Mar, as Date does — close enough for
// a preview, and the contract only ever sees the resulting timestamps.
export function addMonths(seconds: number, months: number): number {
  const date = new Date(seconds * 1000)
  date.setMonth(date.getMonth() + months)
  return Math.floor(date.getTime() / 1000)
}

export function buildSchedule(start: number, cliffMonths: number, lengthMonths: number): Schedule {
  return { start, cliff: addMonths(start, cliffMonths), end: addMonths(start, lengthMonths) }
}

// What the constructor would refuse, said before a wallet prompt. `now` is
// the chain's clock when known.
export function scheduleProblem(schedule: Schedule, now: number): string | null {
  if (schedule.end <= schedule.start) return 'Vesting has to last at least a month.'
  if (schedule.cliff > schedule.end) return 'The cliff can’t be longer than the vesting itself.'
  if (schedule.end <= now) return 'This schedule has already ended — pick a later start.'
  return null
}
