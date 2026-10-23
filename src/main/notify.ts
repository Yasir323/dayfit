import { Notification, type NotificationConstructorOptions } from 'electron'
import { movesText } from '../core/movesText'
import type { ReminderEvent } from '../core/reminders'
import { clampSnooze } from '../core/breaks'
import type { NudgeAnswer } from '../core/nudge'
import type { ViewState } from './service'

export type NotifyInput =
  | { type: 'event'; event: ReminderEvent; snoozeMin: number }
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
  /** Break "Snooze" button. */
  onSnooze(): void
  /** Nudge action button. */
  onNudge(itemId: string, answer: NudgeAnswer): void
  /** Plain click (and the only interaction on Windows). `nudge` is true for nudge notifications. */
  onOpen(nudge: boolean): void
}

const NUDGE_ACTIONS: { text: string; answer: NudgeAnswer }[] = [
  { text: 'Done', answer: 'done' },
  { text: '+15 min', answer: 'extend' },
  { text: 'Move it', answer: 'move' }
]

/** Snooze first (index 0), then Drank (index 1) when water is part of the break. */
const breakActions = (event: ReminderEvent, snoozeMin: number): string[] => [
  `Snooze ${clampSnooze(snoozeMin)} min`,
  ...(event.parts.includes('water') ? ['Drank'] : [])
]

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
    ...(mac && event.kind === 'break'
      ? {
          actions: breakActions(event, input.snoozeMin).map((text) => ({
            type: 'button' as const,
            text
          }))
        }
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
  n.on('click', () => handlers.onOpen(input.type === 'nudge'))
  n.on('action', (_e, index) => {
    if (input.type === 'nudge') {
      const a = NUDGE_ACTIONS[index]
      if (a) handlers.onNudge(input.itemId, a.answer)
    } else if (input.type === 'event' && input.event.kind === 'break') {
      if (index === 0) handlers.onSnooze()
      else if (index === 1) handlers.onDrank()
    }
  })
  live.add(n)
  n.on('close', () => live.delete(n))
  n.show()
}
