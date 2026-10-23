import type { DateStr } from '../core/types'
import { normalizeState, type AppState } from './store'

export interface SavedDay {
  date: DateStr
  summary: unknown
}

/** Everything Dayfit keeps, as one JSON file. */
export interface Backup {
  app: 'dayfit'
  version: 1
  exportedAt: string
  state: AppState
  days: SavedDay[]
}

export function toBackup(state: AppState, days: SavedDay[], exportedAt: string): Backup {
  return { app: 'dayfit', version: 1, exportedAt, state, days }
}

const isObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v)

/** Reads a backup file's text; an Error says why it can't be used. */
export function parseBackup(json: string): Backup | Error {
  let raw: unknown
  try {
    raw = JSON.parse(json)
  } catch {
    return new Error('Not a Dayfit backup')
  }
  if (!isObject(raw) || raw.app !== 'dayfit') return new Error('Not a Dayfit backup')
  if (raw.version !== 1) return new Error('This backup is from a newer Dayfit')
  // Older state shapes are brought up to date, exactly as on load.
  const state = normalizeState(raw.state)
  if (!state) return new Error('The backup has no Dayfit data')
  const days = raw.days ?? []
  if (
    !Array.isArray(days) ||
    !days.every((d) => isObject(d) && typeof d.date === 'string' && 'summary' in d)
  )
    return new Error('The backup history is damaged')
  return {
    app: 'dayfit',
    version: 1,
    exportedAt: typeof raw.exportedAt === 'string' ? raw.exportedAt : '',
    state,
    days: days as SavedDay[]
  }
}
