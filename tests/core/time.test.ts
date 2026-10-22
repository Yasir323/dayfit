import { describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/core/types'
import {
  addDays,
  formatClock,
  halfBoundary,
  minutesOf,
  nextWeekday,
  parseClock,
  toDateStr,
  weekday
} from '../../src/core/time'

describe('time utils', () => {
  it('parseClock', () => {
    expect(parseClock('14:00')).toBe(840)
    expect(parseClock('2pm')).toBe(840)
    expect(parseClock('2:30pm')).toBe(870)
    expect(parseClock('12am')).toBe(0)
    expect(parseClock('12pm')).toBe(720)
    expect(parseClock('9:30')).toBe(570)
    expect(parseClock('25:00')).toBeNull()
    expect(parseClock('9:75')).toBeNull()
    expect(parseClock('13pm')).toBeNull()
    expect(parseClock('nope')).toBeNull()
  })
  it('formatClock', () => {
    expect(formatClock(545)).toBe('09:05')
  })
  it('date math', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28')
    expect(weekday('2026-10-23')).toBe(5)
    expect(nextWeekday('2026-10-23', 1)).toBe('2026-10-26')
    expect(nextWeekday('2026-10-23', 5)).toBe('2026-10-23')
  })
  it('halfBoundary', () => {
    expect(halfBoundary(DEFAULT_SETTINGS)).toBe(810)
    expect(halfBoundary({ ...DEFAULT_SETTINGS, lunch: 780 })).toBe(780)
  })
  it('toDateStr / minutesOf use local time', () => {
    const d = new Date(2026, 9, 23, 14, 5)
    expect(toDateStr(d)).toBe('2026-10-23')
    expect(minutesOf(d)).toBe(845)
  })
})
