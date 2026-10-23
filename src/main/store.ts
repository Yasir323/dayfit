import fs from 'node:fs'
import path from 'node:path'
import type { Block, DateStr, Decision, Item, Settings } from '../core/types'
import { DEFAULT_SETTINGS, defaultDnd } from '../core/types'
import type { Move } from '../core/replan'
import type { NudgeState } from '../core/nudge'
import type { ReminderState } from '../core/reminders'
import { EMPTY_REMINDER_STATE } from '../core/reminders'

export interface DayPlan {
  blocks: Block[]
  decisions: Decision[]
  unscheduled: string[]
  moves: Move[]
}

export interface AppState {
  version: 1
  settings: Settings
  items: Item[]
  plans: Record<DateStr, DayPlan>
  waterMl: Record<DateStr, number>
  reminder: ReminderState
  nudges: NudgeState
  overdue: string[]
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
  reminder: clone(EMPTY_REMINDER_STATE),
  nudges: {},
  overdue: [],
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

export function loadState(file: string): AppState {
  let raw: string
  try {
    raw = fs.readFileSync(file, 'utf8')
  } catch (e) {
    if ((e as NodeJS.ErrnoException).code === 'ENOENT') return defaultState()
    throw e
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    parsed = null
  }
  if (!isPlainObject(parsed) || parsed.version !== 1) {
    fs.renameSync(file, `${file}.corrupt-${Date.now()}`)
    return defaultState()
  }
  const defaults = defaultState()
  const state = { ...defaults, ...parsed } as AppState
  state.settings = deepMerge(defaults.settings, parsed.settings)
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

export function saveState(file: string, s: AppState): void {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  const tmp = `${file}.tmp`
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2))
  fs.renameSync(tmp, file)
}
