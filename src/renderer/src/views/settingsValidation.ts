import { isPortalUrl } from '../../../core/portalUrl'
import { parseClock } from '../../../core/time'
import type { Minutes } from '../../../core/types'

export const END_ERROR = 'End must be after start'
export const LUNCH_ERROR = 'Lunch must be within working hours'
export const POSITIVE_ERROR = 'Must be greater than 0'

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string }

export function parsePositive(s: string): Parsed<number> {
  const n = Number(s)
  if (s.trim() === '' || !Number.isInteger(n) || n <= 0) return { ok: false, error: POSITIVE_ERROR }
  return { ok: true, value: n }
}

export const URL_ERROR = 'Enter an http(s) link'

/** Empty clears the link; anything else must be an http(s) URL. */
export function parsePortalUrl(s: string): Parsed<string> {
  if (s.trim() === '') return { ok: true, value: '' }
  return isPortalUrl(s) ? { ok: true, value: s.trim() } : { ok: false, error: URL_ERROR }
}

export const SNOOZE_ERROR = 'Must be 1–60'

export function parseSnooze(s: string): Parsed<number> {
  const n = Number(s)
  if (s.trim() === '' || !Number.isInteger(n) || n < 1 || n > 60)
    return { ok: false, error: SNOOZE_ERROR }
  return { ok: true, value: n }
}

export function parseTime(s: string): Parsed<Minutes> {
  const m = parseClock(s)
  return m === null ? { ok: false, error: 'Enter a time' } : { ok: true, value: m }
}

/** A comma-separated list of clock times, e.g. "08:00, 14:30"; sorted, duplicates dropped. */
export function parseTimes(s: string): Parsed<Minutes[]> {
  const parts = s
    .split(',')
    .map((p) => p.trim())
    .filter((p) => p !== '')
  const times = parts.map(parseClock)
  if (parts.length === 0 || times.some((t) => t === null))
    return { ok: false, error: 'Use times like 08:00, 14:30' }
  return { ok: true, value: [...new Set(times as Minutes[])].sort((a, b) => a - b) }
}

/** Empty lunch is valid (null); otherwise it must lie strictly between start and end. */
export function parseLunch(s: string, start: Minutes, end: Minutes): Parsed<Minutes | null> {
  if (s.trim() === '') return { ok: true, value: null }
  const t = parseTime(s)
  if (!t.ok) return t
  if (t.value <= start || t.value >= end) return { ok: false, error: LUNCH_ERROR }
  return t
}

export function checkEnd(start: Minutes, end: Minutes): string | null {
  return end > start ? null : END_ERROR
}
