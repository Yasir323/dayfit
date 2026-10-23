import { describe, expect, it } from 'vitest'
import {
  EMPTY_END_OF_DAY_STATE,
  attendanceDue,
  markPunched,
  startCheckout,
  stepEndOfDay,
  type EndOfDayEvent,
  type EndOfDayState
} from '../../src/core/endOfDay'
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

const dndItem: Item = {
  id: 'a',
  title: 'Focus',
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
  dnd: true,
  createdAt: 1
}

interface Opts {
  idleSec?: number
  blocks?: Block[]
  items?: Item[]
  settings?: Settings
}

const step = (
  state: EndOfDayState,
  now: number,
  o: Opts = {}
): { events: EndOfDayEvent[]; state: EndOfDayState } =>
  stepEndOfDay({
    now,
    idleSec: o.idleSec ?? 0,
    blocks: o.blocks ?? [],
    items: o.items ?? [],
    settings: o.settings ?? S,
    manualBusy: null,
    state
  })

/** One tick a minute from `from` to `to` inclusive; returns [now, kind] for each event. */
function run(
  state: EndOfDayState,
  from: number,
  to: number,
  o: Opts = {}
): { fired: [number, string][]; state: EndOfDayState } {
  const fired: [number, string][] = []
  let s = state
  for (let now = from; now <= to; now++) {
    const r = step(s, now, o)
    for (const e of r.events) fired.push([now, e.kind])
    s = r.state
  }
  return { fired, state: s }
}

const of = (fired: [number, string][], kind: string): number[] =>
  fired.filter(([, k]) => k === kind).map(([n]) => n)

describe('attendance', () => {
  it('check-in fires at workStart and repeats every 10 min until punched', () => {
    const a = run(EMPTY_END_OF_DAY_STATE, 540, 565)
    expect(of(a.fired, 'attendance-in')).toEqual([540, 550, 560])
    const b = run(markPunched(a.state, 'in'), 566, 600)
    expect(of(b.fired, 'attendance-in')).toEqual([])
  })

  it('check-in waits for activity', () => {
    const a = run(EMPTY_END_OF_DAY_STATE, 540, 545, { idleSec: 600 })
    expect(a.fired).toEqual([])
    expect(
      of(
        step(a.state, 546).events.map((e) => [546, e.kind]),
        'attendance-in'
      )
    ).toEqual([546])
  })

  it('check-in never before workStart and not after workEnd', () => {
    expect(step(EMPTY_END_OF_DAY_STATE, 530).events).toEqual([])
    const kinds = step(EMPTY_END_OF_DAY_STATE, 1080).events.map((e) => e.kind)
    expect(kinds).not.toContain('attendance-in')
  })

  it('check-out starts at workEnd without the screen', () => {
    const s = { ...EMPTY_END_OF_DAY_STATE, inDone: true, headsUpFired: true }
    const a = run(s, 1080, 1100)
    expect(of(a.fired, 'attendance-out')).toEqual([1080, 1090, 1100])
    expect(of(run(markPunched(a.state, 'out'), 1101, 1130).fired, 'attendance-out')).toEqual([])
  })

  it('startCheckout starts check-out early', () => {
    const s = startCheckout({ ...EMPTY_END_OF_DAY_STATE, inDone: true })
    expect(step(s, 1050).events.map((e) => e.kind)).toEqual(['attendance-out'])
  })

  it('opened after hours with check-in unpunched', () => {
    const settings = { ...S, endOfDay: { ...S.endOfDay, overtime: false } }
    const kinds = step(EMPTY_END_OF_DAY_STATE, 1150, { settings }).events.map((e) => e.kind)
    expect(kinds).toEqual(['attendance-out'])
  })

  it('attendance off means none', () => {
    const settings = { ...S, endOfDay: { ...S.endOfDay, attendance: false } }
    const a = run(EMPTY_END_OF_DAY_STATE, 530, 1120, { settings })
    expect(a.fired.filter(([, k]) => k.startsWith('attendance'))).toEqual([])
    expect(attendanceDue(EMPTY_END_OF_DAY_STATE, 600, settings)).toEqual({ in: false, out: false })
  })

  it('attendanceDue reflects what is owed', () => {
    expect(attendanceDue(EMPTY_END_OF_DAY_STATE, 600, S)).toEqual({ in: true, out: false })
    expect(attendanceDue(EMPTY_END_OF_DAY_STATE, 1080, S)).toEqual({ in: false, out: true })
    const done = { ...EMPTY_END_OF_DAY_STATE, inDone: true, outDone: true }
    expect(attendanceDue(done, 1080, S)).toEqual({ in: false, out: false })
  })
})

describe('heads-up, overtime, lunch', () => {
  const punched = { ...EMPTY_END_OF_DAY_STATE, inDone: true, outDone: true }

  it('heads-up once at workEnd-15, held by DND, skipped if checked out', () => {
    expect(of(run(punched, 1060, 1079).fired, 'heads-up')).toEqual([1065])
    const held = { blocks: [blk('task', 1060, 1075)], items: [dndItem] }
    expect(of(run(punched, 1060, 1079, held).fired, 'heads-up')).toEqual([1075])
    expect(run({ ...punched, checkedOut: true }, 1060, 1079).fired).toEqual([])
  })

  it('overtime once when active after workEnd+15', () => {
    expect(of(run(punched, 1094, 1200).fired, 'overtime')).toEqual([1095])
    expect(run(punched, 1094, 1200, { idleSec: 900 }).fired).toEqual([])
  })

  it('lunch reminder once inside the lunch block, held by DND', () => {
    const lunch = blk('lunch', 780, 825, null)
    expect(of(run(punched, 770, 830, { blocks: [lunch] }).fired, 'lunch')).toEqual([780])
    const held = { blocks: [lunch, blk('task', 770, 800)], items: [dndItem] }
    expect(of(run(punched, 770, 830, held).fired, 'lunch')).toEqual([800])
    expect(run(punched, 780, 825, { blocks: [lunch], idleSec: 900 }).fired).toEqual([])
  })

  it('copy is exact', () => {
    const lunch = blk('lunch', 780, 825, null)
    const all = [
      ...step(EMPTY_END_OF_DAY_STATE, 540).events,
      ...step(punched, 780, { blocks: [lunch] }).events,
      ...step(punched, 1065).events,
      ...step({ ...EMPTY_END_OF_DAY_STATE, inDone: true }, 1095).events
    ]
    expect(all.map((e) => [e.kind, e.title, e.body])).toEqual([
      ['attendance-in', 'Punch in', 'Mark your attendance for today.'],
      ['lunch', 'Lunch time', 'Step away from the desk.'],
      ['heads-up', 'Wrapping up in 15 min', "Review what's left for today."],
      ['attendance-out', 'Punch out', 'Mark your attendance before you leave.'],
      ['overtime', "You're past your hours", 'Time to stop for today.']
    ])
  })
})
