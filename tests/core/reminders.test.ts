import { describe, it, expect } from 'vitest'
import {
  dueReminders,
  isBusy,
  EMPTY_REMINDER_STATE,
  type ReminderEvent,
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
// a fresh state; with elapsedMin 0 no break can fall due
const quiet = (): ReminderState => structuredClone(EMPTY_REMINDER_STATE)

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
    const a = run(595, { blocks, state: quiet() })
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
    const a = run(600, { blocks, manualBusy: true, state: quiet() })
    expect(a.events).toHaveLength(1)
    expect(a.events[0]).toMatchObject({
      kind: 'meeting-now',
      title: 'Standup is starting',
      silent: false
    })
    expect(kinds(run(601, { blocks, manualBusy: true, state: a.state }))).toEqual([])
  })
  it('falls back to "Meeting" and does not mutate input state', () => {
    const state = quiet()
    const r = run(595, { blocks: [block('fixed', 600, 630, 'zz')], state })
    expect(r.events[0].title).toBe('Meeting in 5 min')
    expect(state.fired).toEqual([])
  })
})

describe('breaks via dueReminders', () => {
  it('emits one break event with parts', () => {
    let state = quiet()
    const events: ReminderEvent[] = []
    for (let now = 540; now < 560; now++) {
      const r = run(now, { elapsedMin: 1, state })
      events.push(...r.events)
      state = r.state
    }
    expect(events).toHaveLength(1)
    expect(events[0]).toMatchObject({ kind: 'break', parts: ['eye'], silent: false, itemId: null })
  })

  it('meeting alerts still ignore holds', () => {
    const dnd = { ...item('d', 'Focus'), dnd: true, status: 'open' } as Item
    const r = dueReminders({
      now: 595,
      elapsedMin: 0,
      idleSec: 0,
      blocks: [block('task', 540, 700, 'd'), block('fixed', 600, 630)],
      items: [dnd, item('i1', 'Standup')],
      settings: DEFAULT_SETTINGS,
      waterMlToday: 0,
      manualBusy: null,
      state: quiet()
    })
    expect(r.events.map((e) => [e.kind, e.parts])).toEqual([['meeting-soon', []]])
  })
})
