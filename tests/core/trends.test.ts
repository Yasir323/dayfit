import { describe, expect, it } from 'vitest'
import { burnoutRisk, energyLow, streaks } from '../../src/core/trends'
import type { DaySummary } from '../../src/core/summary'

const T = '2026-10-24'
const day = (date: string, o: Partial<DaySummary> = {}): DaySummary => ({
  date,
  focusMin: 0,
  breaksTaken: 4,
  waterMl: 2000,
  waterTargetMl: 2000,
  coffeeCups: 0,
  done: 0,
  moved: 0,
  dropped: 0,
  meetings: 0,
  moodAvg: null,
  overtime: false,
  ...o
})

describe('energyLow', () => {
  it('needs at least 6 check-ins over 2 different hours', () => {
    expect(energyLow({ [T]: [{ at: 630, score: 3 }] }, T)).toBeNull()
    const sameHour = { [T]: Array.from({ length: 6 }, () => ({ at: 630, score: 3 })) }
    expect(energyLow(sameHour, T)).toBeNull()
  })

  it('returns the start of the lowest-scoring hour', () => {
    const moods = {
      '2026-10-22': [
        { at: 630, score: 4 },
        { at: 905, score: 2 },
        { at: 990, score: 3 }
      ],
      '2026-10-23': [
        { at: 640, score: 5 },
        { at: 910, score: 1 },
        { at: 995, score: 3 }
      ]
    }
    expect(energyLow(moods, T)).toBe(900)
  })

  it('ignores check-ins older than 14 days', () => {
    const old = {
      '2026-10-01': Array.from({ length: 6 }, (_, k) => ({ at: 600 + k * 60, score: 1 }))
    }
    expect(energyLow(old, T)).toBeNull()
  })
})

describe('burnoutRisk', () => {
  it('reports how many days it judged (the view waits for 5)', () => {
    expect(burnoutRisk([day('a'), day('b')]).days).toBe(2)
  })

  it('is Low with few signal days', () => {
    expect(burnoutRisk([day('a'), day('b', { overtime: true })])).toEqual({
      level: 'Low',
      days: 2,
      late: 1,
      fewBreaks: 0,
      lowMood: 0
    })
  })

  it('counts a day once, Watch from 3 and High from 6', () => {
    const bad = (d: string): DaySummary => day(d, { overtime: true, breaksTaken: 1, moodAvg: 2 })
    expect(burnoutRisk(['a', 'b', 'c'].map(bad)).level).toBe('Watch')
    const six = ['a', 'b', 'c', 'd', 'e', 'f'].map(bad)
    expect(burnoutRisk(six)).toEqual({ level: 'High', days: 6, late: 6, fewBreaks: 6, lowMood: 6 })
  })

  it('only looks at the last 10 days', () => {
    const days = [
      ...Array.from({ length: 6 }, (_, k) => day(`o${k}`, { overtime: true })),
      ...Array.from({ length: 10 }, (_, k) => day(`n${k}`))
    ]
    expect(burnoutRisk(days).level).toBe('Low')
  })
})

describe('streaks', () => {
  it('counts back from the latest day and stops at a miss', () => {
    const days = [
      day('1'),
      null,
      day('3', { waterMl: 500 }),
      day('4', { breaksTaken: 1 }),
      day('5', { overtime: true }),
      day('6')
    ]
    expect(streaks(days)).toEqual({ water: 3, breaks: 2, onTime: 1 })
  })

  it('days with no summary (weekends) or barely any screen time are skipped, not breaks', () => {
    const days = [day('1'), day('2'), null, null, day('5', { screenMin: 20, waterMl: 0 }), day('6')]
    expect(streaks(days)).toEqual({ water: 3, breaks: 3, onTime: 3 })
  })

  it('today without a summary yet does not break the streak', () => {
    expect(streaks([day('1'), day('2'), null])).toEqual({ water: 2, breaks: 2, onTime: 2 })
  })

  it('an older row without overtime counts as on time', () => {
    const older = day('1') as Partial<DaySummary>
    delete older.overtime
    expect(streaks([older as DaySummary]).onTime).toBe(1)
  })
})

describe('days off in trends', () => {
  it('burnout and streaks ignore days off', () => {
    const off = (d: string): DaySummary => day(d, { offDay: true, breaksTaken: 0, overtime: true })
    expect(burnoutRisk([day('1'), off('2'), off('3'), off('4')])).toMatchObject({
      days: 1,
      level: 'Low'
    })
    expect(streaks([day('1'), off('2'), day('3')])).toEqual({ water: 2, breaks: 2, onTime: 2 })
  })
})
