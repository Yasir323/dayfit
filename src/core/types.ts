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
  createdAt: number
}
export type NewItem = Omit<Item, 'id' | 'status' | 'lockedStart' | 'suggestedSlots' | 'createdAt'>
export type BlockKind = 'fixed' | 'deep' | 'task' | 'walk'
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
export interface PlanResult {
  blocks: Block[]
  decisions: Decision[]
  unscheduled: string[]
}
export interface Settings {
  workStart: Minutes
  workEnd: Minutes
  lunch: Minutes | null
  bufferMin: number
  defaultDurations: Record<ItemType, number>
  water: { enabled: boolean; targetMl: number; glassMl: number }
  eye: { enabled: boolean; intervalMin: number; idleResetMin: number }
  stretch: { enabled: boolean; intervalMin: number }
  walk: { enabled: boolean; intervalMin: number; durationMin: number }
  meetingAlert: { enabled: boolean; leadMin: number }
  busy: { allowGentle: boolean }
  hotkey: string
  launchAtLogin: boolean
  firstRunDone: boolean
}

export const DEFAULT_SETTINGS: Settings = {
  workStart: 540,
  workEnd: 1080,
  lunch: null,
  bufferMin: 5,
  defaultDurations: { task: 30, call: 15, deep: 120, household: 15, fixed: 30 },
  water: { enabled: true, targetMl: 2000, glassMl: 250 },
  eye: { enabled: true, intervalMin: 20, idleResetMin: 5 },
  stretch: { enabled: true, intervalMin: 60 },
  walk: { enabled: true, intervalMin: 120, durationMin: 10 },
  meetingAlert: { enabled: true, leadMin: 5 },
  busy: { allowGentle: true },
  hotkey: 'CommandOrControl+Shift+Space',
  launchAtLogin: true,
  firstRunDone: false
}

export const isFixed = (i: Item): boolean => i.fixedStart !== null

/** Deep work and anything with a fixed start (meetings, a fixed run) hold breaks by default. */
export const defaultDnd = (type: ItemType, fixedStart: Minutes | null): boolean =>
  type === 'deep' || fixedStart !== null
