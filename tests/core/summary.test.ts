import { describe, expect, it } from 'vitest'
import { formatSummary, summarizeDay, type DayStats } from '../../src/core/summary'
import type { Block, Item } from '../../src/core/types'

const D = '2026-10-23'

let n = 0
const mk = (o: Partial<Item> = {}): Item => ({
  id: `i${++n}`,
  title: 't',
  type: 'task',
  durationMin: 30,
  label: null,
  priority: 'med',
  half: null,
  date: D,
  fixedStart: null,
  deadline: null,
  repeat: { kind: 'none' },
  status: 'open',
  lockedStart: null,
  suggestedSlots: [],
  dnd: false,
  createdAt: 0,
  ...o
})
const blk = (itemId: string, kind: Block['kind'], start: number, end: number): Block => ({
  itemId,
  kind,
  start,
  end,
  chunk: null,
  reason: ''
})
const stats = (o: Partial<DayStats> = {}): DayStats => ({
  breaksTaken: 0,
  focusMin: 0,
  moved: 0,
  ...o
})

describe('summarizeDay', () => {
  it('adds up the day', () => {
    const deep = mk({ id: 'deep', type: 'deep', status: 'done' })
    const openDeep = mk({ id: 'deep2', type: 'deep' })
    const items = [
      deep,
      openDeep,
      mk({ id: 'a', status: 'done' }),
      mk({ id: 'b', status: 'done' }),
      mk({ id: 'c' }),
      mk({ id: 'x', status: 'dropped' }),
      mk({ id: 'old', status: 'dropped', date: '2026-10-22' }),
      mk({ id: 'm1', type: 'fixed', fixedStart: 600 }),
      mk({ id: 'm2', type: 'fixed', fixedStart: 700, status: 'done' }),
      mk({ id: 'r', repeat: { kind: 'daily' }, doneDates: [D], date: '2026-10-01' })
    ]
    const blocks = [
      blk('deep', 'deep', 540, 600),
      blk('deep', 'deep', 620, 650),
      blk('deep2', 'deep', 660, 720),
      blk('a', 'task', 720, 750)
    ]
    expect(
      summarizeDay({
        date: D,
        items,
        blocks,
        stats: stats({ breaksTaken: 6, focusMin: 25, moved: 2 }),
        waterMl: 1500,
        waterTargetMl: 2000,
        coffeeCups: 2,
        moods: [
          { at: 630, score: 4 },
          { at: 810, score: 2 },
          { at: 990, score: 4 }
        ]
      })
    ).toEqual({
      moodAvg: 3.3,
      date: D,
      focusMin: 90 + 25,
      breaksTaken: 6,
      waterMl: 1500,
      waterTargetMl: 2000,
      coffeeCups: 2,
      done: 4, // deep, a, b, repeating r
      moved: 2,
      dropped: 1,
      meetings: 2
    })
  })

  it('an empty day is all zeros', () => {
    const s = summarizeDay({
      date: D,
      items: [],
      blocks: [],
      stats: stats(),
      waterMl: 0,
      waterTargetMl: 2000,
      coffeeCups: 0
    })
    expect(s).toMatchObject({ focusMin: 0, done: 0, moved: 0, dropped: 0, meetings: 0 })
  })
})

describe('formatSummary', () => {
  it('reads as one line', () => {
    expect(
      formatSummary({
        date: D,
        focusMin: 130,
        breaksTaken: 6,
        waterMl: 1500,
        waterTargetMl: 2000,
        coffeeCups: 1,
        done: 4,
        moved: 0,
        dropped: 0,
        meetings: 2
      })
    ).toBe('Focus 2h 10m · Water 1500 / 2000 ml · Breaks 6 · Done 4')
  })

  it('short focus shows minutes only', () => {
    const base = summarizeDay({
      date: D,
      items: [],
      blocks: [],
      stats: stats({ focusMin: 45 }),
      waterMl: 0,
      waterTargetMl: 2000,
      coffeeCups: 0
    })
    expect(formatSummary(base)).toBe('Focus 45m · Water 0 / 2000 ml · Breaks 0 · Done 0')
  })
})
