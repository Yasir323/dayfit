import { dayBounds, isoAt, type GEvent, type WriteBlock } from '../core/calendar'
import type { DateStr } from '../core/types'
import { GoogleError, type Fetch } from './googleAuth'

const EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

/** The primary calendar, as much of it as Dayfit uses. */
export interface CalendarClient {
  listDay(date: DateStr): Promise<GEvent[]>
  insert(date: DateStr, b: WriteBlock): Promise<void>
  /** False when the event is gone (deleted in Google). */
  patch(eventId: string, date: DateStr, b: WriteBlock): Promise<boolean>
  /** Deleting an event that is already gone counts as done. */
  remove(eventId: string): Promise<void>
}

const times = (date: DateStr, b: WriteBlock): Record<string, unknown> => ({
  summary: b.title,
  start: { dateTime: isoAt(date, b.start) },
  end: { dateTime: isoAt(date, b.end) }
})

export function createCalendarClient(f: Fetch, accessToken: () => Promise<string>): CalendarClient {
  const call = async (
    url: string,
    method = 'GET',
    body?: unknown,
    okStatus: number[] = []
  ): Promise<Record<string, unknown>> => {
    const headers: Record<string, string> = { authorization: `Bearer ${await accessToken()}` }
    if (body !== undefined) headers['content-type'] = 'application/json'
    const res = await f(url, {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body)
    })
    if (okStatus.includes(res.status)) return { gone: true }
    const text = await res.text()
    let parsed: Record<string, unknown> = {}
    try {
      parsed = text ? (JSON.parse(text) as Record<string, unknown>) : {}
    } catch {
      // Not JSON: fall back to the status below.
    }
    if (!res.ok) {
      const err = parsed.error as { message?: unknown; status?: unknown } | undefined
      const message =
        typeof err?.message === 'string' ? err.message : `Google Calendar error ${res.status}`
      const code = typeof err?.status === 'string' ? err.status : String(res.status)
      throw new GoogleError(message, code, res.status)
    }
    return parsed
  }
  const one = (id: string): string => `${EVENTS}/${encodeURIComponent(id)}`
  return {
    async listDay(date) {
      const q = new URLSearchParams({
        ...dayBounds(date),
        singleEvents: 'true',
        orderBy: 'startTime',
        maxResults: '250'
      })
      const body = await call(`${EVENTS}?${q}`)
      return Array.isArray(body.items) ? (body.items as GEvent[]) : []
    },
    async insert(date, b) {
      await call(EVENTS, 'POST', {
        ...times(date, b),
        description: 'Planned by Dayfit',
        transparency: 'opaque',
        extendedProperties: { private: { dayfit: '1', dayfitKey: b.key } }
      })
    },
    async patch(eventId, date, b) {
      const body = await call(one(eventId), 'PATCH', times(date, b), [404, 410])
      return body.gone !== true
    },
    async remove(eventId) {
      await call(one(eventId), 'DELETE', undefined, [404, 410])
    }
  }
}
