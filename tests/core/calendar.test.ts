import { describe, expect, it } from 'vitest'
import {
  dayBounds,
  diffWrites,
  eventsToMeetings,
  isoAt,
  mergeCalendar,
  ownEvents,
  type GEvent,
  type Meeting
} from '../../src/core/calendar'
import type { Item } from '../../src/core/types'

const D = '2026-10-24'
const at = (day: number, h: number, m = 0): string => new Date(2026, 9, day, h, m).toISOString()
const ev = (p: Partial<GEvent> = {}): GEvent => ({
  id: 'e1',
  summary: 'Standup',
  start: { dateTime: at(24, 10) },
  end: { dateTime: at(24, 10, 30) },
  ...p
})

const item = (p: Partial<Item> = {}): Item => ({
  id: 'i1',
  title: 'Standup',
  type: 'fixed',
  durationMin: 30,
  label: null,
  priority: 'med',
  half: null,
  date: D,
  fixedStart: 600,
  deadline: null,
  repeat: { kind: 'none' },
  status: 'open',
  lockedStart: null,
  suggestedSlots: [],
  dnd: true,
  createdAt: 1,
  ...p
})

const standup: Meeting = { eventId: 'e1', title: 'Standup', start: 600, durationMin: 30 }

describe('dayBounds and isoAt', () => {
  it('spans local midnight to the next midnight', () => {
    expect(dayBounds(D)).toEqual({ timeMin: at(24, 0), timeMax: at(25, 0) })
  })
  it('turns a date and minutes into an ISO time', () => {
    expect(isoAt(D, 630)).toBe(at(24, 10, 30))
  })
})

describe('eventsToMeetings', () => {
  it('maps a timed event to a meeting', () => {
    expect(eventsToMeetings([ev()], D)).toEqual([standup])
  })
  it.each<[string, Partial<GEvent>]>([
    ['cancelled', { status: 'cancelled' }],
    ['all-day', { start: { date: D }, end: { date: '2026-10-25' } }],
    ['free', { transparency: 'transparent' }],
    ['declined', { attendees: [{ self: true, responseStatus: 'declined' }] }],
    ['own', { extendedProperties: { private: { dayfit: '1', dayfitKey: 'x#0' } } }]
  ])('skips %s events', (_name, p) => {
    expect(eventsToMeetings([ev(p)], D)).toEqual([])
  })
  it('keeps events someone else declined', () => {
    const attendees = [{ self: true, responseStatus: 'accepted' }, { responseStatus: 'declined' }]
    expect(eventsToMeetings([ev({ attendees })], D)).toHaveLength(1)
  })
  it('names an untitled event Busy', () => {
    expect(eventsToMeetings([ev({ summary: undefined })], D)[0].title).toBe('Busy')
  })
  it('clips an event that runs past midnight', () => {
    const e = ev({ start: { dateTime: at(24, 23, 30) }, end: { dateTime: at(25, 1) } })
    expect(eventsToMeetings([e], D)[0]).toMatchObject({ start: 1410, durationMin: 30 })
  })
  it('clips an event that started yesterday', () => {
    const e = ev({ start: { dateTime: at(23, 23) }, end: { dateTime: at(24, 0, 30) } })
    expect(eventsToMeetings([e], D)[0]).toMatchObject({ start: 0, durationMin: 30 })
  })
  it('skips an event on another day', () => {
    const e = ev({ start: { dateTime: at(25, 10) }, end: { dateTime: at(25, 11) } })
    expect(eventsToMeetings([e], D)).toEqual([])
  })
})

describe('ownEvents', () => {
  it('returns only events Dayfit wrote, keyed by dayfitKey', () => {
    const mine = ev({
      id: 'w1',
      start: { dateTime: at(24, 11) },
      end: { dateTime: at(24, 12) },
      extendedProperties: { private: { dayfit: '1', dayfitKey: 'i9#0' } }
    })
    expect(ownEvents([ev(), mine], D)).toEqual([
      { eventId: 'w1', key: 'i9#0', title: 'Standup', start: 660, end: 720 }
    ])
  })
})

describe('mergeCalendar', () => {
  const newId = (): string => 'new1'

  it('adds a new meeting as a fixed item', () => {
    const r = mergeCalendar([], [standup], D, newId, 5)
    expect(r.changed).toBe(true)
    expect(r.items).toEqual([item({ id: 'new1', calendarId: 'e1', createdAt: 5 })])
  })
  it('changes nothing when merged again', () => {
    const first = mergeCalendar([], [standup], D, newId, 5).items
    const r = mergeCalendar(first, [standup], D, newId, 6)
    expect(r.changed).toBe(false)
    expect(r.items).toEqual(first)
  })
  it('moves a meeting that moved', () => {
    const r = mergeCalendar(
      [item({ calendarId: 'e1' })],
      [{ ...standup, start: 660, durationMin: 45 }],
      D,
      newId,
      5
    )
    expect(r.changed).toBe(true)
    expect(r.items).toEqual([item({ calendarId: 'e1', fixedStart: 660, durationMin: 45 })])
  })
  it('removes an open meeting that is gone', () => {
    const r = mergeCalendar([item({ calendarId: 'e1' })], [], D, newId, 5)
    expect(r).toEqual({ items: [], changed: true })
  })
  it('never touches done or dropped meetings', () => {
    const done = item({ id: 'a', calendarId: 'e1', status: 'done', title: 'Old' })
    const dropped = item({ id: 'b', calendarId: 'e2', status: 'dropped' })
    const r = mergeCalendar([done, dropped], [standup], D, newId, 5)
    expect(r.items).toEqual([done, dropped])
    expect(r.changed).toBe(false)
  })
  it('leaves items on other dates alone', () => {
    const other = item({ calendarId: 'e1', date: '2026-10-23' })
    const r = mergeCalendar([other], [], D, newId, 5)
    expect(r).toEqual({ items: [other], changed: false })
  })
  it('adopts a hand-typed meeting with the same start and title', () => {
    const typed = item({ id: 'typed', title: ' standup ' })
    const r = mergeCalendar([typed], [standup], D, newId, 5)
    expect(r.items).toEqual([item({ id: 'typed', calendarId: 'e1' })])
  })
  it('restores the title of an adopted meeting the user edited', () => {
    const adopted = mergeCalendar([item({ id: 'typed' })], [standup], D, newId, 5).items
    const edited = adopted.map((i) => ({ ...i, title: 'X' }))
    const r = mergeCalendar(edited, [standup], D, newId, 6)
    expect(r.items).toEqual([item({ id: 'typed', calendarId: 'e1' })])
  })
})

describe('diffWrites', () => {
  const block = { key: 'a#0', title: 'Write', start: 720, end: 780 }

  it('creates a block with no event', () => {
    expect(diffWrites([block], [], 700)).toEqual({ create: [block], update: [], remove: [] })
  })
  it('updates an event whose block moved', () => {
    const own = [{ eventId: 'w1', key: 'a#0', title: 'Write', start: 750, end: 810 }]
    expect(diffWrites([block], own, 700)).toEqual({
      create: [],
      update: [{ eventId: 'w1', block }],
      remove: []
    })
  })
  it('leaves an event that already matches', () => {
    const own = [{ eventId: 'w1', key: 'a#0', title: 'Write', start: 720, end: 780 }]
    expect(diffWrites([block], own, 700)).toEqual({ create: [], update: [], remove: [] })
  })
  it('updates an event whose block was renamed', () => {
    const own = [{ eventId: 'w1', key: 'a#0', title: 'Draft', start: 720, end: 780 }]
    expect(diffWrites([block], own, 700).update).toEqual([{ eventId: 'w1', block }])
  })
  it('removes a future event with no block', () => {
    const own = [{ eventId: 'w1', key: 'b#0', title: 'Old', start: 690, end: 720 }]
    expect(diffWrites([], own, 700).remove).toEqual(['w1'])
  })
  it('keeps an event that has already ended', () => {
    const own = [{ eventId: 'w1', key: 'b#0', title: 'Old', start: 600, end: 700 }]
    expect(diffWrites([], own, 700).remove).toEqual([])
  })
})
