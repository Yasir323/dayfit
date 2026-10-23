import { describe, it, expect } from 'vitest'
import {
  dueReminders,
  isBusy,
  EMPTY_REMINDER_STATE,
  type ReminderState
} from '../../src/core/reminders'
import { DEFAULT_SETTINGS } from '../../src/core/types'
import type { Block, BlockKind, Item, Settings } from '../../src/core/types'

const block = (
  kind: BlockKind,
  start: number,
  end: number,
  itemId: string | null = 'i1'
): Block => ({
  itemId,
  kind,
  start,
  end,
  chunk: null,
  reason: ''
})
const item = (id: string, title: string): Item =>
  ({ id, title, type: 'fixed', durationMin: 30 }) as Item

const run = (
  now: number,
  over: Partial<{
    elapsedMin: number
    idleSec: number
    blocks: Block[]
    settings: Settings
    waterMlToday: number
    manualBusy: boolean | null
    state: ReminderState
  }> = {}
): ReturnType<typeof dueReminders> =>
  dueReminders({
    now,
    elapsedMin: 0,
    idleSec: 0,
    blocks: [],
    items: [item('i1', 'Standup')],
    settings: DEFAULT_SETTINGS,
    waterMlToday: 0,
    manualBusy: null,
    state: EMPTY_REMINDER_STATE,
    ...over
  })

const kinds = (r: ReturnType<typeof run>): string[] => r.events.map((e) => e.kind)
// start water/stretch timers at `now` so only the rule under test can fire
const quiet = (now: number): ReminderState => ({
  ...EMPTY_REMINDER_STATE,
  lastWaterAt: now,
  lastStretchAt: now,
  lastEyeAt: now
})

describe('isBusy', () => {
  it('is true inside fixed/deep blocks, manual overrides', () => {
    const blocks = [block('deep', 600, 700)]
    expect(isBusy(blocks, 650, null)).toBe(true)
    expect(isBusy(blocks, 700, null)).toBe(false)
    expect(isBusy(blocks, 650, false)).toBe(false)
    expect(isBusy([], 650, true)).toBe(true)
  })
})

describe('meeting alerts', () => {
  const blocks = [block('fixed', 600, 630)]
  it('meeting-soon fires exactly once across ticks', () => {
    const a = run(595, { blocks, state: quiet(595) })
    expect(a.events).toHaveLength(1)
    expect(a.events[0]).toMatchObject({
      kind: 'meeting-soon',
      itemId: 'i1',
      title: 'Standup in 5 min',
      silent: false
    })
    expect(a.state.fired).toContain('meeting-soon:i1:600')
    const b = run(596, { blocks, state: a.state })
    expect(kinds(b)).toEqual([])
  })
  it('meeting-now fires even with manual busy, once', () => {
    const a = run(600, { blocks, manualBusy: true, state: quiet(600) })
    expect(a.events).toHaveLength(1)
    expect(a.events[0]).toMatchObject({
      kind: 'meeting-now',
      title: 'Standup is starting',
      silent: false
    })
    expect(kinds(run(601, { blocks, manualBusy: true, state: a.state }))).toEqual([])
  })
  it('falls back to "Meeting" and does not mutate input state', () => {
    const state = quiet(595)
    const r = run(595, { blocks: [block('fixed', 600, 630, 'zz')], state })
    expect(r.events[0].title).toBe('Meeting in 5 min')
    expect(state.fired).toEqual([])
  })
})

describe('eye rest', () => {
  it('20 one-minute ticks give one eye event', () => {
    let state = EMPTY_REMINDER_STATE
    let count = 0
    for (let m = 1; m <= 20; m++) {
      const r = run(600 + m, {
        elapsedMin: 1,
        state: { ...state, lastWaterAt: 600 + m, lastStretchAt: 600 + m }
      })
      count += r.events.filter((e) => e.kind === 'eye').length
      state = r.state
    }
    expect(count).toBe(1)
    expect(state.activeMin).toBe(0)
    expect(state.lastEyeAt).toBe(620)
  })
  it('emits the exact body text', () => {
    const r = run(620, { elapsedMin: 20, state: quiet(620) })
    expect(r.events[0]).toMatchObject({
      kind: 'eye',
      title: 'Rest your eyes',
      body: 'Look at something 20 feet away for 20 seconds.'
    })
  })
  it('long idle resets the count so no event at minute 20', () => {
    let state = EMPTY_REMINDER_STATE
    let count = 0
    for (let m = 1; m <= 20; m++) {
      const r = run(600 + m, {
        elapsedMin: 1,
        idleSec: m === 10 ? 400 : 0,
        state: { ...state, lastWaterAt: 600 + m, lastStretchAt: 600 + m }
      })
      count += r.events.filter((e) => e.kind === 'eye').length
      state = r.state
    }
    expect(count).toBe(0)
  })
})

describe('water', () => {
  it('emits at 10:10 with 0 ml', () => {
    const r = run(610, { state: { ...EMPTY_REMINDER_STATE, lastStretchAt: 610, lastEyeAt: 610 } })
    expect(kinds(r)).toEqual(['water'])
    expect(r.events[0].body).toContain('0 / 2000 ml')
    expect(r.state.lastWaterAt).toBe(610)
  })
  it('no event with 500 ml', () => {
    const r = run(610, {
      waterMlToday: 500,
      state: { ...EMPTY_REMINDER_STATE, lastStretchAt: 610, lastEyeAt: 610 }
    })
    expect(kinds(r)).toEqual([])
  })
  it('does not run outside working hours', () => {
    const r = run(480, { state: { ...EMPTY_REMINDER_STATE, lastStretchAt: 480 } })
    expect(kinds(r)).toEqual([])
  })
})

describe('stretch', () => {
  const blocks = [block('deep', 540, 630)]
  it('waits during deep block, fires first tick after', () => {
    const state: ReminderState = { ...EMPTY_REMINDER_STATE, lastWaterAt: 600, lastEyeAt: 600 }
    const during = run(600, { blocks, state })
    expect(kinds(during)).not.toContain('stretch')
    const after = run(631, { blocks, state: { ...during.state, lastWaterAt: 631, lastEyeAt: 631 } })
    expect(kinds(after)).toEqual(['stretch'])
    expect(after.state.lastStretchAt).toBe(631)
  })
})

describe('busy mode', () => {
  const blocks = [block('deep', 540, 700)]
  it('eye is silent when allowGentle', () => {
    const r = run(620, { blocks, elapsedMin: 20, state: quiet(620) })
    expect(r.events).toHaveLength(1)
    expect(r.events[0]).toMatchObject({ kind: 'eye', silent: true })
  })
  it('no eye event when allowGentle is false', () => {
    const settings = { ...DEFAULT_SETTINGS, busy: { allowGentle: false } }
    const r = run(620, { blocks, settings, elapsedMin: 20, state: quiet(620) })
    expect(kinds(r)).toEqual([])
  })
})

describe('walk', () => {
  const blocks = [block('walk', 660, 670, null)]
  it('fires at the start of a walk block, once', () => {
    const a = run(660, { blocks, state: quiet(660) })
    expect(a.events).toHaveLength(1)
    expect(a.events[0]).toMatchObject({ kind: 'walk', itemId: null, title: 'Time for a walk' })
    expect(a.state.fired).toContain('walk:660')
    expect(
      kinds(
        run(661, {
          blocks,
          state: { ...a.state, ...{ lastWaterAt: 661, lastStretchAt: 661, lastEyeAt: 661 } }
        })
      )
    ).toEqual([])
  })
})
