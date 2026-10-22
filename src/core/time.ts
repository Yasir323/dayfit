import type { DateStr, Minutes, Settings } from './types'

const pad = (n: number): string => String(n).padStart(2, '0')

export function parseClock(s: string): Minutes | null {
  const m = /^\s*(\d{1,2})(?::(\d{2}))?\s*(am|pm)?\s*$/i.exec(s)
  if (!m) return null
  let h = Number(m[1])
  const min = m[2] === undefined ? 0 : Number(m[2])
  const suffix = m[3]?.toLowerCase()
  if (min > 59) return null
  if (suffix) {
    if (h < 1 || h > 12) return null
    h = (h % 12) + (suffix === 'pm' ? 12 : 0)
  } else if (h > 23) {
    return null
  }
  return h * 60 + min
}

export function formatClock(m: Minutes): string {
  return `${pad(Math.floor(m / 60))}:${pad(m % 60)}`
}

// Calendar math is done in UTC so DST never shifts a date.
function parseDate(d: DateStr): number {
  const [y, mo, da] = d.split('-').map(Number)
  return Date.UTC(y, mo - 1, da)
}

function fromUtc(ms: number): DateStr {
  const d = new Date(ms)
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function addDays(d: DateStr, n: number): DateStr {
  return fromUtc(parseDate(d) + n * 86400000)
}

export function weekday(d: DateStr): number {
  return new Date(parseDate(d)).getUTCDay()
}

export function nextWeekday(from: DateStr, wd: number): DateStr {
  return addDays(from, (wd - weekday(from) + 7) % 7)
}

export function halfBoundary(s: Settings): Minutes {
  return s.lunch ?? Math.floor((s.workStart + s.workEnd) / 2)
}

export function toDateStr(d: Date): DateStr {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

export function minutesOf(d: Date): Minutes {
  return d.getHours() * 60 + d.getMinutes()
}
