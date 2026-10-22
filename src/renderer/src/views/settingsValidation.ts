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

export function parseTime(s: string): Parsed<Minutes> {
  const m = parseClock(s)
  return m === null ? { ok: false, error: 'Enter a time' } : { ok: true, value: m }
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
