import { describe, it, expect } from 'vitest'
import { itemsForDate, rolloverItems } from '../../src/core/recurrence'
import type { Item } from '../../src/core/types'

const D = '2026-10-23'
const Y = '2026-10-22'

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

describe('itemsForDate', () => {
  it('weekdays repeat shows Fri, not Sat', () => {
    const s = mk({ repeat: { kind: 'weekdays' }, date: '2026-10-19' })
    expect(itemsForDate([s], '2026-10-23')).toHaveLength(1)
    expect(itemsForDate([s], '2026-10-24')).toHaveLength(0)
  })
  it('weekly days match', () => {
    const s = mk({ repeat: { kind: 'weekly', days: [2, 4] }, date: '2026-10-19' })
    expect(itemsForDate([s], '2026-10-27')).toHaveLength(1)
    expect(itemsForDate([s], '2026-10-28')).toHaveLength(0)
  })
  it('daily item not before its start date', () => {
    const s = mk({ repeat: { kind: 'daily' }, date: '2026-10-25' })
    expect(itemsForDate([s], '2026-10-24')).toHaveLength(0)
    expect(itemsForDate([s], '2026-10-26')).toHaveLength(1)
  })
  it('dropped never appears; done non-repeating still shows', () => {
    expect(itemsForDate([mk({ status: 'dropped' })], D)).toHaveLength(0)
    expect(itemsForDate([mk({ status: 'done' })], D)).toHaveLength(1)
    expect(itemsForDate([mk({ status: 'dropped', repeat: { kind: 'daily' } })], D)).toHaveLength(0)
  })
  it('non-repeating matches only its date', () => {
    expect(itemsForDate([mk({ date: Y })], D)).toHaveLength(0)
  })
})

describe('repeating tasks done for a day', () => {
  it('done on one day shows done that day only', () => {
    const daily = mk({ repeat: { kind: 'daily' }, date: Y, doneDates: [D] })
    expect(itemsForDate([daily], D)[0].status).toBe('done')
    expect(itemsForDate([daily], '2026-10-24')[0].status).toBe('open')
    expect(itemsForDate([daily], Y)[0].status).toBe('open')
  })

  it('an item without doneDates is open', () => {
    expect(itemsForDate([mk({ repeat: { kind: 'daily' } })], D)[0].status).toBe('open')
  })
})

describe('rolloverItems', () => {
  it('moves open task from yesterday to today and clears lock', () => {
    const t = mk({ date: Y, lockedStart: 600, suggestedSlots: [540] })
    const [r] = rolloverItems([t], D)
    expect(r.date).toBe(D)
    expect(r.lockedStart).toBeNull()
    expect(r.suggestedSlots).toEqual([])
    expect(t.date).toBe(Y)
  })
  it('leaves done, fixed, future and repeating unchanged', () => {
    const items = [
      mk({ date: Y, status: 'done' }),
      mk({ date: Y, fixedStart: 600 }),
      mk({ date: '2026-10-24' }),
      mk({ date: Y, repeat: { kind: 'daily' } })
    ]
    expect(rolloverItems(items, D)).toEqual(items)
  })
})
