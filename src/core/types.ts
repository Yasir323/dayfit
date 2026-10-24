export type DateStr = string // 'YYYY-MM-DD'
export type Minutes = number // since local midnight
export type ItemType = 'task' | 'call' | 'deep' | 'fixed' | 'household'
export type Priority = 'high' | 'med' | 'low'
export type Half = 'am' | 'pm' | null
export type Repeat =
  { kind: 'none' } | { kind: 'daily' } | { kind: 'weekdays' } | { kind: 'weekly'; days: number[] } // 0 = Sunday
export interface Deadline {
  date: DateStr
  time: Minutes | null
}
export interface Item {
  id: string
  title: string
  type: ItemType
  durationMin: number
  label: string | null
  priority: Priority
  half: Half
  date: DateStr
  fixedStart: Minutes | null // set => item is fixed
  deadline: Deadline | null
  repeat: Repeat
  status: 'open' | 'done' | 'dropped'
  lockedStart: Minutes | null // user-locked planned block
  suggestedSlots: Minutes[] // calls awaiting a time
  dnd: boolean // holds break reminders while this item runs
  /** Repeating items: the dates they were marked done (a one-off uses `status`). */
  doneDates?: DateStr[]
  createdAt: number
}
export type NewItem = Omit<
  Item,
  'id' | 'status' | 'lockedStart' | 'suggestedSlots' | 'createdAt' | 'doneDates'
>
export type BlockKind = 'fixed' | 'deep' | 'task' | 'lunch'
export interface Block {
  itemId: string | null
  kind: BlockKind
  start: Minutes
  end: Minutes
  chunk: { index: number; of: number } | null
  reason: string
}
export type Decision =
  | { kind: 'half-overflow'; itemId: string; preferred: 'am' | 'pm' }
  | { kind: 'no-fit'; itemId: string }
export type DecisionChoice = 'use-other-half' | 'tomorrow' | 'unscheduled' | 'drop'
export interface DecisionAnswer {
  itemId: string
  choice: DecisionChoice
}
/** Today's answer to a lunch clash: skip, or lunch at an exact time and length. */
export type LunchAnswer = { kind: 'skip' } | { kind: 'at'; start: Minutes; len: number }
/** What Review sends: shorten / move are resolved against the current plan when answered. */
export type LunchChoice = LunchAnswer | { kind: 'shorten' } | { kind: 'move' }
/** Lunch can't sit at its usual time; the user picks shorten / move / a time / skip. */
export interface LunchClash {
  reason: 'clash' | 'passed'
  usual: Minutes
  clashWith: string | null
  /** No block is in the way: lunch just doesn't fit inside working hours. */
  outOfHours: boolean
  shorten: { start: Minutes; len: number } | null
  move: Minutes | null
}
export interface PlanResult {
  blocks: Block[]
  decisions: Decision[]
  unscheduled: string[]
  lunchClash: LunchClash | null
  /** The saved lunch answer no longer fits (a new clash); the caller should forget it. */
  lunchAnswerRejected: boolean
}
/** A user-made reminder: at set times (fires even when busy) or every N minutes of work. */
export interface CustomReminder {
  id: string
  title: string
  kind: 'at' | 'every'
  times: Minutes[]
  everyMin: number
  enabled: boolean
}

/** Optional wellbeing features, each with its own switch. */
export interface Features {
  mood: { enabled: boolean; times: Minutes[] }
  standing: { enabled: boolean; intervalMin: number }
  breathe: { enabled: boolean }
  windDown: { enabled: boolean; afterMin: number }
  daylight: { enabled: boolean; at: Minutes }
  callFatigue: { enabled: boolean; thresholdMin: number }
  commute: { enabled: boolean }
  autoBusyFullscreen: { enabled: boolean }
  fatigue: { enabled: boolean }
  reminders: CustomReminder[]
}

export interface Settings {
  workStart: Minutes
  workEnd: Minutes
  /** Days worked, 0 = Sunday … 6 = Saturday. */
  workDays: number[]
  lunch: Minutes | null
  bufferMin: number
  /** Kept free of tasks after back-to-back meetings. */
  meetingGapMin: number
  defaultDurations: Record<ItemType, number>
  water: { enabled: boolean; intervalMin: number; targetMl: number; glassMl: number }
  eye: { enabled: boolean; intervalMin: number; idleResetMin: number }
  stretch: { enabled: boolean; intervalMin: number }
  walk: { enabled: boolean; intervalMin: number; durationMin: number }
  meetingAlert: { enabled: boolean; leadMin: number }
  breaks: { snoozeMin: number }
  /** Caffeine cap and the time after which coffee isn't suggested. */
  coffee: { capCups: number; cutoff: Minutes }
  endOfDay: {
    attendance: boolean
    portalUrl: string // '' when not set; only http(s) links are kept
    lunchMin: number
    headsUp: boolean
    overtime: boolean
  }
  features: Features
  hotkey: string
  launchAtLogin: boolean
  firstRunDone: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  workStart: 540,
  workEnd: 1080,
  workDays: [1, 2, 3, 4, 5],
  lunch: null,
  bufferMin: 5,
  meetingGapMin: 10,
  defaultDurations: { task: 30, call: 15, deep: 120, household: 15, fixed: 30 },
  water: { enabled: true, intervalMin: 60, targetMl: 2000, glassMl: 250 },
  eye: { enabled: true, intervalMin: 20, idleResetMin: 5 },
  stretch: { enabled: true, intervalMin: 60 },
  walk: { enabled: true, intervalMin: 120, durationMin: 10 },
  meetingAlert: { enabled: true, leadMin: 5 },
  breaks: { snoozeMin: 10 },
  coffee: { capCups: 3, cutoff: 900 },
  endOfDay: { attendance: true, portalUrl: '', lunchMin: 45, headsUp: true, overtime: true },
  features: {
    mood: { enabled: true, times: [630, 810, 990] },
    standing: { enabled: false, intervalMin: 30 },
    breathe: { enabled: true },
    windDown: { enabled: true, afterMin: 60 },
    daylight: { enabled: true, at: 690 },
    callFatigue: { enabled: true, thresholdMin: 180 },
    commute: { enabled: true },
    autoBusyFullscreen: { enabled: false },
    fatigue: { enabled: false },
    reminders: []
  },
  hotkey: 'CommandOrControl+Shift+Space',
  launchAtLogin: true,
  firstRunDone: false
}

export const isFixed = (i: Item): boolean => i.fixedStart !== null

/** Deep work and anything with a fixed start (meetings, a fixed run) hold breaks by default. */
export const defaultDnd = (type: ItemType, fixedStart: Minutes | null): boolean =>
  type === 'deep' || fixedStart !== null
