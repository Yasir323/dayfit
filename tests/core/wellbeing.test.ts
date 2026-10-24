import { describe, expect, it } from 'vitest'
import { EMPTY_WELLBEING_STATE, stepWellbeing, type WellbeingInput } from '../../src/core/wellbeing'
import { DEFAULT_SETTINGS, type Block, type Item, type Settings } from '../../src/core/types'

const S: Settings = { ...DEFAULT_SETTINGS, firstRunDone: true }
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
