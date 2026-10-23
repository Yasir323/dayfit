import type { BreakPart } from './breaks'
import type { ReminderEvent, ReminderKind } from './reminders'
import type { Minutes, Settings } from './types'

/** Reminders that get a banner in the popover; punch and time's-up have banners already. */
export type AlertKind =
  'break' | 'heads-up' | 'lunch' | 'overtime' | 'meeting-soon' | 'meeting-now' | 'focus-done'
export interface Alert {
  id: string
  kind: AlertKind
  title: string
  body: string
  parts: BreakPart[]
  at: Minutes
}
export const MAX_ALERTS = 5

const BANNER_KINDS: ReminderKind[] = [
  'break',
  'heads-up',
  'lunch',
  'overtime',
  'meeting-soon',
  'meeting-now',
  'focus-done'
]
const NUDGE_LABEL = "Time's up"

/** Short text shown next to the menu-bar icon for a reminder. */
export function labelFor(event: ReminderEvent, s: Settings): string {
  return labelForKind(event.kind, s)
}

export function labelForKind(kind: ReminderKind, s: Settings): string {
  switch (kind) {
    case 'break':
      return 'Break'
    case 'attendance-in':
      return 'Punch in'
    case 'attendance-out':
      return 'Punch out'
    case 'lunch':
      return 'Lunch'
    case 'heads-up':
      return 'Wrap up'
    case 'overtime':
      return 'Past hours'
    case 'meeting-soon':
      return `Meeting ${s.meetingAlert.leadMin}m`
    case 'meeting-now':
      return 'Meeting now'
    case 'focus-done':
      return 'Focus done'
  }
}

/**
 * The user acted on these alerts (here or from a notification): drop them, and clear the
 * menu-bar label if it was theirs.
 */
export function clearAlerts(
  alerts: Alert[],
  unseen: string | null,
  gone: (a: Alert) => boolean,
  s: Settings
): { alerts: Alert[]; unseen: string | null } {
  const removed = alerts.filter(gone)
  const labels = new Set(removed.map((a) => labelForKind(a.kind, s)))
  return {
    alerts: alerts.filter((a) => !gone(a)),
    unseen: unseen !== null && labels.has(unseen) ? null : unseen
  }
}

/** Adds this tick's reminders: the latest one becomes the label, banner kinds become alerts. */
export function recordAlerts(
  alerts: Alert[],
  unseen: string | null,
  events: ReminderEvent[],
  nudgeCount: number,
  now: Minutes,
  s: Settings
): { alerts: Alert[]; unseen: string | null } {
  if (events.length === 0 && nudgeCount === 0) return { alerts, unseen }
  let next = [...alerts]
  let label = unseen
  events.forEach((e, n) => {
    label = labelFor(e, s)
    if (!BANNER_KINDS.includes(e.kind)) return
    // Only the newest break matters; an older one is already out of date.
    if (e.kind === 'break') next = next.filter((a) => a.kind !== 'break')
    next.push({
      id: `${e.kind}:${now}:${n}`,
      kind: e.kind as AlertKind,
      title: e.title,
      body: e.body,
      parts: e.parts,
      at: now
    })
  })
  if (nudgeCount > 0) label = NUDGE_LABEL
  return { alerts: next.slice(-MAX_ALERTS), unseen: label }
}
