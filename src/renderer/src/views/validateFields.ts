import type { NewItem } from '../../../core/types'

/** Returns the first problem that blocks saving, or null. */
export function validateFields(v: NewItem): string | null {
  if (!Number.isInteger(v.durationMin) || v.durationMin <= 0)
    return 'Duration must be a whole number above 0'
  if (v.type === 'fixed' && v.fixedStart === null) return 'Set a start time'
  if (v.repeat.kind === 'weekly' && v.repeat.days.length === 0) return 'Pick at least one day'
  return null
}
