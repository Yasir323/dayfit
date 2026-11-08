import { Notification, type NotificationConstructorOptions } from 'electron'
import { movesText } from '../core/movesText'
import type { ReminderEvent } from '../core/reminders'
import { clampSnooze, type BreakPart } from '../core/breaks'
import type { NudgeAnswer } from '../core/nudge'
import type { ViewState } from './service'
import { isPortalUrl } from '../core/portalUrl'
import type { AttendanceKind } from '../core/endOfDay'

export type NotifyInput =
  | { type: 'event'; event: ReminderEvent; snoozeMin: number; portalUrl: string }
  | { type: 'nudge'; itemId: string; title: string }
  | { type: 'info'; title: string; body: string }

/** After a nudge answered from a notification (popover hidden): the moves it caused, if any. */
export function planUpdatedNotice(view: ViewState): NotifyInput | null {
  const body = movesText(view.plan.moves, [...view.items, ...view.upcoming])
  return body === null ? null : { type: 'info', title: 'Plan updated', body }
}

export interface NotifyHandlers {
  /** Break "Drank" button. */
  onDrank(): void
  /** Break "Snooze" button: snoozes this notification's parts. */
  onSnooze(parts: BreakPart[]): void
  /** Nudge action button. */
  onNudge(itemId: string, answer: NudgeAnswer): void
  /** Attendance "Punched" button. */
  onPunched(kind: AttendanceKind): void
  /** Attendance "Open portal" button. */
  onOpenPortal(): void
  /** Plain click (and the only interaction on Windows): where the popover should open. */
  onOpen(target: 'nudge' | 'checkout' | null): void
  /** Whether the system showed the notification (false: it refused, e.g. an unsigned macOS app). */
  onDelivery(shown: boolean): void
}

const NUDGE_ACTIONS: { text: string; answer: NudgeAnswer }[] = [
  { text: 'Done', answer: 'done' },
  { text: '+15 min', answer: 'extend' },
  { text: 'Move it', answer: 'move' }
]

/** Snooze first (index 0), then Drank (index 1) when water is part of the break. */
const breakActions = (event: ReminderEvent, snoozeMin: number): string[] => [
  ...(event.parts.includes('water') ? ['Drank'] : []),
  `Snooze ${clampSnooze(snoozeMin)} min`
]

const attendanceKind = (event: ReminderEvent): AttendanceKind | null =>
  event.kind === 'attendance-in' ? 'in' : event.kind === 'attendance-out' ? 'out' : null

/** Action texts for an event notification, in button order; the click handler maps by text. */
function eventActions(input: Extract<NotifyInput, { type: 'event' }>): string[] {
  const { event } = input
  if (event.kind === 'break') return breakActions(event, input.snoozeMin)
  if (attendanceKind(event) !== null)
    return ['Punched', ...(isPortalUrl(input.portalUrl) ? ['Open portal'] : [])]
  return []
}

export function buildNotificationOptions(
  input: NotifyInput,
  platform: NodeJS.Platform
): NotificationConstructorOptions & { title: string } {
  const mac = platform === 'darwin'
  if (input.type === 'nudge') {
    return {
      title: `${input.title} — time's up`,
      body: 'Done, need 15 more min, or move it?',
      silent: false,
      ...(mac
        ? { actions: NUDGE_ACTIONS.map((a) => ({ type: 'button' as const, text: a.text })) }
        : {})
    }
  }
  if (input.type === 'info') return { title: input.title, body: input.body, silent: true }
  const { event } = input
  return {
    title: event.title,
    body: event.body,
    silent: event.silent,
    ...(mac && eventActions(input).length > 0
      ? { actions: eventActions(input).map((text) => ({ type: 'button' as const, text })) }
      : {})
  }
}

/** Keeps live notifications referenced so they are not garbage collected before a click. */
const live = new Set<Notification>()

export function showNotification(
  input: NotifyInput,
  platform: NodeJS.Platform,
  handlers: NotifyHandlers
): void {
  if (!Notification.isSupported()) return
  const n = new Notification(buildNotificationOptions(input, platform))
  n.on('click', () =>
    handlers.onOpen(
      input.type === 'nudge'
        ? 'nudge'
        : input.type === 'event' && input.event.kind === 'heads-up'
          ? 'checkout'
          : null
    )
  )
  n.on('action', (_e, index) => {
    if (input.type === 'nudge') {
      const a = NUDGE_ACTIONS[index]
      if (a) handlers.onNudge(input.itemId, a.answer)
    } else if (input.type === 'event') {
      const text = eventActions(input)[index]
      const kind = attendanceKind(input.event)
      if (text === 'Drank') handlers.onDrank()
      else if (text?.startsWith('Snooze')) handlers.onSnooze(input.event.parts)
      else if (text === 'Open portal') handlers.onOpenPortal()
      else if (text === 'Punched' && kind !== null) handlers.onPunched(kind)
    }
  })
  n.on('show', () => handlers.onDelivery(true))
  n.on('failed', (_e, error) => {
    console.warn('notification not shown:', error)
    live.delete(n)
    handlers.onDelivery(false)
  })
  live.add(n)
  n.on('close', () => live.delete(n))
  n.show()
}
