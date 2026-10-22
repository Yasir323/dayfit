import { describe, expect, test } from 'vitest'
import { planDay, type PlanInput } from '../../src/core/scheduler'
import { fitFirst, subtract } from '../../src/core/freeTime'
import {
  DEFAULT_SETTINGS,
  type Block,
  type DecisionAnswer,
  type Item,
  type Settings
} from '../../src/core/types'

const D = '2026-10-23'

let n = 0
const item = (o: Partial<Item> = {}): Item => {
  n += 1
  return {
    id: `i${String(n).padStart(3, '0')}`,
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
    createdAt: n,
    ...o
  }
}
const fixed = (start: number, durationMin: number, o: Partial<Item> = {}): Item =>
  item({ type: 'fixed', fixedStart: start, durationMin, ...o })
const deep = (durationMin = 120, o: Partial<Item> = {}): Item =>
  item({ type: 'deep', durationMin, ...o })

const noWalks: Settings = {
  ...DEFAULT_SETTINGS,
  walk: { ...DEFAULT_SETTINGS.walk, enabled: false }
}

const input = (items: Item[], o: Partial<PlanInput> = {}): PlanInput => ({
  date: D,
  now: 0,
  items,
  settings: DEFAULT_SETTINGS,
  frozen: [],
  answers: [],
  ...o
})

const deepBlocks = (bs: Block[]): Block[] => bs.filter((b) => b.kind === 'deep')

describe('freeTime', () => {
  test('subtract pads busy on both sides and drops empty pieces', () => {
    expect(subtract([{ start: 540, end: 1080 }], [{ start: 570, end: 585 }], 5)).toEqual([
      { start: 540, end: 565 },
      { start: 590, end: 1080 }
    ])
    expect(subtract([{ start: 540, end: 600 }], [{ start: 530, end: 600 }], 5)).toEqual([])
  })
  test('fitFirst returns the earliest fit, optionally within a range', () => {
    const free = [
      { start: 540, end: 565 },
      { start: 590, end: 1080 }
    ]
    expect(fitFirst(free, 30)).toEqual({ start: 590, end: 620 })
    expect(fitFirst(free, 20)).toEqual({ start: 540, end: 560 })
    expect(fitFirst(free, 30, { start: 700, end: 800 })).toEqual({ start: 700, end: 730 })
    expect(fitFirst(free, 30, { start: 700, end: 720 })).toBeNull()
  })
})

describe('planDay part 1', () => {
  test('fixed run outside work hours still appears', () => {
    const run = fixed(1110, 45)
    const r = planDay(input([run, deep()]))
    expect(r.blocks).toContainEqual(
      expect.objectContaining({ itemId: run.id, kind: 'fixed', start: 1110, end: 1155 })
    )
    expect(r.blocks.filter((b) => b.itemId !== run.id && b.end > 1080)).toEqual([])
  })

  test('deep goes earliest whole slot', () => {
    const d = deep(120)
    const r = planDay(input([fixed(570, 15), d]))
    expect(deepBlocks(r.blocks)).toEqual([
      {
        itemId: d.id,
        kind: 'deep',
        start: 590,
        end: 710,
        chunk: null,
        reason: 'Earliest free slot'
      }
    ])
  })

  test('deep @pm lands after boundary', () => {
    const r = planDay(input([deep(120, { half: 'pm' })]))
    const [b] = deepBlocks(r.blocks)
    expect(b.start).toBeGreaterThanOrEqual(810)
    expect(b.reason).toBe('Earliest free slot in second half')
  })

  test('deep @am reason mentions first half', () => {
    const r = planDay(input([deep(120, { half: 'am' })]))
    expect(deepBlocks(r.blocks)[0]).toMatchObject({
      start: 540,
      end: 660,
      reason: 'Earliest free slot in first half'
    })
  })

  test('deep splits into 60m chunks when no 2h gap', () => {
    // 15-min fixed items every 90 min from 09:00 leave 65-min gaps after buffers
    const fx = [540, 630, 720, 810, 900, 990].map((s) => fixed(s, 15))
    const d = deep(120)
    const r = planDay(input([...fx, d], { settings: noWalks }))
    const bs = deepBlocks(r.blocks)
    expect(bs).toHaveLength(2)
    expect(bs.map((b) => b.end - b.start)).toEqual([60, 60])
    expect(bs.map((b) => b.chunk)).toEqual([
      { index: 0, of: 2 },
      { index: 1, of: 2 }
    ])
    expect(bs.every((b) => b.reason === 'Split: no 120m gap')).toBe(true)
    expect(bs[1].start).toBeGreaterThan(bs[0].end)
  })

  test('150m remainder merges into last chunk', () => {
    // 15-min fixed items every 120 min from 09:00 leave 95-min gaps after buffers
    const fx = [540, 660, 780, 900, 1020].map((s) => fixed(s, 15))
    const r = planDay(input([...fx, deep(150)], { settings: noWalks }))
    expect(deepBlocks(r.blocks).map((b) => b.end - b.start)).toEqual([60, 90])
  })

  test('half-overflow when am is full', () => {
    const d = deep(120, { half: 'am' })
    const items = [fixed(540, 270), d]
    const r = planDay(input(items))
    expect(r.decisions).toEqual([{ kind: 'half-overflow', itemId: d.id, preferred: 'am' }])
    expect(deepBlocks(r.blocks)).toEqual([])

    const answers: DecisionAnswer[] = [{ itemId: d.id, choice: 'use-other-half' }]
    const r2 = planDay(input(items, { answers }))
    expect(r2.decisions).toEqual([])
    const [b] = deepBlocks(r2.blocks)
    expect(b.start).toBeGreaterThanOrEqual(810)
  })

  test('no-fit when nothing fits', () => {
    const d = deep(120)
    const r = planDay(input([fixed(540, 480), d]))
    expect(r.decisions).toEqual([{ kind: 'no-fit', itemId: d.id }])
    expect(deepBlocks(r.blocks)).toEqual([])
  })

  test('fixed items overlapping work edges block that time', () => {
    const a = fixed(525, 30)
    const b = fixed(1050, 60)
    const r = planDay(input([a, b, deep(120), deep(60)]))
    const flex = r.blocks.filter((x) => x.kind !== 'fixed')
    expect(flex.length).toBeGreaterThan(0)
    expect(flex.every((x) => x.start >= 560 && x.end <= 1045)).toBe(true)
  })

  test('walks every 2h in gaps', () => {
    const r = planDay(input([]))
    const walks = r.blocks.filter((b) => b.kind === 'walk')
    const targets = [660, 780, 900, 1020]
    expect(walks).toHaveLength(targets.length)
    walks.forEach((w, k) => {
      expect(Math.abs(w.start - targets[k])).toBeLessThanOrEqual(30)
      expect(w.end - w.start).toBe(10)
      expect(w.reason).toBe('Walk break')
      expect(w.itemId).toBeNull()
    })
  })

  test('walk moves to the nearest gap and skips when none is within 30 min', () => {
    // busy 10:30-11:20 (padded 10:25-11:25): 11:00 target moves to 11:25; 13:00 target blocked entirely
    const r = planDay(input([fixed(630, 50), fixed(720, 120)]))
    const walks = r.blocks.filter((b) => b.kind === 'walk').map((w) => w.start)
    expect(walks).toEqual([685, 900, 1020])
  })

  test('walks are skipped when disabled', () => {
    expect(planDay(input([], { settings: noWalks })).blocks).toEqual([])
  })

  test('placements never start before now', () => {
    const r = planDay(input([deep(120)], { now: 600 }))
    expect(r.blocks.every((b) => b.start >= 600)).toBe(true)
    expect(deepBlocks(r.blocks)[0].start).toBe(600)
  })

  test('deep items are placed by priority, then createdAt', () => {
    const low = deep(120, { priority: 'low' })
    const high = deep(120, { priority: 'high' })
    const r = planDay(input([low, high], { settings: noWalks }))
    expect(deepBlocks(r.blocks).map((b) => b.itemId)).toEqual([high.id, low.id])
  })

  test('locked items become blocks of their kind', () => {
    const d = deep(60, { lockedStart: 900 })
    const t = item({ type: 'call', durationMin: 15, lockedStart: 600 })
    const r = planDay(input([d, t], { settings: noWalks }))
    expect(r.blocks).toEqual([
      { itemId: t.id, kind: 'task', start: 600, end: 615, chunk: null, reason: 'Locked' },
      { itemId: d.id, kind: 'deep', start: 900, end: 960, chunk: null, reason: 'Locked' }
    ])
  })

  test('frozen block wins over fixed item (no duplicate)', () => {
    const f = fixed(540, 30)
    const frozen: Block = {
      itemId: f.id,
      kind: 'fixed',
      start: 540,
      end: 570,
      chunk: null,
      reason: 'Done'
    }
    const r = planDay(input([f], { frozen: [frozen], settings: noWalks }))
    expect(r.blocks.filter((b) => b.itemId === f.id)).toEqual([frozen])
  })

  test('frozen deep item is not placed again and frozen time is blocked', () => {
    const d = deep(120)
    const frozen: Block = {
      itemId: d.id,
      kind: 'deep',
      start: 540,
      end: 600,
      chunk: { index: 0, of: 2 },
      reason: 'x'
    }
    const other = deep(60)
    const r = planDay(input([d, other], { frozen: [frozen], settings: noWalks }))
    expect(r.blocks.filter((b) => b.itemId === d.id)).toEqual([frozen])
    expect(r.blocks.find((b) => b.itemId === other.id)?.start).toBe(605)
  })

  test('answered tomorrow / unscheduled / drop are never placed and get no decision', () => {
    const a = deep(120)
    const b = deep(120)
    const c = deep(120)
    const answers: DecisionAnswer[] = [
      { itemId: a.id, choice: 'tomorrow' },
      { itemId: b.id, choice: 'unscheduled' },
      { itemId: c.id, choice: 'drop' }
    ]
    const r = planDay(input([fixed(540, 480), a, b, c], { answers }))
    expect(r.decisions).toEqual([])
    expect(deepBlocks(r.blocks)).toEqual([])
    expect(r.unscheduled).toEqual([b.id])
  })

  test('blocks are sorted by start', () => {
    const r = planDay(input([fixed(1110, 45), deep(120), fixed(570, 15)]))
    const starts = r.blocks.map((b) => b.start)
    expect(starts).toEqual([...starts].sort((x, y) => x - y))
  })

  test('deterministic', () => {
    const x = input([fixed(570, 15), deep(120, { half: 'pm' }), deep(90), fixed(1110, 45)])
    expect(planDay(x)).toEqual(planDay(structuredClone(x)))
  })
})
