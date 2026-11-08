import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { minutesOf, toDateStr } from '../../src/core/time'
import type { GEvent } from '../../src/core/calendar'
import {
  createCalendarController,
  runCalendarAction,
  type CalendarController,
  type CalendarDeps
} from '../../src/main/calendarSync'
import { READ_SCOPE, WRITE_SCOPE, type Fetch, type Loopback } from '../../src/main/googleAuth'
import { DayfitService, type Clock } from '../../src/main/service'
import type { StoredToken, TokenStore } from '../../src/main/tokenStore'
import { removeDir } from './tempDir'

const EVENTS = 'https://www.googleapis.com/calendar/v3/calendars/primary/events'
const TOKEN = 'https://oauth2.googleapis.com/token'
const REVOKE = 'https://oauth2.googleapis.com/revoke'

class FakeClock implements Clock {
  t = new Date(2026, 9, 26, 8, 0)
  now(): Date {
    return new Date(this.t.getTime())
  }
}

const at = (h: number, m = 0): string => new Date(2026, 9, 26, h, m).toISOString()
const meeting = (id: string, h: number, title = 'Standup'): GEvent => ({
  id,
  summary: title,
  start: { dateTime: at(h) },
  end: { dateTime: at(h, 30) }
})
const own = (id: string, key: string, h: number, h2: number, title = 'Old'): GEvent => ({
  id,
  summary: title,
  start: { dateTime: at(h) },
  end: { dateTime: at(h2) },
  extendedProperties: { private: { dayfit: '1', dayfitKey: key } }
})

interface Call {
  method: string
  url: URL
  body: string
}

/** Google, faked: routes by URL and method; `events` is the calendar's content. */
class FakeGoogle {
  calls: Call[] = []
  events: GEvent[] = []
  listStatus: number[] = [] // statuses to answer list calls with before succeeding
  refreshError: string | null = null
  writeStatus = 200
  patchStatus = 200
  offline = false
  hang = false
  /** Runs before a list call is answered. */
  onList: (() => void) | null = null
  fetch: Fetch = (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input))
    const method = init?.method ?? 'GET'
    const body = init?.body ? String(init.body) : ''
    this.calls.push({ method, url, body })
    if (this.offline) throw new TypeError('fetch failed')
    if (this.hang)
      return new Promise<Response>((_res, rej) => {
        init?.signal?.addEventListener('abort', () => rej(init.signal?.reason))
      })
    const json = (status: number, b: unknown): Response =>
      new Response(JSON.stringify(b), { status })
    const base = url.origin + url.pathname
    if (base === TOKEN) {
      const grant = new URLSearchParams(body).get('grant_type')
      if (grant === 'refresh_token' && this.refreshError)
        return json(400, { error: this.refreshError })
      const scope = new URLSearchParams(body).get('code') === 'wcode' ? 'w' : 'r'
      return json(200, {
        access_token: `acc${this.calls.length}`,
        expires_in: 3600,
        refresh_token: grant === 'authorization_code' ? 'ref' : undefined,
        scope: scope === 'w' ? `${READ_SCOPE} ${WRITE_SCOPE}` : READ_SCOPE
      })
    }
    if (base === REVOKE) return json(200, {})
    if (base === EVENTS && method === 'GET') {
      this.onList?.()
      const status = this.listStatus.shift()
      if (status) return json(status, { error: { message: `list ${status}` } })
      return json(200, { items: this.events })
    }
    if (method !== 'GET' && this.writeStatus !== 200)
      return json(this.writeStatus, { error: { message: 'Rate Limit Exceeded' } })
    if (base === EVENTS && method === 'POST') {
      const id = `new${this.calls.length}`
      this.events.push({ ...(JSON.parse(body) as Omit<GEvent, 'id'>), id })
      return json(200, { id })
    }
    if (base.startsWith(EVENTS + '/')) {
      if (method === 'PATCH' && this.patchStatus !== 200)
        return json(this.patchStatus, { error: { message: 'Not Found' } })
      if (method === 'DELETE') {
        const id = decodeURIComponent(url.pathname.split('/').pop() ?? '')
        this.events = this.events.filter((e) => e.id !== id)
      }
      return json(200, {})
    }
    return json(404, {})
  }) as Fetch
  count(method: string, base: string): number {
    return this.calls.filter((c) => c.method === method && c.url.origin + c.url.pathname === base)
      .length
  }
  writes(): Call[] {
    return this.calls.filter((c) => c.method !== 'GET' && c.url.href.startsWith(EVENTS))
  }
}

const memoryTokens = (start: StoredToken | null = null): TokenStore & { t: StoredToken | null } => {
  const s = {
    t: start,
    available: () => true,
    read: () => s.t,
    write: (t: StoredToken) => {
      s.t = t
    },
    remove: () => {
      s.t = null
    }
  }
  return s
}

/** A loopback that answers with `code` (or fails) as soon as the browser is "opened". */
const fakeListen = (
  codes: (string | Error | 'hang')[]
): { listen: CalendarDeps['listen']; closed: number[] } => {
  const closed: number[] = []
  let n = 0
  const listen = async (): Promise<Loopback> => {
    const i = n++
    const next = codes[i] ?? 'hang'
    let reject!: (e: Error) => void
    const code = new Promise<string>((res, rej) => {
      reject = rej
      if (next instanceof Error) setTimeout(() => rej(next), 0)
      else if (next !== 'hang') setTimeout(() => res(next), 0)
    })
    code.catch(() => undefined)
    return {
      redirectUri: 'http://127.0.0.1:1',
      code,
      close: () => {
        closed.push(i)
        reject(new Error('Sign-in cancelled'))
      }
    }
  }
  return { listen, closed }
}

let dir: string
let clock: FakeClock
let svc: DayfitService
let google: FakeGoogle
let opened: string[]
let published: number

const make = (
  tokens: TokenStore,
  listen: CalendarDeps['listen'] = fakeListen([]).listen,
  callTimeoutMs?: number
): CalendarController =>
  createCalendarController({
    fetch: google.fetch,
    tokens,
    openExternal: (u) => opened.push(u),
    service: svc,
    today: () => toDateStr(clock.now()),
    nowMin: () => minutesOf(clock.now()),
    nowMs: () => clock.now().getTime(),
    publish: () => {
      published++
    },
    listen,
    callTimeoutMs
  })

const withCreds = (): void => {
  svc.updateSettings({ calendar: { clientId: 'cid', clientSecret: 'sec' } })
}

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfit-cal-'))
  clock = new FakeClock()
  let n = 0
  svc = new DayfitService(path.join(dir, 'dayfit.json'), clock, () => `id${++n}`)
  google = new FakeGoogle()
  opened = []
  published = 0
})
afterEach(() => {
  vi.useRealTimers()
  removeDir(dir)
})

describe('calendar controller: not connected', () => {
  it('sync makes no network call', async () => {
    const c = make(memoryTokens())
    await c.sync()
    expect(google.calls).toEqual([])
  })
  it('connect without credentials does nothing', async () => {
    const c = make(memoryTokens())
    await c.connect()
    expect(google.calls).toEqual([])
    expect(opened).toEqual([])
  })
})

describe('calendar controller: connect', () => {
  it('signs in read-only, stores the token and imports meetings', async () => {
    withCreds()
    google.events = [meeting('e1', 10)]
    const tokens = memoryTokens()
    const c = make(tokens, fakeListen(['rcode']).listen)
    const v = await c.connect()
    const url = new URL(opened[0])
    expect(url.searchParams.get('scope')).toBe(READ_SCOPE)
    expect(url.searchParams.get('include_granted_scopes')).toBeNull()
    expect(tokens.t).toEqual({ refreshToken: 'ref', scope: READ_SCOPE })
    expect(v.items.find((i) => i.calendarId === 'e1')?.fixedStart).toBe(600)
    expect(v.calendar).toMatchObject({ connected: true, connecting: false, canWrite: false })
    expect(v.calendar.lastError).toBeNull()
  })
  it('a second connect cancels the first quietly', async () => {
    withCreds()
    const { listen, closed } = fakeListen(['hang', 'rcode'])
    const c = make(memoryTokens(), listen)
    const first = c.connect()
    await new Promise((r) => setTimeout(r, 5))
    const second = await c.connect()
    const v1 = await first
    expect(closed).toEqual([0])
    expect(google.count('POST', TOKEN)).toBe(1)
    expect(v1.calendar.lastError).toBeNull()
    expect(second.calendar.connected).toBe(true)
  })
  it('cancel stops a pending sign-in without an error', async () => {
    withCreds()
    const c = make(memoryTokens(), fakeListen(['hang']).listen)
    const pending = c.connect()
    await new Promise((r) => setTimeout(r, 5))
    expect(svc.view().calendar.connecting).toBe(true)
    c.cancel()
    const v = await pending
    expect(v.calendar).toMatchObject({ connected: false, connecting: false, lastError: null })
  })
  it('shows a failed sign-in', async () => {
    withCreds()
    const c = make(memoryTokens(), fakeListen([new Error('Sign-in timed out')]).listen)
    const v = await c.connect()
    expect(v.calendar.lastError).toBe('Sign-in timed out')
    expect(v.calendar.connected).toBe(false)
  })
})

describe('calendar controller: sync', () => {
  const connected = (): TokenStore & { t: StoredToken | null } =>
    memoryTokens({ refreshToken: 'ref', scope: READ_SCOPE })

  it('refreshes once on a 401 and retries', async () => {
    withCreds()
    google.events = [meeting('e1', 10)]
    google.listStatus = [401]
    const c = make(connected())
    const v = await c.sync()
    expect(v.items.some((i) => i.calendarId === 'e1')).toBe(true)
    expect(google.count('POST', TOKEN)).toBe(2)
    expect(google.count('GET', EVENTS)).toBe(2)
  })
  it('stops after a second 401', async () => {
    withCreds()
    google.listStatus = [401, 401, 401]
    const v = await make(connected()).sync()
    expect(v.calendar.lastError).toBe('list 401')
    expect(google.count('GET', EVENTS)).toBe(2)
  })
  it('forgets a revoked sign-in', async () => {
    withCreds()
    google.refreshError = 'invalid_grant'
    const tokens = connected()
    const v = await make(tokens).sync()
    expect(tokens.t).toBeNull()
    expect(v.calendar.connected).toBe(false)
    expect(v.calendar.lastError).toBe('Reconnect Google Calendar')
  })
  it('keeps the meetings it has when offline', async () => {
    withCreds()
    google.events = [meeting('e1', 10)]
    const c = make(connected())
    await c.sync()
    google.offline = true
    const v = await c.sync()
    expect(v.items.some((i) => i.calendarId === 'e1')).toBe(true)
    expect(v.calendar.lastError).toBe("Couldn't reach Google Calendar")
  })
  it('reuses the access token until it is about to expire', async () => {
    withCreds()
    const c = make(connected())
    await c.sync()
    await c.sync()
    expect(google.count('POST', TOKEN)).toBe(1)
    clock.t = new Date(clock.t.getTime() + 3550_000)
    await c.sync()
    expect(google.count('POST', TOKEN)).toBe(2)
  })
  it('runs one sync at a time', async () => {
    withCreds()
    const c = make(connected())
    await Promise.all([c.sync(), c.sync()])
    expect(google.count('GET', EVENTS)).toBe(1)
  })
})

describe('calendar controller: write-back', () => {
  const plan = (): void => {
    svc.addItems([
      {
        title: 'Email',
        type: 'task',
        durationMin: 30,
        label: null,
        priority: 'med',
        half: null,
        date: '2026-10-26',
        fixedStart: null,
        deadline: null,
        repeat: { kind: 'none' },
        dnd: false
      }
    ])
  }

  it('asks for write access, then writes the planned blocks', async () => {
    withCreds()
    plan()
    const tokens = memoryTokens({ refreshToken: 'ref', scope: READ_SCOPE })
    const c = make(tokens, fakeListen(['wcode']).listen)
    const v = await c.setWriteBack(true)
    const url = new URL(opened[0])
    expect(url.searchParams.get('scope')).toBe(`${READ_SCOPE} ${WRITE_SCOPE}`)
    expect(url.searchParams.get('include_granted_scopes')).toBe('true')
    expect(v.settings.calendar.writeBack).toBe(true)
    expect(v.calendar.canWrite).toBe(true)
    const posts = google.writes().filter((w) => w.method === 'POST')
    expect(posts).toHaveLength(svc.writeBlocks().length)
    expect(JSON.parse(posts[0].body).summary).toBe('Email')
  })
  it('stays off when write access is refused', async () => {
    withCreds()
    const tokens = memoryTokens({ refreshToken: 'ref', scope: READ_SCOPE })
    const c = make(tokens, fakeListen([new Error('Google sign-in was cancelled')]).listen)
    const v = await c.setWriteBack(true)
    expect(v.settings.calendar.writeBack).toBe(false)
    expect(google.writes()).toEqual([])
  })
  it('moves, removes and never touches other events', async () => {
    withCreds()
    plan()
    const [b] = svc.writeBlocks()
    google.events = [
      meeting('e1', 15, 'Not ours'),
      own('w1', b.key, 16, 17, 'Email'),
      own('w2', 'gone#0', 18, 19)
    ]
    svc.updateSettings({ calendar: { writeBack: true } })
    const c = make(memoryTokens({ refreshToken: 'ref', scope: `${READ_SCOPE} ${WRITE_SCOPE}` }))
    await c.sync()
    const writes = google.writes().map((w) => `${w.method} ${w.url.pathname.split('/').pop()}`)
    expect(writes.sort()).toEqual(['DELETE w2', 'PATCH w1'])
  })
  it('pauses writing when Google is busy', async () => {
    withCreds()
    plan()
    google.writeStatus = 429
    svc.updateSettings({ calendar: { writeBack: true } })
    const c = make(memoryTokens({ refreshToken: 'ref', scope: `${READ_SCOPE} ${WRITE_SCOPE}` }))
    const v = await c.sync()
    expect(v.calendar.lastError).toBe('Google is busy; will retry at next sync')
    expect(google.writes()).toHaveLength(1)
  })
  it('turning it off deletes future own events only', async () => {
    withCreds()
    clock.t = new Date(2026, 9, 26, 12, 0)
    google.events = [own('past', 'a#0', 9, 10), own('future', 'b#0', 14, 15), meeting('e1', 15)]
    svc.updateSettings({ calendar: { writeBack: true } })
    const c = make(memoryTokens({ refreshToken: 'ref', scope: `${READ_SCOPE} ${WRITE_SCOPE}` }))
    const v = await c.setWriteBack(false)
    expect(v.settings.calendar.writeBack).toBe(false)
    expect(google.writes().map((w) => `${w.method} ${w.url.pathname.split('/').pop()}`)).toEqual([
      'DELETE future'
    ])
  })
  it('a change in blocks writes once, 30 s after the last change', async () => {
    withCreds()
    plan()
    svc.updateSettings({ calendar: { writeBack: true } })
    const c = make(memoryTokens({ refreshToken: 'ref', scope: `${READ_SCOPE} ${WRITE_SCOPE}` }))
    c.refreshLink()
    vi.useFakeTimers()
    c.blocksChanged()
    await vi.advanceTimersByTimeAsync(20_000)
    c.blocksChanged()
    await vi.advanceTimersByTimeAsync(20_000)
    expect(google.calls).toEqual([])
    await vi.advanceTimersByTimeAsync(10_000)
    expect(google.count('GET', EVENTS)).toBe(1)
    expect(google.writes().length).toBeGreaterThan(0)
    expect(published).toBeGreaterThan(0)
  })
  it('does nothing on a block change while write-back is off', async () => {
    withCreds()
    const c = make(memoryTokens({ refreshToken: 'ref', scope: `${READ_SCOPE} ${WRITE_SCOPE}` }))
    vi.useFakeTimers()
    c.blocksChanged()
    await vi.advanceTimersByTimeAsync(60_000)
    expect(google.calls).toEqual([])
  })
})

describe('calendar controller: one write at a time', () => {
  const both = `${READ_SCOPE} ${WRITE_SCOPE}`
  const plan = (): void => {
    svc.addItems([
      {
        title: 'Email',
        type: 'task',
        durationMin: 30,
        label: null,
        priority: 'med',
        half: null,
        date: '2026-10-26',
        fixedStart: null,
        deadline: null,
        repeat: { kind: 'none' },
        dnd: false
      }
    ])
  }

  it('two passes at once write each block once', async () => {
    withCreds()
    plan()
    svc.updateSettings({ calendar: { writeBack: true } })
    const c = make(memoryTokens({ refreshToken: 'ref', scope: both }))
    await Promise.all([c.sync(), c.setWriteBack(true)])
    expect(google.writes().filter((w) => w.method === 'POST')).toHaveLength(1)
  })
  it('disconnect waits for a running pass, then cleans up without an error', async () => {
    withCreds()
    plan()
    svc.updateSettings({ calendar: { writeBack: true } })
    const c = make(memoryTokens({ refreshToken: 'ref', scope: both }))
    const pass = c.sync()
    const v = await c.disconnect()
    await pass
    const revokeAt = google.calls.findIndex((x) => x.url.href.startsWith(REVOKE))
    const lastWrite = google.calls.findLastIndex(
      (x) => x.method === 'POST' && x.url.href.startsWith(EVENTS)
    )
    expect(lastWrite).toBeLessThan(revokeAt)
    const left = google.events.filter((e) => e.extendedProperties?.private?.dayfit === '1')
    expect(left).toEqual([])
    expect(svc.view().calendar.lastError).toBeNull()
    expect(v.calendar.connected).toBe(false)
  })
})

describe('calendar controller: disconnect', () => {
  it('removes own future events, revokes and forgets the token', async () => {
    withCreds()
    google.events = [own('future', 'b#0', 14, 15), meeting('e1', 15)]
    svc.updateSettings({ calendar: { writeBack: true } })
    const tokens = memoryTokens({ refreshToken: 'ref', scope: `${READ_SCOPE} ${WRITE_SCOPE}` })
    const v = await make(tokens).disconnect()
    expect(google.writes().map((w) => w.method)).toEqual(['DELETE'])
    expect(google.count('POST', REVOKE)).toBe(1)
    expect(tokens.t).toBeNull()
    expect(v.settings.calendar.writeBack).toBe(false)
    expect(v.calendar.connected).toBe(false)
  })
})

describe('calendar controller: edge cases', () => {
  const writeScope = (): TokenStore =>
    memoryTokens({ refreshToken: 'ref', scope: `${READ_SCOPE} ${WRITE_SCOPE}` })

  it('a sync that runs across midnight lists the new day before applying', async () => {
    withCreds()
    clock.t = new Date(2026, 9, 26, 23, 59, 59)
    google.onList = () => {
      clock.t = new Date(2026, 9, 27, 0, 0, 5)
      google.onList = null
    }
    const c = make(memoryTokens({ refreshToken: 'ref', scope: READ_SCOPE }))
    await c.sync()
    const lists = google.calls.filter((x) => x.method === 'GET' && x.url.href.startsWith(EVENTS))
    expect(lists).toHaveLength(2)
    expect(new Date(lists[1].url.searchParams.get('timeMin') ?? '').getDate()).toBe(27)
  })
  it('checks secure storage before opening the browser', async () => {
    withCreds()
    const tokens = { ...memoryTokens(), available: () => false }
    const v = await make(tokens, fakeListen(['code']).listen).connect()
    expect(opened).toEqual([])
    expect(v.calendar.lastError).toBe("Secure storage isn't available on this system")
  })
  it('recreates a block whose event was deleted in Google', async () => {
    withCreds()
    svc.addItems([
      {
        title: 'Email',
        type: 'task',
        durationMin: 30,
        label: null,
        priority: 'med',
        half: null,
        date: '2026-10-26',
        fixedStart: null,
        deadline: null,
        repeat: { kind: 'none' },
        dnd: false
      }
    ])
    const [b] = svc.writeBlocks()
    google.events = [own('w1', b.key, 16, 17, 'Email')]
    google.patchStatus = 404
    svc.updateSettings({ calendar: { writeBack: true } })
    const v = await make(writeScope()).sync()
    const writes = google.writes().map((w) => `${w.method} ${w.url.pathname.split('/').pop()}`)
    expect(writes).toEqual(['PATCH w1', 'POST events'])
    expect(v.calendar.lastError).toBeNull()
  })
  it('gives up on a Google call that does not answer', async () => {
    withCreds()
    google.hang = true
    const c = make(memoryTokens({ refreshToken: 'ref', scope: READ_SCOPE }), undefined, 20)
    const v = await c.sync()
    expect(v.calendar.lastError).toBe("Google Calendar didn't answer")
  })
})

describe('runCalendarAction', () => {
  it('maps each action to the controller', async () => {
    const view = svc.view()
    const c = {
      connect: vi.fn(async () => view),
      cancel: vi.fn(() => view),
      disconnect: vi.fn(async () => view),
      sync: vi.fn(async () => view),
      setWriteBack: vi.fn(async () => view),
      blocksChanged: vi.fn(),
      refreshLink: vi.fn()
    }
    for (const a of ['connect', 'cancel', 'disconnect', 'sync'] as const) {
      await runCalendarAction(c, a)
      expect(c[a]).toHaveBeenCalledTimes(1)
    }
    await runCalendarAction(c, 'writeBackOn')
    await runCalendarAction(c, 'writeBackOff')
    expect(c.setWriteBack.mock.calls).toEqual([[true], [false]])
    await expect(runCalendarAction(c, 'bogus' as never)).rejects.toThrow('Unknown calendar action')
  })
})
