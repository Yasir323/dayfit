import { describe, expect, it } from 'vitest'
import { dueReminders, EMPTY_REMINDER_STATE } from '../../src/core/reminders'
import { DEFAULT_SETTINGS, type Block, type Item } from '../../src/core/types'

const meeting = (status: Item['status']): Item => ({
  id: 'm',
  title: 'Standup',
  type: 'fixed',
  durationMin: 30,
  label: null,
  priority: 'med',
  half: null,
  date: '2026-10-23',
  fixedStart: 600,
  deadline: null,
  repeat: { kind: 'none' },
  status,
  lockedStart: null,
  suggestedSlots: [],
  createdAt: 1
})
const block: Block = {
  itemId: 'm',
  kind: 'fixed',
  start: 600,
  end: 630,
  chunk: null,
  reason: 'Fixed'
}

const kinds = (status: Item['status'], now: number): string[] =>
  dueReminders({
    now,
    elapsedMin: 0,
    idleSec: 0,
    blocks: [block],
    items: [meeting(status)],
    settings: { ...DEFAULT_SETTINGS, water: { ...DEFAULT_SETTINGS.water, enabled: false } },
    waterMlToday: 0,
    manualBusy: null,
    state: structuredClone(EMPTY_REMINDER_STATE)
  }).events.map((e) => e.kind)

describe('meeting alerts', () => {
  it('fire for an open fixed item', () => {
    expect(kinds('open', 596)).toContain('meeting-soon')
    expect(kinds('open', 600)).toContain('meeting-now')
  })

  it('skip fixed items that are done or dropped', () => {
    for (const status of ['done', 'dropped'] as const) {
      expect(kinds(status, 596)).not.toContain('meeting-soon')
      expect(kinds(status, 600)).not.toContain('meeting-now')
    }
  })
})
