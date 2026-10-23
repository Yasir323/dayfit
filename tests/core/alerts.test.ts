import { describe, expect, it } from 'vitest'
import { MAX_ALERTS, labelFor, recordAlerts, type Alert } from '../../src/core/alerts'
import type { ReminderEvent, ReminderKind } from '../../src/core/reminders'
import { DEFAULT_SETTINGS } from '../../src/core/types'

const S = DEFAULT_SETTINGS
const ev = (kind: ReminderKind, body = ''): ReminderEvent => ({
  kind,
  itemId: null,
  title: kind,
  body,
  silent: false,
  parts: kind === 'break' ? ['eye'] : []
})

describe('labelFor', () => {
  it('maps every kind', () => {
    const kinds: [ReminderKind, string][] = [
      ['break', 'Break'],
      ['attendance-in', 'Punch in'],
      ['attendance-out', 'Punch out'],
      ['lunch', 'Lunch'],
      ['heads-up', 'Wrap up'],
      ['overtime', 'Past hours'],
      ['meeting-soon', 'Meeting 5m'],
      ['meeting-now', 'Meeting now'],
      ['focus-done', 'Focus done']
    ]
    for (const [k, label] of kinds) expect(labelFor(ev(k), S)).toBe(label)
    const lead10 = { ...S, meetingAlert: { ...S.meetingAlert, leadMin: 10 } }
    expect(labelFor(ev('meeting-soon'), lead10)).toBe('Meeting 10m')
  })
})

describe('recordAlerts', () => {
  it('break replaces an older break; others append', () => {
    const a = recordAlerts([], null, [ev('break', 'old')], 0, 600, S)
    const b = recordAlerts(a.alerts, a.unseen, [ev('lunch')], 0, 610, S)
    const c = recordAlerts(b.alerts, b.unseen, [ev('break', 'new')], 0, 620, S)
    expect(c.alerts.map((x) => x.kind)).toEqual(['lunch', 'break'])
    expect(c.alerts[1]).toMatchObject({ body: 'new', id: 'break:620:0', at: 620, parts: ['eye'] })
  })

  it('label is the latest event; nudges win', () => {
    expect(recordAlerts([], null, [ev('lunch'), ev('heads-up')], 0, 600, S).unseen).toBe('Wrap up')
    expect(recordAlerts([], null, [ev('lunch'), ev('heads-up')], 1, 600, S).unseen).toBe(
      "Time's up"
    )
    expect(recordAlerts([], null, [], 2, 600, S).unseen).toBe("Time's up")
  })

  it('attendance sets the label but adds no banner', () => {
    const r = recordAlerts([], null, [ev('attendance-in')], 0, 540, S)
    expect(r).toEqual({ alerts: [], unseen: 'Punch in' })
  })

  it('list capped at 5, oldest dropped', () => {
    let alerts: Alert[] = []
    for (let n = 0; n < 7; n++)
      alerts = recordAlerts(alerts, null, [ev('lunch')], 0, 600 + n, S).alerts
    expect(alerts).toHaveLength(MAX_ALERTS)
    expect(alerts[0].at).toBe(602)
  })

  it('no events keeps state', () => {
    const alerts: Alert[] = recordAlerts([], null, [ev('lunch')], 0, 600, S).alerts
    expect(recordAlerts(alerts, 'Lunch', [], 0, 700, S)).toEqual({ alerts, unseen: 'Lunch' })
  })
})
