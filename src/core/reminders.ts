import { EMPTY_BREAK_STATE, stepBreaks, type BreakPart, type BreakState } from './breaks'
import type { CameraKind } from './faceCues'
import type { WellbeingKind } from './wellbeing'
import type { EndOfDayKind } from './endOfDay'
import type { Block, Item, Minutes, Settings } from './types'

export type ReminderKind =
  | 'meeting-soon'
  | 'meeting-now'
  | 'break'
  | 'focus-done'
  | EndOfDayKind
  | WellbeingKind
  | CameraKind
export interface ReminderEvent {
  kind: ReminderKind
  itemId: string | null
  title: string
  body: string
  silent: boolean
  parts: BreakPart[] // [] for meetings
  /** The custom reminder behind a 'custom' event. */
  reminderId?: string
}
export interface ReminderState {
  fired: string[] // 'meeting-soon:<id>:<start>', 'meeting-now:<id>:<start>'
  breaks: BreakState
}

export const EMPTY_REMINDER_STATE: ReminderState = {
  fired: [],
  breaks: EMPTY_BREAK_STATE
}

const inside = (b: Block, now: Minutes): boolean => now >= b.start && now < b.end

export function isBusy(blocks: Block[], now: Minutes, manual: boolean | null): boolean {
  if (manual !== null) return manual
  return blocks.some((b) => (b.kind === 'fixed' || b.kind === 'deep') && inside(b, now))
}

export function dueReminders(input: {
  now: Minutes
  elapsedMin: number
  idleSec: number
  blocks: Block[]
  items: Item[]
  settings: Settings
  waterMlToday: number
  manualBusy: boolean | null
  state: ReminderState
}): { events: ReminderEvent[]; state: ReminderState } {
  const { now, blocks, items, settings } = input
  const state: ReminderState = { ...input.state, fired: [...input.state.fired] }
  const events: ReminderEvent[] = []

  // Meeting alerts: ignore busy mode.
  if (settings.meetingAlert.enabled) {
    const lead = settings.meetingAlert.leadMin
    for (const b of blocks) {
      if (b.kind !== 'fixed') continue
      const item = items.find((i) => i.id === b.itemId)
      // A meeting marked done or deleted needs no alert.
      if (item?.status === 'done' || item?.status === 'dropped') continue
      const title = item?.title ?? 'Meeting'
      const soonKey = `meeting-soon:${b.itemId}:${b.start}`
      const nowKey = `meeting-now:${b.itemId}:${b.start}`
      if (now >= b.start - lead && now < b.start && !state.fired.includes(soonKey)) {
        state.fired.push(soonKey)
        events.push({
          kind: 'meeting-soon',
          itemId: b.itemId,
          title: `${title} in ${lead} min`,
          body: `Prep: ${title} in ${lead} min`,
          silent: false,
          parts: []
        })
      }
      if (inside(b, now) && !state.fired.includes(nowKey)) {
        state.fired.push(nowKey)
        events.push({
          kind: 'meeting-now',
          itemId: b.itemId,
          title: `${title} is starting`,
          body: 'Time to join.',
          silent: false,
          parts: []
        })
      }
    }
  }

  // Breaks: eye, water, stretch and walk combine into one held, snoozable notification.
  const r = stepBreaks({ ...input, state: input.state.breaks })
  state.breaks = r.state
  if (r.fire)
    events.push({
      kind: 'break',
      itemId: null,
      title: r.fire.title,
      body: r.fire.body,
      silent: false,
      parts: r.fire.parts
    })

  return { events, state }
}
