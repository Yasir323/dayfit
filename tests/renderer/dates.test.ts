import { describe, expect, it } from 'vitest'
import { dayHeader, weekOf, weekdayShort } from '../../src/renderer/src/lib/dates'

describe('dates', () => {
  it('weekOf returns Monday–Sunday of the given week', () => {
    expect(weekOf('2026-10-23')).toEqual([
      '2026-10-19',
      '2026-10-20',
      '2026-10-21',
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25'
    ])
  })
  it('week spans Monday–Sunday across a month boundary', () => {
    expect(weekOf('2026-10-31')[6]).toBe('2026-11-01')
    expect(weekOf('2026-10-26')[0]).toBe('2026-10-26')
  })
  it('Sunday belongs to the week that started the Monday before', () => {
    expect(weekOf('2026-10-25')[0]).toBe('2026-10-19')
  })
  it('dayHeader and weekdayShort format in fixed English', () => {
    expect(dayHeader('2026-10-23')).toBe('Fri 23 Oct')
    expect(dayHeader('2026-11-01')).toBe('Sun 1 Nov')
    expect(weekdayShort('2026-10-26')).toBe('Mon')
  })
})
