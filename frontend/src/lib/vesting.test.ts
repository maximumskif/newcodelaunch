import { describe, expect, it } from 'vitest'

import { addMonths, buildSchedule, scheduleProblem, vestedAt } from './vesting'

const schedule = { start: 1000, cliff: 1250, end: 2000 }

describe('vestedAt', () => {
  it('matches the contract: nothing before the cliff, linear from the start, everything at the end', () => {
    expect(vestedAt(400n, schedule, 1249)).toBe(0n)
    expect(vestedAt(400n, schedule, 1250)).toBe(100n)
    expect(vestedAt(400n, schedule, 1500)).toBe(200n)
    expect(vestedAt(400n, schedule, 2000)).toBe(400n)
    expect(vestedAt(400n, schedule, 9999)).toBe(400n)
  })
})

describe('schedules', () => {
  it('counts calendar months', () => {
    const jan15 = Date.UTC(2027, 0, 15, 12) / 1000
    expect(new Date(addMonths(jan15, 12) * 1000).toISOString()).toBe('2028-01-15T12:00:00.000Z')
    const built = buildSchedule(jan15, 3, 12)
    expect(new Date(built.cliff * 1000).getUTCMonth()).toBe(3)
    expect(built.end).toBe(addMonths(jan15, 12))
  })

  it('says what the contract would refuse', () => {
    expect(scheduleProblem(buildSchedule(5000, 0, 0), 0)).toMatch(/at least a month/)
    expect(scheduleProblem(buildSchedule(5000, 13, 12), 0)).toMatch(/cliff can’t be longer/)
    expect(scheduleProblem({ start: 10, cliff: 10, end: 20 }, 20)).toMatch(/already ended/)
    expect(scheduleProblem(buildSchedule(5000, 3, 12), 0)).toBeNull()
  })
})
