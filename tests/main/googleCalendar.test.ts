import { describe, expect, it } from 'vitest'
import { dayBounds, isoAt } from '../../src/core/calendar'
import { createCalendarClient } from '../../src/main/googleCalendar'
import type { Fetch } from '../../src/main/googleAuth'

const D = '2026-10-24'
const EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'

const json = (status: number, body: unknown): Response =>
  new Response(status === 204 ? null : JSON.stringify(body), { status })

const recorder = (
  answer: () => Response
): { f: Fetch; calls: { url: URL; method: string; headers: Headers; body: unknown }[] } => {
  const calls: { url: URL; method: string; headers: Headers; body: unknown }[] = []
  const f = (async (url: string | URL, init?: RequestInit) => {
    calls.push({
      url: new URL(String(url)),
      method: init?.method ?? 'GET',
      headers: new Headers(init?.headers),
      body: init?.body ? JSON.parse(String(init.body)) : undefined
    })
    return answer()
  }) as Fetch
  return { f, calls }
}

const block = { key: 'i1#0', title: 'Write', start: 600, end: 660 }

describe('calendar client', () => {
  it('lists the day with the access token', async () => {
    const { f, calls } = recorder(() => json(200, { items: [{ id: 'e1' }] }))
    const c = createCalendarClient(f, async () => 'tok')
    expect(await c.listDay(D)).toEqual([{ id: 'e1' }])
    const { url, headers } = calls[0]
    expect(url.origin + url.pathname).toBe(EVENTS)
    expect(Object.fromEntries(url.searchParams)).toEqual({
      ...dayBounds(D),
      singleEvents: 'true',
      orderBy: 'startTime',
      maxResults: '250'
    })
    expect(headers.get('authorization')).toBe('Bearer tok')
  })
  it('lists nothing when Google sends no items', async () => {
    const { f } = recorder(() => json(200, {}))
    expect(await createCalendarClient(f, async () => 't').listDay(D)).toEqual([])
  })
  it('inserts a tagged busy event', async () => {
    const { f, calls } = recorder(() => json(200, { id: 'w1' }))
    await createCalendarClient(f, async () => 't').insert(D, block)
    expect(calls[0].method).toBe('POST')
    expect(calls[0].url.href).toBe(EVENTS)
    expect(calls[0].body).toEqual({
      summary: 'Write',
      description: 'Planned by Dayfit',
      start: { dateTime: isoAt(D, 600) },
      end: { dateTime: isoAt(D, 660) },
      transparency: 'opaque',
      extendedProperties: { private: { dayfit: '1', dayfitKey: 'i1#0' } }
    })
  })
  it('patches an event by id', async () => {
    const { f, calls } = recorder(() => json(200, {}))
    await createCalendarClient(f, async () => 't').patch('a/b', D, block)
    expect(calls[0].method).toBe('PATCH')
    expect(calls[0].url.href).toBe(`${EVENTS}/a%2Fb`)
    expect(calls[0].body).toEqual({
      summary: 'Write',
      start: { dateTime: isoAt(D, 600) },
      end: { dateTime: isoAt(D, 660) }
    })
  })
  it.each([204, 404, 410])('remove counts %i as done', async (status) => {
    const { f, calls } = recorder(() => json(status, {}))
    await expect(createCalendarClient(f, async () => 't').remove('w1')).resolves.toBeUndefined()
    expect(calls[0].method).toBe('DELETE')
  })
  it('throws a GoogleError with the status and Google message', async () => {
    const { f } = recorder(() => json(403, { error: { message: 'Rate Limit Exceeded' } }))
    await expect(createCalendarClient(f, async () => 't').listDay(D)).rejects.toMatchObject({
      name: 'GoogleError',
      status: 403,
      message: 'Rate Limit Exceeded'
    })
  })
  it('falls back to a plain message', async () => {
    const { f } = recorder(() => new Response('oops', { status: 500 }))
    await expect(createCalendarClient(f, async () => 't').listDay(D)).rejects.toMatchObject({
      status: 500,
      message: 'Google Calendar error 500'
    })
  })
})
