import { describe, expect, it } from 'vitest'
import {
  EMPTY_BREAK_STATE,
  composeBreak,
  isHeld,
  snoozeBreak,
  stepBreaks,
  type BreakFire,
  type BreakState
} from '../../src/core/breaks'
import { DEFAULT_SETTINGS } from '../../src/core/types'
import type { Block, BlockKind, Item, Settings } from '../../src/core/types'

const S = DEFAULT_SETTINGS

const blk = (kind: BlockKind, start: number, end: number, itemId: string | null = 'a'): Block => ({
  itemId,
  kind,
  start,
  end,
  chunk: null,
  reason: ''
})

const mk = (id: string, over: Partial<Item> = {}): Item => ({
  id,
  title: id,
  type: 'task',
  durationMin: 30,
  label: null,
  priority: 'med',
  half: null,
  date: '2026-10-23',
  fixedStart: null,
  deadline: null,
  repeat: { kind: 'none' },
  status: 'open',
  lockedStart: null,
  suggestedSlots: [],
  dnd: false,
  createdAt: 1,
  ...over
})

interface Opts {
  blocks?: Block[]
  items?: Item[]
  settings?: Settings
  manualBusy?: boolean | null
  idleSec?: number
  waterMlToday?: number
}

const step = (
  state: BreakState,
  now: number,
  o: Opts = {}
): { fire: BreakFire | null; state: BreakState } =>
  stepBreaks({
    now,
    elapsedMin: 1,
    idleSec: o.idleSec ?? 0,
    blocks: o.blocks ?? [],
    items: o.items ?? [],
    settings: o.settings ?? S,
    waterMlToday: o.waterMlToday ?? 0,
    manualBusy: o.manualBusy ?? null,
    state
  })

/** One-minute ticks at from, from+1, … (n ticks); returns each fire with its time and the final state. */
function tickN(
  state: BreakState,
  from: number,
  n: number,
  o: Opts = {}
): { fires: { now: number; fire: BreakFire }[]; state: BreakState } {
  const fires: { now: number; fire: BreakFire }[] = []
  let s = state
  for (let k = 0; k < n; k++) {
    const r = step(s, from + k, o)
    if (r.fire) fires.push({ now: from + k, fire: r.fire })
    s = r.state
  }
  return { fires, state: s }
}

const withWork = (w: Partial<BreakState['workMin']>): BreakState => ({
  ...EMPTY_BREAK_STATE,
  workMin: { ...EMPTY_BREAK_STATE.workMin, ...w }
})

describe('stepBreaks cadence', () => {
  it('eye alone fires after 20 active minutes', () => {
    const { fires } = tickN(EMPTY_BREAK_STATE, 540, 20)
    expect(fires).toHaveLength(1)
    expect(fires[0].now).toBe(559)
    expect(fires[0].fire).toEqual({
      parts: ['eye'],
      title: 'Rest your eyes',
      body: 'Look at something 20 feet away for 20 seconds.'
    })
  })

  it('hour mark bundles eye, water, stretch', () => {
    const { fires } = tickN(EMPTY_BREAK_STATE, 540, 60)
    expect(fires.map((f) => f.now)).toEqual([559, 579, 599])
    expect(fires[2].fire).toEqual({
      parts: ['eye', 'water', 'stretch'],
      title: 'Break time',
      body: 'Look 20 ft away · Drink water (0 / 2000 ml) · Stretch'
    })
  })

  it('two-hour mark adds walk', () => {
    const { fires } = tickN(EMPTY_BREAK_STATE, 540, 120)
    expect(fires).toHaveLength(6)
    expect(fires[5].fire.parts).toEqual(['eye', 'water', 'stretch', 'walk'])
    expect(fires[5].fire.body.endsWith('Walk 10 min')).toBe(true)
  })

  it('slack pulls a nearly-due part into this check', () => {
    expect(tickN(withWork({ water: 45 }), 540, 20).fires[0].fire.parts).toEqual(['eye', 'water'])
    expect(tickN(withWork({ water: 25 }), 540, 20).fires[0].fire.parts).toEqual(['eye'])
  })

  it('idle resets eye only', () => {
    const a = tickN(EMPTY_BREAK_STATE, 540, 15)
    const b = step(a.state, 555, { idleSec: 300 })
    expect(b.state.eyeActiveMin).toBe(0)
    expect(b.state.workMin.water).toBe(16)
  })

  it('nothing outside working hours', () => {
    const before = tickN(EMPTY_BREAK_STATE, 420, 120)
    expect(before.fires).toEqual([])
    expect(before.state).toEqual(EMPTY_BREAK_STATE)
    const pending: BreakState = { ...EMPTY_BREAK_STATE, pending: ['eye'] }
    const after = step(pending, 1080)
    expect(after.fire).toBeNull()
    expect(after.state).toEqual(pending)
  })

  it('eye disabled uses a 20 working-minute fallback check', () => {
    const settings = { ...S, eye: { ...S.eye, enabled: false } }
    const { fires } = tickN(EMPTY_BREAK_STATE, 540, 120, { settings })
    expect(fires[0]).toMatchObject({ now: 599, fire: { parts: ['water', 'stretch'] } })
    expect(fires.some((f) => f.fire.parts.includes('eye'))).toBe(false)
  })

  it('lowered interval fires at the next check', () => {
    const settings = { ...S, stretch: { ...S.stretch, intervalMin: 30 } }
    const { fires } = tickN(withWork({ stretch: 50 }), 540, 20, { settings })
    expect(fires[0].fire.parts).toEqual(['eye', 'stretch'])
  })

  it('disabled part never included', () => {
    const settings = { ...S, walk: { ...S.walk, enabled: false } }
    const { fires } = tickN(EMPTY_BREAK_STATE, 540, 120, { settings })
    expect(fires.some((f) => f.fire.parts.includes('walk'))).toBe(false)
  })
})

describe('holding', () => {
  it('held by DND item, fires once when it ends', () => {
    const o = { blocks: [blk('task', 545, 640)], items: [mk('a', { dnd: true })] }
    const { fires } = tickN(EMPTY_BREAK_STATE, 540, 121, o)
    expect(fires[0].now).toBe(640)
    expect(fires[0].fire.parts).toEqual(['eye', 'water', 'stretch'])
    expect(fires.filter((f) => f.now === 640)).toHaveLength(1)
  })

  it('held by high priority, not by med/low', () => {
    const blocks = [blk('task', 545, 640)]
    const high = tickN(EMPTY_BREAK_STATE, 540, 20, {
      blocks,
      items: [mk('a', { priority: 'high' })]
    })
    expect(high.fires).toEqual([])
    for (const priority of ['med', 'low'] as const) {
      const r = tickN(EMPTY_BREAK_STATE, 540, 20, { blocks, items: [mk('a', { priority })] })
      expect(r.fires.map((f) => f.now)).toEqual([559])
    }
  })

  it('done item stops holding', () => {
    const o = { blocks: [blk('task', 545, 640)], items: [mk('a', { dnd: true, status: 'done' })] }
    expect(tickN(EMPTY_BREAK_STATE, 540, 20, o).fires.map((f) => f.now)).toEqual([559])
  })

  it('chunk gap ≤ buffer still holds; longer gap releases', () => {
    const items = [mk('a', { type: 'deep', dnd: true })]
    const near = tickN(EMPTY_BREAK_STATE, 540, 121, {
      items,
      blocks: [blk('deep', 545, 600), blk('deep', 605, 660)]
    })
    expect(near.fires[0].now).toBe(660)
    const far = tickN(EMPTY_BREAK_STATE, 540, 120, {
      items,
      blocks: [blk('deep', 545, 600), blk('deep', 620, 660)]
    })
    expect(far.fires[0].now).toBe(600)
  })

  it('manual busy overrides both ways', () => {
    expect(tickN(EMPTY_BREAK_STATE, 540, 20, { manualBusy: true }).fires).toEqual([])
    const o = {
      blocks: [blk('task', 545, 640)],
      items: [mk('a', { dnd: true })],
      manualBusy: false
    }
    expect(tickN(EMPTY_BREAK_STATE, 540, 20, o).fires.map((f) => f.now)).toEqual([559])
  })

  it('isHeld ignores blocks of other times', () => {
    const items = [mk('a', { dnd: true })]
    expect(isHeld([blk('task', 600, 630)], items, 599, null, 5)).toBe(false)
    expect(isHeld([blk('task', 600, 630)], items, 600, null, 5)).toBe(true)
    expect(isHeld([blk('task', 600, 630)], items, 630, null, 5)).toBe(false)
  })
})

describe('snooze', () => {
  it('snooze re-fires after x minutes, merged', () => {
    const a = tickN(EMPTY_BREAK_STATE, 540, 20)
    const snoozed = snoozeBreak(a.state, 559, 10)
    const b = tickN(snoozed, 560, 10)
    expect(b.fires.map((f) => [f.now, f.fire.parts])).toEqual([[569, ['eye']]])

    const c = tickN(withWork({ water: 15 }), 540, 20)
    expect(c.fires[0].fire.parts).toEqual(['eye'])
    const d = tickN(snoozeBreak(c.state, 559, 30), 560, 30)
    expect(d.fires.map((f) => [f.now, f.fire.parts])).toEqual([[589, ['eye', 'water']]])
  })

  it('snooze clamps to 1–60', () => {
    const s = { ...EMPTY_BREAK_STATE, lastFired: ['eye' as const] }
    expect(snoozeBreak(s, 600, 0).snoozeUntil).toBe(601)
    expect(snoozeBreak(s, 600, 500).snoozeUntil).toBe(660)
  })

  it('snooze with nothing fired changes nothing', () => {
    expect(snoozeBreak(EMPTY_BREAK_STATE, 600, 10)).toEqual(EMPTY_BREAK_STATE)
  })

  it('snooze ending inside a hold waits for the hold', () => {
    const a = tickN(EMPTY_BREAK_STATE, 540, 20)
    const o = { blocks: [blk('task', 565, 600)], items: [mk('a', { dnd: true })] }
    const b = tickN(snoozeBreak(a.state, 559, 10), 560, 45, o)
    expect(b.fires.map((f) => f.now)).toEqual([600])
  })
})

describe('composeBreak', () => {
  it('water line shows logged ml', () => {
    expect(composeBreak(['eye', 'water'], S, 750).body).toBe(
      'Look 20 ft away · Drink water (750 / 2000 ml)'
    )
  })
})
