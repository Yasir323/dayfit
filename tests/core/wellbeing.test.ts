import { describe, expect, it } from 'vitest'
import { EMPTY_WELLBEING_STATE, stepWellbeing, type WellbeingInput } from '../../src/core/wellbeing'
import { DEFAULT_SETTINGS, type Block, type Item, type Settings } from '../../src/core/types'

const D = DEFAULT_SETTINGS
/** Only the feature a test is about fires: the always-on daily nudges are off here. */
const S: Settings = {
  ...D,
  firstRunDone: true,
  features: {
    ...D.features,
    daylight: { ...D.features.daylight, enabled: false },
    windDown: { ...D.features.windDown, enabled: false },
    callFatigue: { ...D.features.callFatigue, enabled: false }
  }
}
const input = (o: Partial<WellbeingInput> = {}): WellbeingInput => ({
  now: 600,
  elapsedMin: 1,
  idleSec: 0,
  blocks: [],
  items: [],
  settings: S,
  manualBusy: null,
  autoBusy: false,
  state: EMPTY_WELLBEING_STATE,
  ...o
})
const kinds = (r: ReturnType<typeof stepWellbeing>): string[] => r.events.map((e) => e.kind)

describe('mood check-in', () => {
  it('fires once at its time', () => {
    expect(kinds(stepWellbeing(input({ now: 629 })))).toEqual([])
    const r = stepWellbeing(input({ now: 630 }))
    expect(r.events).toEqual([
      { kind: 'checkin', title: 'How are you feeling?', body: 'Tap a face in Dayfit.' }
    ])
    expect(kinds(stepWellbeing(input({ now: 640, state: r.state })))).toEqual([])
  })

  it('waits while held and while away', () => {
    expect(kinds(stepWellbeing(input({ now: 630, manualBusy: true })))).toEqual([])
    expect(kinds(stepWellbeing(input({ now: 630, autoBusy: true })))).toEqual([])
    expect(kinds(stepWellbeing(input({ now: 630, idleSec: 600 })))).toEqual([])
    expect(kinds(stepWellbeing(input({ now: 700 })))).toEqual(['checkin'])
  })

  it('is skipped once more than 90 minutes late', () => {
    const r = stepWellbeing(input({ now: 721 }))
    expect(kinds(r)).toEqual([])
    expect(r.state.moodDone).toContain(630)
  })

  it('is off when the feature is off', () => {
    const off = { ...S, features: { ...S.features, mood: { ...S.features.mood, enabled: false } } }
    expect(kinds(stepWellbeing(input({ now: 630, settings: off })))).toEqual([])
  })

  it('a DND meeting holds it', () => {
    const meeting: Block = {
      itemId: 'm',
      kind: 'fixed',
      start: 620,
      end: 660,
      chunk: null,
      reason: ''
    }
    const item: Item = {
      id: 'm',
      title: 'Standup',
      type: 'fixed',
      durationMin: 40,
      label: null,
      priority: 'med',
      half: null,
      date: '2026-10-26',
      fixedStart: 620,
      deadline: null,
      repeat: { kind: 'none' },
      status: 'open',
      lockedStart: null,
      suggestedSlots: [],
      dnd: true,
      createdAt: 0
    }
    expect(kinds(stepWellbeing(input({ now: 630, blocks: [meeting], items: [item] })))).toEqual([])
  })
})

describe('custom reminders', () => {
  const withReminders = (reminders: Settings['features']['reminders']): Settings => ({
    ...S,
    features: { ...S.features, mood: { ...S.features.mood, enabled: false }, reminders }
  })
  const pill = {
    id: 'r1',
    title: 'Take vitamin D',
    kind: 'at' as const,
    times: [480, 1320],
    everyMin: 0,
    enabled: true
  }
  const stretchy = {
    id: 'r2',
    title: 'Roll shoulders',
    kind: 'every' as const,
    times: [],
    everyMin: 45,
    enabled: true
  }

  it('an at reminder fires once at its time, even busy or outside hours', () => {
    const settings = withReminders([pill])
    const r = stepWellbeing(input({ now: 480, settings, manualBusy: true }))
    expect(r.events).toEqual([
      { kind: 'custom', title: 'Take vitamin D', body: 'Reminder', reminderId: 'r1' }
    ])
    expect(kinds(stepWellbeing(input({ now: 481, settings, state: r.state })))).toEqual([])
    expect(kinds(stepWellbeing(input({ now: 1320, settings, state: r.state })))).toEqual(['custom'])
  })

  it('an at reminder waits for the user to be back, but not past 90 minutes', () => {
    const settings = withReminders([pill])
    expect(kinds(stepWellbeing(input({ now: 480, settings, idleSec: 900 })))).toEqual([])
    expect(kinds(stepWellbeing(input({ now: 560, settings })))).toEqual(['custom'])
    const late = stepWellbeing(input({ now: 571, settings }))
    expect(kinds(late)).toEqual([])
    expect(late.state.customFired.r1).toContain(480)
  })

  it('an every reminder repeats in working hours and waits while held', () => {
    const settings = withReminders([stretchy])
    expect(kinds(stepWellbeing(input({ now: 584, settings })))).toEqual([])
    const r = stepWellbeing(input({ now: 585, settings }))
    expect(kinds(r)).toEqual(['custom'])
    expect(kinds(stepWellbeing(input({ now: 629, settings, state: r.state })))).toEqual([])
    expect(
      kinds(stepWellbeing(input({ now: 630, settings, state: r.state, manualBusy: true })))
    ).toEqual([])
    expect(kinds(stepWellbeing(input({ now: 630, settings, state: r.state })))).toEqual(['custom'])
    expect(kinds(stepWellbeing(input({ now: 1100, settings })))).toEqual([])
  })

  it('a disabled reminder never fires', () => {
    const settings = withReminders([{ ...pill, enabled: false }])
    expect(kinds(stepWellbeing(input({ now: 480, settings })))).toEqual([])
  })

  it('a snoozed reminder comes back at its snooze time', () => {
    const settings = withReminders([pill])
    const state = {
      ...EMPTY_WELLBEING_STATE,
      customFired: { r1: [480] },
      customSnooze: { r1: 495 }
    }
    expect(kinds(stepWellbeing(input({ now: 494, settings, state })))).toEqual([])
    const r = stepWellbeing(input({ now: 495, settings, state }))
    expect(kinds(r)).toEqual(['custom'])
    expect(r.state.customSnooze.r1).toBeUndefined()
  })
})

describe('timed nudges', () => {
  const only = (patch: Partial<Settings['features']>): Settings => ({
    ...S,
    features: { ...D.features, mood: { ...D.features.mood, enabled: false }, ...patch }
  })
  const run = (
    settings: Settings,
    from: number,
    to: number,
    o: Partial<WellbeingInput> = {}
  ): [number, string, string][] => {
    let state = EMPTY_WELLBEING_STATE
    const out: [number, string, string][] = []
    for (let now = from; now <= to; now++) {
      const r = stepWellbeing(input({ ...o, now, settings, state }))
      state = r.state
      for (const e of r.events) out.push([now, e.kind, e.title])
    }
    return out
  }

  it('sit/stand alternates every interval of active work', () => {
    const settings = only({ standing: { enabled: true, intervalMin: 30 } })
    expect(run(settings, 540, 600)).toEqual([
      [569, 'posture', 'Time to stand up'],
      [599, 'posture', 'Time to sit down']
    ])
  })

  it('sit/stand is off by default', () => {
    expect(run(only({}), 540, 700).filter(([, k]) => k === 'posture')).toEqual([])
  })

  it('daylight fires once at its time, not while held', () => {
    const settings = only({})
    expect(run(settings, 680, 720).filter(([, k]) => k === 'daylight')).toEqual([
      [690, 'daylight', 'Get some daylight']
    ])
    expect(
      run(settings, 680, 720, { manualBusy: true }).filter(([, k]) => k === 'daylight')
    ).toEqual([])
  })

  it('wind-down fires once after work end plus its delay, even when busy', () => {
    const settings = only({})
    expect(
      run(settings, 1130, 1160, { manualBusy: true }).filter(([, k]) => k === 'wind-down')
    ).toEqual([[1140, 'wind-down', 'Time to wind down']])
  })

  it('call fatigue fires once when ended meetings reach the threshold', () => {
    const meeting = (start: number, end: number): Block => ({
      itemId: null,
      kind: 'fixed',
      start,
      end,
      chunk: null,
      reason: ''
    })
    const blocks = [meeting(540, 600), meeting(600, 660), meeting(700, 760), meeting(800, 830)]
    const fired = run(only({}), 540, 900, { blocks }).filter(([, k]) => k === 'call-fatigue')
    expect(fired).toEqual([[760, 'call-fatigue', 'Lots of calls today']])
  })
})
