import { randomBytes } from 'node:crypto'
import { diffWrites, eventsToMeetings, ownEvents, type GEvent } from '../core/calendar'
import type { DateStr, Minutes } from '../core/types'
import {
  authUrl,
  exchangeCode,
  GoogleError,
  listenForCode,
  pkcePair,
  READ_SCOPE,
  refreshAccess,
  revokeToken,
  SIGN_IN_CANCELLED,
  WRITE_SCOPE,
  withTimeout,
  type Fetch,
  type Loopback
} from './googleAuth'
import { createCalendarClient, type CalendarClient } from './googleCalendar'
import type { CalendarLink, DayfitService, ViewState } from './service'
import type { TokenStore } from './tokenStore'

const SIGN_IN_TIMEOUT_MS = 5 * 60_000
/** An access token this close to expiry is refreshed first. */
const EXPIRY_MARGIN_MS = 60_000
/** Write-back waits this long after the planned blocks last changed. */
const WRITE_DEBOUNCE_MS = 30_000
const BUSY = 'Google is busy; will retry at next sync'
/** A Google call that takes longer than this is abandoned. */
const CALL_TIMEOUT_MS = 30_000

export interface CalendarDeps {
  fetch: Fetch
  tokens: TokenStore
  openExternal(url: string): void
  service: Pick<
    DayfitService,
    | 'applyCalendar'
    | 'calendarFailed'
    | 'setCalendarLink'
    | 'writeBlocks'
    | 'currentSettings'
    | 'updateSettings'
    | 'view'
  >
  today(): DateStr
  nowMin(): Minutes
  nowMs(): number
  /** Pushes a view produced in the background (sign-in started, a debounced write). */
  publish(v: ViewState): void
  listen?: typeof listenForCode
  /** Tests shorten the per-call timeout. */
  callTimeoutMs?: number
}

export interface CalendarController {
  connect(): Promise<ViewState>
  cancel(): ViewState
  disconnect(): Promise<ViewState>
  sync(): Promise<ViewState>
  setWriteBack(on: boolean): Promise<ViewState>
  /** The blocks to write changed: write them 30 s after the last change. */
  blocksChanged(): void
  /** Re-reads the token file into the view's link. */
  refreshLink(): void
}

export type CalendarAction =
  'connect' | 'cancel' | 'disconnect' | 'sync' | 'writeBackOn' | 'writeBackOff'

export function runCalendarAction(c: CalendarController, a: CalendarAction): Promise<ViewState> {
  switch (a) {
    case 'connect':
      return c.connect()
    case 'cancel':
      return Promise.resolve(c.cancel())
    case 'disconnect':
      return c.disconnect()
    case 'sync':
      return c.sync()
    case 'writeBackOn':
      return c.setWriteBack(true)
    case 'writeBackOff':
      return c.setWriteBack(false)
    default:
      return Promise.reject(new Error(`Unknown calendar action: ${String(a)}`))
  }
}

const isCancel = (e: unknown): boolean => e instanceof Error && e.message === SIGN_IN_CANCELLED

/**
 * Owns every Google call. Nothing reaches the network unless a token is stored or the user
 * clicked Connect. Failures are recorded on the view, never thrown.
 */
export function createCalendarController(d: CalendarDeps): CalendarController {
  const listen = d.listen ?? listenForCode
  const fetch = withTimeout(d.fetch, d.callTimeoutMs ?? CALL_TIMEOUT_MS)
  const svc = d.service
  let pending: Loopback | null = null
  let access: { token: string; expiresAt: number } | null = null
  let syncing: Promise<ViewState> | null = null
  let writeTimer: ReturnType<typeof setTimeout> | null = null
  /** Write passes, removals and disconnect run one after another, in call order. */
  let writes: Promise<unknown> = Promise.resolve()
  const queued = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = writes.then(fn, fn)
    writes = run.catch(() => undefined)
    return run
  }

  const creds = (): { clientId: string; clientSecret: string } => {
    const c = svc.currentSettings().calendar
    return { clientId: c.clientId.trim(), clientSecret: c.clientSecret.trim() }
  }
  const link = (): CalendarLink => {
    const t = d.tokens.read()
    return {
      connected: t !== null,
      connecting: pending !== null,
      canWrite: t !== null && t.scope.split(' ').includes(WRITE_SCOPE)
    }
  }
  const refreshLink = (): void => svc.setCalendarLink(link())
  const writeBackOn = (): boolean => svc.currentSettings().calendar.writeBack && link().canWrite

  const accessToken = async (): Promise<string> => {
    if (access && access.expiresAt - EXPIRY_MARGIN_MS > d.nowMs()) return access.token
    const t = d.tokens.read()
    if (!t) throw new GoogleError('Reconnect Google Calendar', 'invalid_grant', 401)
    const r = await refreshAccess(fetch, { ...creds(), refreshToken: t.refreshToken }, d.nowMs())
    access = { token: r.accessToken, expiresAt: r.expiresAt }
    return access.token
  }
  const client: CalendarClient = createCalendarClient(fetch, accessToken)
  /** One retry with a fresh access token when Google answers 401. */
  const withRetry = async <T>(fn: (c: CalendarClient) => Promise<T>): Promise<T> => {
    try {
      return await fn(client)
    } catch (e) {
      if (!(e instanceof GoogleError) || e.status !== 401 || e.code === 'invalid_grant') throw e
      access = null
      return fn(client)
    }
  }

  /** Records a failure on the view; a revoked sign-in forgets the token. */
  const failed = (e: unknown): ViewState => {
    if (e instanceof GoogleError && e.code === 'invalid_grant') {
      d.tokens.remove()
      access = null
      refreshLink()
      return svc.calendarFailed('Reconnect Google Calendar')
    }
    refreshLink()
    if (e instanceof TypeError) return svc.calendarFailed("Couldn't reach Google Calendar")
    if (e instanceof Error) return svc.calendarFailed(e.message)
    return svc.calendarFailed('Google Calendar sync failed')
  }

  /** Browser sign-in; resolves once the token is stored. A newer sign-in cancels this one. */
  const signIn = async (scopes: string[], incremental: boolean): Promise<void> => {
    // Checked before the browser opens: without it the token can't be kept after consent.
    if (!d.tokens.available()) throw new Error("Secure storage isn't available on this system")
    pending?.close()
    const { verifier, challenge } = pkcePair()
    const state = randomBytes(16).toString('hex')
    const lb = await listen(state, SIGN_IN_TIMEOUT_MS)
    pending = lb
    refreshLink()
    d.publish(svc.view())
    try {
      d.openExternal(
        authUrl({ ...creds(), redirectUri: lb.redirectUri, scopes, challenge, state, incremental })
      )
      const code = await lb.code
      const t = await exchangeCode(
        fetch,
        { ...creds(), code, verifier, redirectUri: lb.redirectUri },
        d.nowMs()
      )
      d.tokens.write({ refreshToken: t.refreshToken, scope: t.scope })
      access = { token: t.accessToken, expiresAt: t.expiresAt }
    } finally {
      if (pending === lb) pending = null
      refreshLink()
    }
  }

  /**
   * Makes Dayfit's own events match the planned blocks. Queued, and lists the calendar afresh,
   * so two passes never both create the same block; skipped once write-back is off.
   */
  const writePass = (): Promise<ViewState> => queued(runWritePass)
  const runWritePass = async (): Promise<ViewState> => {
    if (!writeBackOn()) return svc.view()
    const today = d.today()
    try {
      const list = await withRetry((c) => c.listDay(today))
      // The day rolled over meanwhile: the blocks are now tomorrow's; the next sync writes them.
      if (d.today() !== today) return svc.view()
      const diff = diffWrites(svc.writeBlocks(), ownEvents(list, today), d.nowMin())
      for (const b of diff.create) await withRetry((c) => c.insert(today, b))
      for (const u of diff.update) {
        const patched = await withRetry((c) => c.patch(u.eventId, today, u.block))
        if (!patched) await withRetry((c) => c.insert(today, u.block))
      }
      for (const id of diff.remove) await withRetry((c) => c.remove(id))
      return svc.view()
    } catch (e) {
      if (e instanceof GoogleError && (e.status === 403 || e.status === 429))
        return svc.calendarFailed(BUSY)
      return failed(e)
    }
  }

  /** Deletes today's own events that haven't ended (best effort); run inside the queue. */
  const removeOwn = async (): Promise<void> => {
    const today = d.today()
    try {
      const own = ownEvents(await withRetry((c) => c.listDay(today)), today)
      for (const o of own) if (o.end > d.nowMin()) await withRetry((c) => c.remove(o.eventId))
    } catch (e) {
      console.error('calendar: could not remove planned blocks', e)
    }
  }

  const runSync = async (retried = false): Promise<ViewState> => {
    refreshLink()
    if (!d.tokens.read()) return svc.view()
    const today = d.today()
    let events: GEvent[]
    try {
      events = await withRetry((c) => c.listDay(today))
    } catch (e) {
      return failed(e)
    }
    // Midnight passed while listing: those were yesterday's meetings. List the new day once.
    if (d.today() !== today && !retried) return runSync(true)
    const v = svc.applyCalendar(eventsToMeetings(events, today))
    return writeBackOn() ? writePass() : v
  }

  const sync = (): Promise<ViewState> => {
    syncing ??= runSync().finally(() => {
      syncing = null
    })
    return syncing
  }

  return {
    async connect() {
      const c = creds()
      if (!c.clientId || !c.clientSecret) return svc.view()
      try {
        await signIn([READ_SCOPE], false)
      } catch (e) {
        if (isCancel(e)) return svc.view()
        return failed(e)
      }
      return sync()
    },
    cancel() {
      pending?.close()
      pending = null
      refreshLink()
      return svc.view()
    },
    async disconnect() {
      if (writeTimer) clearTimeout(writeTimer)
      const wasOn = writeBackOn()
      // Off first: passes still queued skip, and the one running finishes before cleanup.
      svc.updateSettings({ calendar: { writeBack: false } })
      await queued(async () => {
        if (wasOn) await removeOwn()
        const t = d.tokens.read()
        if (t) await revokeToken(fetch, t.refreshToken)
        d.tokens.remove()
        access = null
      })
      refreshLink()
      return svc.view()
    },
    sync,
    async setWriteBack(on) {
      if (!on) {
        if (writeTimer) clearTimeout(writeTimer)
        const canWrite = link().canWrite
        svc.updateSettings({ calendar: { writeBack: false } })
        if (canWrite) await queued(removeOwn)
        return svc.view()
      }
      if (!link().connected) return svc.view()
      if (!link().canWrite) {
        try {
          await signIn([READ_SCOPE, WRITE_SCOPE], true)
        } catch (e) {
          if (isCancel(e)) return svc.view()
          return failed(e)
        }
        if (!link().canWrite) return svc.calendarFailed('Google did not allow adding events')
      }
      svc.updateSettings({ calendar: { writeBack: true } })
      refreshLink()
      return writePass()
    },
    blocksChanged() {
      if (!writeBackOn()) return
      if (writeTimer) clearTimeout(writeTimer)
      writeTimer = setTimeout(() => {
        writeTimer = null
        void writePass().then(d.publish, (e: unknown) => console.error('calendar write', e))
      }, WRITE_DEBOUNCE_MS)
    },
    refreshLink
  }
}
