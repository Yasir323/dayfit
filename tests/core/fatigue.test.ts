import { describe, expect, it } from 'vitest'
import { dayRate, minuteOf, slowing, updateBaseline, type MinuteStat } from '../../src/core/fatigue'

describe('minuteOf', () => {
  it('adds up active seconds, cursor path and direction changes', () => {
    const samples = [
      { x: 0, y: 0, idle: 0 },
      { x: 30, y: 40, idle: 0 }, // 50 px
      { x: 0, y: 40, idle: 1 }, // 30 px, turned back
      { x: 0, y: 40, idle: 9 } // away
    ]
    // Active = seconds the cursor moved while the user was there.
    expect(minuteOf(samples)).toEqual({ active: 4, path: 80, turns: 1 })
  })

  it('an empty minute is all zeros', () => {
    expect(minuteOf([])).toEqual({ active: 0, path: 0, turns: 0 })
  })
})

const m = (path: number, active = 60): MinuteStat => ({ active, path, turns: 0 })

describe('slowing', () => {
  it('never fires without a baseline or with under 20 active minutes', () => {
    expect(
      slowing(
        Array.from({ length: 30 }, () => m(10)),
        null
      )
    ).toBe(false)
    expect(
      slowing(
        Array.from({ length: 19 }, () => m(10)),
        100
      )
    ).toBe(false)
  })

  it('fires when the last 20 active minutes run 35% or more below the baseline', () => {
    const slow = Array.from({ length: 20 }, () => m(60 * 65))
    expect(slowing(slow, 100)).toBe(true)
    const fine = Array.from({ length: 20 }, () => m(60 * 66))
    expect(slowing(fine, 100)).toBe(false)
  })

  it('ignores mostly idle minutes', () => {
    const minutes = [
      ...Array.from({ length: 20 }, () => m(60 * 100)),
      ...Array.from({ length: 5 }, () => m(0, 10))
    ]
    expect(slowing(minutes, 100)).toBe(false)
  })
})

describe('baseline', () => {
  it('starts from the first day and moves a seventh of the way each day', () => {
    expect(updateBaseline(null, 70)).toBe(70)
    expect(updateBaseline(70, 140)).toBe(80)
    expect(updateBaseline(70, null)).toBe(70)
  })

  it('dayRate is path per active second over active minutes, or null', () => {
    expect(dayRate([m(600, 60), m(300, 30), m(0, 5)])).toBe(10)
    expect(dayRate([])).toBeNull()
  })
})

describe('typing does not look like slowing down', () => {
  it('only seconds with cursor movement count as active', () => {
    const typing = Array.from({ length: 30 }, () => ({ x: 5, y: 5, idle: 0 }))
    expect(minuteOf(typing).active).toBe(0)
  })
})
