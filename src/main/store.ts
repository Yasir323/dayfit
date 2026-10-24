import fs from 'node:fs'
import type {
  Block,
  DateStr,
  Decision,
  DecisionAnswer,
  Item,
  LunchAnswer,
  LunchClash,
  Minutes,
  Settings
} from '../core/types'
import { DEFAULT_SETTINGS, defaultDnd } from '../core/types'
import type { Move } from '../core/replan'
import type { NudgeState } from '../core/nudge'
import type { ReminderState } from '../core/reminders'
import { EMPTY_REMINDER_STATE } from '../core/reminders'
import type { Alert } from '../core/alerts'
import type { DayStats } from '../core/summary'
import { EMPTY_WELLBEING_STATE, type WellbeingState } from '../core/wellbeing'
import { EMPTY_BREAK_STATE } from '../core/breaks'
import { EMPTY_CAMERA_STATE, type CameraState, type MinuteScore } from '../core/faceCues'
import { openDb, type Db } from './db'
import { EMPTY_END_OF_DAY_STATE, type EndOfDayState } from '../core/endOfDay'

export interface DayPlan {
  blocks: Block[]
  decisions: Decision[]
  unscheduled: string[]
  moves: Move[]
  /** Absent in plans saved before lunch clashes existed. */
  lunchClash?: LunchClash | null
  lunchAnswerRejected?: boolean
}

export interface AppState {
  version: 1
  settings: Settings
  items: Item[]
  plans: Record<DateStr, DayPlan>
  waterMl: Record<DateStr, number>
  coffee: Record<DateStr, number>
  /** Mood check-in answers by day (1 = exhausted … 5 = great). */
  moods: Record<DateStr, { at: Minutes; score: number }[]>
  /** Today's wellbeing nudge state (check-ins, custom reminders, …). */
  wellbeing: WellbeingState
  /** Home setup checklist items ticked. */
  ergonomics: string[]
  /** Usual cursor path per active second (fatigue signals), learned over days. */
  fatigueBaseline: number | null
  /** Per-day counters for the daily summary; only today's survives rollover. */
  stats: Record<DateStr, DayStats>
  reminder: ReminderState
  endOfDay: EndOfDayState
  /** Today's lunch-clash answer; ignored once the date moves on. */
  lunchAnswer: { date: DateStr; answer: LunchAnswer } | null
  /** Reminder banners not yet acted on (in-app fallback for dropped notifications). */
  alerts: Alert[]
  /** Today's review answers (unscheduled / use-other-half); cleared at rollover. */
  answers: DecisionAnswer[]
  /** A running focus session (manual busy is on while it runs). */
  focus: { itemId: string; endsAt: number; minutes: number; prevManualBusy: boolean | null } | null
  /** Label next to the menu-bar icon until the popover is opened. */
  unseen: string | null
  nudges: NudgeState
  overdue: string[]
  /** Today's camera minute scores (never frames) and the cue cooldowns. */
  camera: { date: DateStr | null; minutes: MinuteScore[]; state: CameraState }
  /** Google Calendar sync status; whether it's connected comes from the token file. */
  calendar: { lastSyncAt: number | null; lastError: string | null }
  manualBusy: boolean | null
  lastDate: DateStr | null
}

const clone = <T>(v: T): T => structuredClone(v)

export const defaultState = (): AppState => ({
  version: 1,
  settings: clone(DEFAULT_SETTINGS),
  items: [],
  plans: {},
  waterMl: {},
  coffee: {},
  moods: {},
  wellbeing: clone(EMPTY_WELLBEING_STATE),
  ergonomics: [],
  fatigueBaseline: null,
  stats: {},
  reminder: clone(EMPTY_REMINDER_STATE),
  endOfDay: clone(EMPTY_END_OF_DAY_STATE),
  lunchAnswer: null,
  alerts: [],
  answers: [],
  focus: null,
  unseen: null,
  nudges: {},
  overdue: [],
  calendar: { lastSyncAt: null, lastError: null },
  camera: { date: null, minutes: [], state: clone(EMPTY_CAMERA_STATE) },
  manualBusy: null,
  lastDate: null
})

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

function deepMerge<T>(base: T, over: unknown): T {
  if (!isPlainObject(base) || !isPlainObject(over)) return (over === undefined ? base : over) as T
  const out: Record<string, unknown> = { ...base }
  for (const [k, v] of Object.entries(over))
    out[k] = k in base ? deepMerge((base as Record<string, unknown>)[k], v) : v
  return out as T
}

/** A database, or a path to one (opened and closed around the call). */
export type StateSource = string | Db

const withDb = <T>(src: StateSource, fn: (db: Db) => T): T => {
  if (typeof src !== 'string') return fn(src)
  const db = openDb(src)
  try {
    return fn(db)
  } finally {
    db.close()
  }
}

export function loadState(src: StateSource): AppState {
  return withDb(src, (db) => {
    const parsed = db.readState()
    if (parsed === null) return defaultState()
    const state = normalizeState(parsed)
    if (state) return state
    // An unknown shape is kept aside for inspection, then the app starts fresh.
    fs.writeFileSync(`${db.file}.corrupt-${Date.now()}.json`, JSON.stringify(parsed))
    return defaultState()
  })
}

/** Older or partial state → today's shape; null when it isn't Dayfit state at all. */
export function normalizeState(parsed: unknown): AppState | null {
  if (!isPlainObject(parsed) || parsed.version !== 1) return null
  const defaults = defaultState()
  const state = { ...defaults, ...parsed } as AppState
  state.settings = deepMerge(defaults.settings, parsed.settings)
  // deepMerge keeps unknown keys; drop settings that no longer exist.
  delete (state.settings as Partial<Settings> & { busy?: unknown }).busy
  // Reminder state from before combined breaks has no `breaks`: keep meeting keys, reset the rest.
  const r = parsed.reminder
  state.reminder =
    isPlainObject(r) && isPlainObject(r.breaks)
      ? deepMerge(defaults.reminder, r)
      : {
          fired: isPlainObject(r) && Array.isArray(r.fired) ? r.fired : [],
          breaks: clone(EMPTY_BREAK_STATE)
        }
  state.wellbeing = deepMerge(defaults.wellbeing, parsed.wellbeing)
  state.calendar = deepMerge(defaults.calendar, parsed.calendar)
  state.camera = deepMerge(defaults.camera, parsed.camera)
  state.endOfDay = isPlainObject(parsed.endOfDay)
    ? deepMerge(defaults.endOfDay, parsed.endOfDay)
    : clone(EMPTY_END_OF_DAY_STATE)
  // Walks are reminders now; plans saved before that may still hold walk blocks.
  for (const d of Object.keys(state.plans)) {
    const plan = state.plans[d]
    state.plans[d] = { ...plan, blocks: plan.blocks.filter((b) => (b.kind as string) !== 'walk') }
  }
  // Items saved before per-item DND existed get the type-based default.
  state.items = state.items.map((i) =>
    typeof i.dnd === 'boolean' ? i : { ...i, dnd: defaultDnd(i.type, i.fixedStart) }
  )
  return state
}

export function saveState(src: StateSource, s: AppState): void {
  withDb(src, (db) => db.writeState(s))
}
