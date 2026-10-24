import type { BreakPart } from './breaks'
import type { ReminderEvent, ReminderKind } from './reminders'
import type { Minutes, Settings } from './types'
import type { CameraKind } from './faceCues'
import type { WellbeingKind } from './wellbeing'

/** Reminders that get a banner in the popover; punch and time's-up have banners already. */
export type AlertKind =
  | 'break'
  | 'heads-up'
  | 'lunch'
  | 'overtime'
  | 'meeting-soon'
  | 'meeting-now'
  | 'focus-done'
  | 'slump'
  | WellbeingKind
  | CameraKind
export interface Alert {
  id: string
  kind: AlertKind
  title: string
  body: string
  parts: BreakPart[]
  at: Minutes
  /** The custom reminder behind a 'custom' alert (for its snooze). */
  reminderId?: string
}
export const MAX_ALERTS = 5

const BANNER_KINDS: ReminderKind[] = [
  'break',
  'heads-up',
  'lunch',
  'overtime',
  'meeting-soon',
  'meeting-now',
  'focus-done',
  'slump',
  'checkin',
  'custom',
  'posture',
  'daylight',
  'wind-down',
  'call-fatigue',
  'breathe',
  'commute',
  'fatigue',
  'dry-eyes',
  'drowsy',
  'slouch',
  'screen-distance'
]
const NUDGE_LABEL = "Time's up"
/** Banners never pushed out by newer ones. */
const KEPT_KINDS: AlertKind[] = ['custom', 'heads-up']

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
    case 'slump':
      return 'Slump'
    case 'checkin':
      return 'Check-in'
    case 'custom':
      return 'Reminder'
    case 'posture':
      return 'Sit/stand'
    case 'daylight':
      return 'Daylight'
    case 'wind-down':
      return 'Wind down'
    case 'call-fatigue':
      return 'Many calls'
    case 'breathe':
      return 'Breathe'
    case 'commute':
      return 'Start your day'
    case 'fatigue':
      return 'Slowing down'
    case 'dry-eyes':
      return 'Blink'
    case 'drowsy':
      return 'Tired'
    case 'slouch':
      return 'Posture'
    case 'screen-distance':
      return 'Too close'
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
      at: now,
      ...(e.reminderId ? { reminderId: e.reminderId } : {})
    })
  })
  if (nudgeCount > 0) label = NUDGE_LABEL
  // Over the cap, the oldest ordinary banners go first; a reminder of the user's own or the
  // wrap-up warning stays until acted on.
  while (next.length > MAX_ALERTS) {
    const k = next.findIndex((a) => !KEPT_KINDS.includes(a.kind))
    next.splice(k === -1 ? 0 : k, 1)
  }
  return { alerts: next, unseen: label }
}
