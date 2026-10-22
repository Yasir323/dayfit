import { Notification, type NotificationConstructorOptions } from 'electron'
import type { ReminderEvent } from '../core/reminders'
import type { NudgeAnswer } from '../core/nudge'

export type NotifyInput =
  { type: 'event'; event: ReminderEvent } | { type: 'nudge'; itemId: string; title: string }

export interface NotifyHandlers {
  /** Water "Drank" button. */
  onDrank(): void
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
  const { event } = input
  return {
    title: event.title,
    body: event.body,
    silent: event.silent,
    ...(mac && event.kind === 'water'
      ? { actions: [{ type: 'button' as const, text: 'Drank' }] }
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
    } else if (input.event.kind === 'water' && index === 0) {
      handlers.onDrank()
    }
  })
  live.add(n)
  n.on('close', () => live.delete(n))
  n.show()
}
