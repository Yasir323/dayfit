import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  Notification: class {
    static isSupported = (): boolean => true
  }
}))

import {
  buildNotificationOptions,
  planUpdatedNotice,
  type NotifyInput
} from '../../src/main/notify'
import type { ViewState } from '../../src/main/service'
import type { ReminderEvent } from '../../src/core/reminders'

const brk: ReminderEvent = {
  kind: 'break',
  itemId: null,
  title: 'Break time',
  body: 'Look 20 ft away · Drink water (0 / 2000 ml)',
  silent: false,
  parts: ['eye', 'water']
}
const ev = (event: ReminderEvent): NotifyInput => ({
  type: 'event',
  event,
  snoozeMin: 10,
  portalUrl: ''
})

describe('buildNotificationOptions', () => {
  it('break on darwin has Snooze then Drank', () => {
    const o = buildNotificationOptions(ev(brk), 'darwin')
    expect(o.actions).toEqual([
      { type: 'button', text: 'Snooze 10 min' },
      { type: 'button', text: 'Drank' }
    ])
  })

  it('the Snooze button shows the clamped length', () => {
    const o = buildNotificationOptions(
      { type: 'event', event: brk, snoozeMin: 90, portalUrl: '' },
      'darwin'
    )
    expect(o.actions?.[0]).toEqual({ type: 'button', text: 'Snooze 60 min' })
  })

  it('attendance shows Open portal only for a valid link, then Punched', () => {
    const punch: ReminderEvent = {
      kind: 'attendance-in',
      itemId: null,
      title: 'Punch in',
      body: 'Mark your attendance for today.',
      silent: false,
      parts: []
    }
    const texts = (portalUrl: string): (string | undefined)[] | undefined =>
      buildNotificationOptions(
        { type: 'event', event: punch, snoozeMin: 10, portalUrl },
        'darwin'
      ).actions?.map((a) => a.text)
    expect(texts('https://hr.example.com')).toEqual(['Open portal', 'Punched'])
    expect(texts('')).toEqual(['Punched'])
    expect(texts('javascript:x')).toEqual(['Punched'])
    for (const kind of ['heads-up', 'overtime', 'lunch'] as const)
      expect(
        buildNotificationOptions(
          { type: 'event', event: { ...punch, kind }, snoozeMin: 10, portalUrl: 'https://x.io' },
          'darwin'
        ).actions
      ).toBeUndefined()
  })

  it('no Drank without water', () => {
    const o = buildNotificationOptions(ev({ ...brk, parts: ['eye'] }), 'darwin')
    expect(o.actions).toEqual([{ type: 'button', text: 'Snooze 10 min' }])
  })

  it('no actions on win32', () => {
    expect(buildNotificationOptions(ev(brk), 'win32').actions).toBeUndefined()
  })

  it('meeting events have no actions', () => {
    const meeting = { ...brk, kind: 'meeting-soon' as const, parts: [] }
    expect(buildNotificationOptions(ev(meeting), 'darwin').actions).toBeUndefined()
  })

  it('passes silent through', () => {
    const o = buildNotificationOptions(ev({ ...brk, silent: true }), 'darwin')
    expect(o.silent).toBe(true)
  })

  it('titles a nudge "<title> — time\'s up" with three darwin actions', () => {
    const o = buildNotificationOptions(
      { type: 'nudge', itemId: 'a', title: 'Write report' },
      'darwin'
    )
    expect(o.title).toBe("Write report — time's up")
    expect(o.title.endsWith("— time's up")).toBe(true)
    expect(o.body).toBe('Done, need 15 more min, or move it?')
    expect(o.actions?.map((a) => a.text)).toEqual(['Done', '+15 min', 'Move it'])
  })
})

describe('planUpdatedNotice', () => {
  const view = (moves: { itemId: string; from: number | null; to: number | null }[]): ViewState =>
    ({
      plan: { blocks: [], decisions: [], unscheduled: [], moves },
      items: [{ id: 'a', title: 'Write report' }],
      upcoming: []
    }) as unknown as ViewState

  it('is a "Plan updated" notice listing the moves', () => {
    const n = planUpdatedNotice(view([{ itemId: 'a', from: 600, to: 660 }]))
    expect(n).toEqual({
      type: 'info',
      title: 'Plan updated',
      body: 'Moved: Write report 10:00 → 11:00'
    })
    const o = buildNotificationOptions(n!, 'darwin')
    expect(o).toMatchObject({ title: 'Plan updated', body: 'Moved: Write report 10:00 → 11:00' })
    expect(o.actions).toBeUndefined()
  })

  it('is null when nothing moved', () => {
    expect(planUpdatedNotice(view([{ itemId: 'a', from: null, to: 660 }]))).toBeNull()
  })
})
