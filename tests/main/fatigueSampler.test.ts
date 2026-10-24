import { describe, expect, it } from 'vitest'
import { createFatigueSampler } from '../../src/main/fatigueSampler'

describe('createFatigueSampler', () => {
  it('folds 30 samples into a minute and keeps the last 30 minutes', () => {
    let x = 0
    const s = createFatigueSampler(
      () => ({ x: (x += 10), y: 0 }),
      () => 0
    )
    for (let k = 0; k < 30 * 31; k++) s.sample('2026-10-26')
    const snap = s.snapshot('2026-10-26')
    expect(snap.minutes).toHaveLength(30)
    // 29 moves inside each 30-sample minute.
    expect(snap.minutes[0]).toEqual({ active: 58, path: 290, turns: 0 })
    expect(snap.todayRate).toBeCloseTo(290 / 58)
  })

  it('a new day starts the day pace again', () => {
    const s = createFatigueSampler(
      () => ({ x: 0, y: 0 }),
      () => 0
    )
    for (let k = 0; k < 30; k++) s.sample('2026-10-26')
    expect(s.snapshot('2026-10-27').todayRate).toBeNull()
  })
})

describe('sampler across days', () => {
  it('a new day clears the recent minutes too', () => {
    let x = 0
    const s = createFatigueSampler(
      () => ({ x: (x += 10), y: 0 }),
      () => 0
    )
    for (let k = 0; k < 30 * 3; k++) s.sample('2026-10-26')
    for (let k = 0; k < 30; k++) s.sample('2026-10-27')
    expect(s.snapshot('2026-10-27').minutes).toHaveLength(1)
  })
})
