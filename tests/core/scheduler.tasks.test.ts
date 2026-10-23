import { describe, expect, test } from 'vitest'
import { planDay, type PlanInput } from '../../src/core/scheduler'
import { DEFAULT_SETTINGS, type Block, type Item, type Settings } from '../../src/core/types'

const D = '2026-10-23'

let n = 0
const item = (o: Partial<Item> = {}): Item => {
  n += 1
  return {
    id: `t${String(n).padStart(3, '0')}`,
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
    createdAt: n,
    ...o
  }
}
const fixed = (start: number, durationMin: number): Item =>
  item({ type: 'fixed', fixedStart: start, durationMin })
const task = (durationMin = 30, o: Partial<Item> = {}): Item => item({ durationMin, ...o })
const by = (time: number): Item['deadline'] => ({ date: D, time })

const noWalks: Settings = {
  ...DEFAULT_SETTINGS,
  walk: { ...DEFAULT_SETTINGS.walk, enabled: false }
}

const input = (items: Item[], o: Partial<PlanInput> = {}): PlanInput => ({
  date: D,
  now: 0,
  items,
  settings: noWalks,
  frozen: [],
  answers: [],
  ...o
})

const blockOf = (bs: Block[], id: string): Block | undefined => bs.find((b) => b.itemId === id)
const overlaps = (b: Block, start: number, end: number): boolean => b.start < end && b.end > start

describe('planDay part 2: tasks', () => {
  test('fills 30m gap before deep with call-sized tasks', () => {
    const d = item({ type: 'deep', durationMin: 120, half: 'am' })
    const r1 = task(20, { label: 'review' })
    const r2 = task(10, { label: 'review' })
    const r = planDay(input([fixed(540, 15), d, fixed(705, 45), r1, r2]))
    expect(blockOf(r.blocks, d.id)).toMatchObject({ start: 560, end: 680 })
    expect(blockOf(r.blocks, r1.id)).toEqual({
      itemId: r1.id,
      kind: 'task',
      start: 755,
      end: 775,
      chunk: null,
      reason: 'Batched with #review'
    })
    expect(blockOf(r.blocks, r2.id)).toEqual({
      itemId: r2.id,
      kind: 'task',
      start: 780,
      end: 790,
      chunk: null,
      reason: 'Batched with #review'
    })
    expect(r.decisions).toEqual([])
  })

  test('unlabelled items batch by type', () => {
    const a = item({ type: 'household', durationMin: 15 })
    const b = item({ type: 'household', durationMin: 15 })
    const r = planDay(input([a, b]))
    expect([blockOf(r.blocks, a.id), blockOf(r.blocks, b.id)]).toMatchObject([
      { start: 540, end: 555, reason: 'Batched with other households' },
      { start: 560, end: 575, reason: 'Batched with other households' }
    ])
  })

  test('deadline first and must end by deadline', () => {
    const high = task(30, { priority: 'high', label: 'x' })
    const low = task(30, { priority: 'low', label: 'y', deadline: by(600) })
    const r = planDay(input([fixed(540, 20), high, low]))
    const l = blockOf(r.blocks, low.id) as Block
    const h = blockOf(r.blocks, high.id) as Block
    expect(l.end).toBeLessThanOrEqual(600)
    expect(l.start).toBeLessThan(h.start)
    expect(r.decisions).toEqual([])
  })

  test('deadline unreachable gives no-fit', () => {
    const t = task(30, { deadline: by(550) })
    const r = planDay(input([t]))
    expect(r.decisions).toEqual([{ kind: 'no-fit', itemId: t.id }])
    expect(blockOf(r.blocks, t.id)).toBeUndefined()
  })

  test('batched group still meets every deadline, else members go alone', () => {
    // free 09:00-10:00 and 10:30 onwards; a 30+5+30 group cannot end by 10:00
    const a = task(30, { label: 'r', deadline: by(600) })
    const b = task(30, { label: 'r' })
    const r = planDay(input([fixed(605, 20), a, b]))
    expect(blockOf(r.blocks, a.id)).toMatchObject({ start: 540, end: 570 })
    expect(blockOf(r.blocks, a.id)?.reason).not.toMatch(/Batched/)
    expect(blockOf(r.blocks, b.id)).toMatchObject({ start: 630, end: 660 })
  })

  test('batch never bumps a higher-priority item in a later group', () => {
    // exactly 65 min free: 10:05-11:10
    const high = task(30, { priority: 'high', label: 'a' })
    const med = task(30, { priority: 'med', label: 'b' })
    const low = task(30, { priority: 'low', label: 'a' })
    const r = planDay(input([fixed(540, 60), fixed(675, 405), high, med, low]))
    expect(blockOf(r.blocks, high.id)).toMatchObject({ start: 605, end: 635 })
    expect(blockOf(r.blocks, med.id)).toMatchObject({ start: 640, end: 670 })
    expect(r.decisions).toEqual([{ kind: 'no-fit', itemId: low.id }])
  })

  test('batch never costs a later deadline item its slot', () => {
    const a1 = task(25, { label: 'a', deadline: by(565) })
    const a2 = task(60, { label: 'a' })
    const b1 = task(30, { label: 'b', deadline: by(600) })
    const r = planDay(input([a1, a2, b1]))
    expect(r.decisions).toEqual([])
    expect(blockOf(r.blocks, a1.id)).toMatchObject({ start: 540, end: 565 })
    expect(blockOf(r.blocks, b1.id)).toMatchObject({ start: 570, end: 600 })
    expect(blockOf(r.blocks, a2.id)?.reason).not.toMatch(/Batched/)
  })

  test('batch uses the half its members prefer', () => {
    const a = task(20, { label: 'r' })
    const pm = task(10, { label: 'r', half: 'pm' })
    const r = planDay(input([a, pm]))
    expect(r.decisions).toEqual([])
    expect(blockOf(r.blocks, pm.id)?.start).toBeGreaterThanOrEqual(810)
    expect(blockOf(r.blocks, a.id)?.reason).toBe('Batched with #r')
  })

  test('conflicting halves are not batched', () => {
    const am = task(20, { label: 'r', half: 'am' })
    const pm = task(10, { label: 'r', half: 'pm' })
    const r = planDay(input([am, pm]))
    expect(blockOf(r.blocks, am.id)).toMatchObject({
      start: 540,
      reason: 'Earliest free slot in first half'
    })
    expect(blockOf(r.blocks, pm.id)).toMatchObject({
      start: 810,
      reason: 'Earliest free slot in second half'
    })
  })

  test('deadline item: other half asks if it meets the deadline, else no-fit', () => {
    // first half full; boundary 13:30
    const ok = task(30, { half: 'am', label: 'x', deadline: by(960) })
    const late = task(30, { half: 'am', label: 'y', deadline: by(720) })
    const items = [fixed(540, 270), ok, late]
    const r = planDay(input(items))
    expect(r.decisions).toEqual([
      { kind: 'no-fit', itemId: late.id },
      { kind: 'half-overflow', itemId: ok.id, preferred: 'am' }
    ])
    const r2 = planDay(input(items, { answers: [{ itemId: ok.id, choice: 'use-other-half' }] }))
    expect(blockOf(r2.blocks, ok.id)).toMatchObject({ start: 815, end: 845 })
  })

  test('priority order on overflow', () => {
    // exactly 65 min free: 10:05-11:10
    const low = task(30, { priority: 'low' })
    const med = task(30, { priority: 'med' })
    const high = task(30, { priority: 'high' })
    const r = planDay(input([fixed(540, 60), fixed(675, 405), low, med, high]))
    expect(blockOf(r.blocks, high.id)).toMatchObject({ start: 605, end: 635 })
    expect(blockOf(r.blocks, med.id)).toMatchObject({ start: 640, end: 670 })
    expect(blockOf(r.blocks, low.id)).toBeUndefined()
    expect(r.decisions).toEqual([{ kind: 'no-fit', itemId: low.id }])
  })

  test('task half preference: overflow asks, use-other-half places', () => {
    const t = task(30, { half: 'am' })
    const items = [fixed(540, 270), t]
    const r = planDay(input(items))
    expect(r.decisions).toEqual([{ kind: 'half-overflow', itemId: t.id, preferred: 'am' }])
    expect(blockOf(r.blocks, t.id)).toBeUndefined()
    const r2 = planDay(input(items, { answers: [{ itemId: t.id, choice: 'use-other-half' }] }))
    expect(r2.decisions).toEqual([])
    expect(blockOf(r2.blocks, t.id)).toMatchObject({
      start: 815,
      reason: 'Earliest free slot in second half'
    })
  })

  test('soft hold kept when possible, dropped when needed', () => {
    const call = item({ type: 'call', durationMin: 15, suggestedSlots: [600] })
    const t = task(30)
    const kept = planDay(input([call, t], { now: 600 }))
    expect(kept.blocks.filter((b) => overlaps(b, 600, 615))).toEqual([])
    expect(blockOf(kept.blocks, t.id)?.start).toBe(620)

    // only free gap is 10:00-10:30
    const call2 = item({ type: 'call', durationMin: 15, suggestedSlots: [600] })
    const t2 = task(30)
    const dropped = planDay(input([fixed(540, 55), fixed(635, 445), call2, t2]))
    expect(blockOf(dropped.blocks, t2.id)).toMatchObject({ start: 600, end: 630 })
  })

  test('unconfirmed calls never placed', () => {
    const call = item({ type: 'call', durationMin: 15, suggestedSlots: [600, 840] })
    const bare = item({ type: 'call', durationMin: 15 })
    const r = planDay(input([call, bare, task(30)], { settings: DEFAULT_SETTINGS }))
    expect(r.blocks.filter((b) => b.itemId === call.id || b.itemId === bare.id)).toEqual([])
    expect(r.decisions).toEqual([])
  })

  test('replan after work end yields no-fit decisions, no blocks in the past', () => {
    const t = task(30)
    const h = item({ type: 'household', durationMin: 15, half: 'pm' })
    const d = item({ type: 'deep', durationMin: 120 })
    const r = planDay(input([fixed(600, 30), t, h, d], { now: 1100, settings: DEFAULT_SETTINGS }))
    expect(r.decisions).toEqual(
      expect.arrayContaining([
        { kind: 'no-fit', itemId: t.id },
        { kind: 'no-fit', itemId: h.id },
        { kind: 'no-fit', itemId: d.id }
      ])
    )
    expect(r.decisions).toHaveLength(3)
    expect(r.blocks.filter((b) => b.kind !== 'fixed' && b.start < 1100)).toEqual([])
  })

  test('frozen blocks are untouched', () => {
    const a = task(30)
    const b = task(30)
    const frozen: Block = {
      itemId: a.id,
      kind: 'task',
      start: 600,
      end: 630,
      chunk: null,
      reason: 'Done'
    }
    const r = planDay(input([fixed(540, 55), a, b], { now: 600, frozen: [frozen] }))
    expect(r.blocks.filter((x) => x.itemId === a.id)).toEqual([frozen])
    expect(r.blocks.filter((x) => x.itemId !== a.id && overlaps(x, 600, 630))).toEqual([])
    expect(blockOf(r.blocks, b.id)?.start).toBe(635)
  })

  test('locked, done and answered tasks are not placed again', () => {
    const locked = task(30, { lockedStart: 900 })
    const done = task(30, { status: 'done' })
    const skipped = task(30)
    const r = planDay(
      input([locked, done, skipped], { answers: [{ itemId: skipped.id, choice: 'tomorrow' }] })
    )
    expect(r.blocks).toEqual([
      { itemId: locked.id, kind: 'task', start: 900, end: 930, chunk: null, reason: 'Locked' }
    ])
    expect(r.decisions).toEqual([])
  })

  test('deterministic', () => {
    const x = input(
      [
        fixed(570, 15),
        task(20, { label: 'r' }),
        task(10, { label: 'r', half: 'pm' }),
        task(30, { deadline: by(720), priority: 'low' }),
        item({ type: 'call', durationMin: 15, suggestedSlots: [600] }),
        item({ type: 'deep', durationMin: 90 })
      ],
      { settings: DEFAULT_SETTINGS }
    )
    expect(planDay(x)).toEqual(planDay(structuredClone(x)))
  })
})
