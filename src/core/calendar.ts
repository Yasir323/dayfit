import { addDays, minutesOf, toDateStr } from './time'
import type { DateStr, Item, Minutes } from './types'

/** The fields of a Google Calendar event that Dayfit reads. */
export interface GEvent {
  id: string
  status?: string
  summary?: string
  transparency?: string
  start: { dateTime?: string; date?: string }
  end: { dateTime?: string; date?: string }
  attendees?: { self?: boolean; responseStatus?: string }[]
  extendedProperties?: { private?: Record<string, string> }
}

/** A meeting for today, clipped to the day. */
export interface Meeting {
  eventId: string
  title: string
  start: Minutes
  durationMin: number
}

/** A planned block to show on the calendar; `key` is `<itemId>#<n>`. */
export interface WriteBlock {
  key: string
  title: string
  start: Minutes
  end: Minutes
}

/** An event Dayfit wrote earlier, found again by its tag. */
export interface OwnEvent {
  eventId: string
  key: string
  title: string
  start: Minutes
  end: Minutes
}

export interface WriteDiff {
  create: WriteBlock[]
  update: { eventId: string; block: WriteBlock }[]
  remove: string[]
}

const DAY_MIN = 1440

const localDate = (date: DateStr): Date => {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(y, m - 1, d)
}

/** Local midnight of `date` to the next midnight, as ISO times. */
export function dayBounds(date: DateStr): { timeMin: string; timeMax: string } {
  return {
    timeMin: localDate(date).toISOString(),
    timeMax: localDate(addDays(date, 1)).toISOString()
  }
}

/** Local `date` at `m` minutes past midnight, as an ISO time. */
export function isoAt(date: DateStr, m: Minutes): string {
  const d = localDate(date)
  d.setMinutes(m)
  return d.toISOString()
}

/** Minutes into `date` of a moment: before the day clips to 0, after it to 1440. */
const clipTo = (iso: string, date: DateStr): Minutes => {
  const d = new Date(iso)
  const day = toDateStr(d)
  if (day < date) return 0
  if (day > date) return DAY_MIN
  return minutesOf(d)
}

/** Start and end within `date`, or null for an all-day event or one outside the day. */
const span = (e: GEvent, date: DateStr): { start: Minutes; end: Minutes } | null => {
  if (!e.start.dateTime || !e.end.dateTime) return null
  const start = clipTo(e.start.dateTime, date)
  const end = clipTo(e.end.dateTime, date)
  return end > start ? { start, end } : null
}

const isOwn = (e: GEvent): boolean => e.extendedProperties?.private?.dayfit === '1'

const declined = (e: GEvent): boolean =>
  (e.attendees ?? []).some((a) => a.self === true && a.responseStatus === 'declined')

/** Today's meetings: timed, busy, not declined, not cancelled, and not written by Dayfit. */
export function eventsToMeetings(events: GEvent[], date: DateStr): Meeting[] {
  const out: Meeting[] = []
  for (const e of events) {
    if (e.status === 'cancelled' || e.transparency === 'transparent') continue
    if (declined(e) || isOwn(e)) continue
    const s = span(e, date)
    if (!s) continue
    out.push({
      eventId: e.id,
      title: e.summary?.trim() || 'Busy',
      start: s.start,
      durationMin: s.end - s.start
    })
  }
  return out
}

/** The events Dayfit wrote on `date`, keyed by the block they show. */
export function ownEvents(events: GEvent[], date: DateStr): OwnEvent[] {
  const out: OwnEvent[] = []
  for (const e of events) {
    const key = e.extendedProperties?.private?.dayfitKey
    if (!isOwn(e) || !key || e.status === 'cancelled') continue
    const s = span(e, date)
    if (s) out.push({ eventId: e.id, key, title: e.summary ?? '', ...s })
  }
  return out
}

const sameTitle = (a: string, b: string): boolean =>
  a.trim().toLowerCase() === b.trim().toLowerCase()

/**
 * Brings today's meeting items in line with the calendar. Google owns the title and time of an
 * open linked item; done and dropped items, and other dates, are never touched.
 */
export function mergeCalendar(
  items: Item[],
  meetings: Meeting[],
  date: DateStr,
  newId: () => string,
  createdAt: number
): { items: Item[]; changed: boolean } {
  const byEvent = new Map(meetings.map((m) => [m.eventId, m]))
  const linked = new Set<string>()
  let changed = false
  const out: Item[] = []
  for (const i of items) {
    if (i.date !== date || i.calendarId === undefined) {
      out.push(i)
      continue
    }
    linked.add(i.calendarId)
    if (i.status !== 'open') {
      out.push(i)
      continue
    }
    const m = byEvent.get(i.calendarId)
    if (!m) {
      changed = true
      continue
    }
    if (i.title === m.title && i.fixedStart === m.start && i.durationMin === m.durationMin) {
      out.push(i)
      continue
    }
    changed = true
    out.push({ ...i, title: m.title, fixedStart: m.start, durationMin: m.durationMin })
  }
  for (const m of meetings) {
    if (linked.has(m.eventId)) continue
    changed = true
    const typed = out.findIndex(
      (i) =>
        i.date === date &&
        i.status === 'open' &&
        i.calendarId === undefined &&
        i.fixedStart === m.start &&
        sameTitle(i.title, m.title)
    )
    if (typed >= 0) {
      const i = out[typed]
      out[typed] = { ...i, calendarId: m.eventId, title: m.title, durationMin: m.durationMin }
      continue
    }
    out.push({
      id: newId(),
      title: m.title,
      type: 'fixed',
      durationMin: m.durationMin,
      label: null,
      priority: 'med',
      half: null,
      date,
      fixedStart: m.start,
      deadline: null,
      repeat: { kind: 'none' },
      status: 'open',
      lockedStart: null,
      suggestedSlots: [],
      dnd: true,
      createdAt,
      calendarId: m.eventId
    })
  }
  return { items: out, changed }
}

/**
 * What to change on the calendar so Dayfit's own events match the blocks. Events that have
 * already ended are left as a record.
 */
export function diffWrites(blocks: WriteBlock[], own: OwnEvent[], now: Minutes): WriteDiff {
  const byKey = new Map(own.map((o) => [o.key, o]))
  const diff: WriteDiff = { create: [], update: [], remove: [] }
  const used = new Set<string>()
  for (const b of blocks) {
    const o = byKey.get(b.key)
    if (!o) {
      diff.create.push(b)
      continue
    }
    used.add(o.eventId)
    if (o.start !== b.start || o.end !== b.end || o.title !== b.title)
      diff.update.push({ eventId: o.eventId, block: b })
  }
  for (const o of own) if (!used.has(o.eventId) && o.end > now) diff.remove.push(o.eventId)
  return diff
}
