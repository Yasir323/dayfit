import { createHash, randomBytes } from 'node:crypto'
import { createServer } from 'node:http'
import type { AddressInfo } from 'node:net'

export const READ_SCOPE = 'https://www.googleapis.com/auth/calendar.events.readonly'
export const WRITE_SCOPE = 'https://www.googleapis.com/auth/calendar.events'

const AUTH_URL = 'https://accounts.google.com/o/oauth2/v2/auth'
const TOKEN_URL = 'https://oauth2.googleapis.com/token'
const REVOKE_URL = 'https://oauth2.googleapis.com/revoke'

export type Fetch = typeof fetch

/** The loopback was closed on purpose (Cancel, or a newer Connect): not an error to show. */
export const SIGN_IN_CANCELLED = 'Sign-in cancelled'

/** A failed Google call: `code` is Google's error code (or ours), `status` the HTTP status. */
export class GoogleError extends Error {
  constructor(
    message: string,
    readonly code: string,
    readonly status: number
  ) {
    super(message)
    this.name = 'GoogleError'
  }
}

export function pkcePair(): { verifier: string; challenge: string } {
  const verifier = randomBytes(48).toString('base64url')
  return { verifier, challenge: createHash('sha256').update(verifier).digest('base64url') }
}

export function authUrl(o: {
  clientId: string
  redirectUri: string
  scopes: string[]
  challenge: string
  state: string
  incremental: boolean
}): string {
  const q = new URLSearchParams({
    client_id: o.clientId,
    redirect_uri: o.redirectUri,
    response_type: 'code',
    scope: o.scopes.join(' '),
    code_challenge: o.challenge,
    code_challenge_method: 'S256',
    state: o.state,
    access_type: 'offline',
    prompt: 'consent'
  })
  if (o.incremental) q.set('include_granted_scopes', 'true')
  return `${AUTH_URL}?${q}`
}

/** A one-shot local server waiting for Google's redirect. */
export interface Loopback {
  redirectUri: string
  code: Promise<string>
  close(): void
}

const page = (text: string): string =>
  `<!doctype html><meta charset="utf-8"><title>Dayfit</title>` +
  `<body style="font:16px system-ui;margin:48px">${text}</body>`

/** Listens on 127.0.0.1 (a free port) for `GET /?code&state`; anything else is a 404. */
export function listenForCode(state: string, timeoutMs: number): Promise<Loopback> {
  let resolve!: (code: string) => void
  let reject!: (e: Error) => void
  const code = new Promise<string>((res, rej) => {
    resolve = res
    reject = rej
  })
  let done = false
  const server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://127.0.0.1')
    const q = url.searchParams
    if (done || req.method !== 'GET' || url.pathname !== '/' || !q.has('state')) {
      res.writeHead(404).end()
      return
    }
    const reply = (status: number, text: string): void => {
      res.writeHead(status, { 'content-type': 'text/html; charset=utf-8', connection: 'close' })
      res.end(page(text))
    }
    if (q.get('state') !== state) {
      reply(400, "Sign-in didn't match. Close this tab and try again from Dayfit.")
      finish(new Error("Sign-in didn't match. Try again."))
    } else if (q.has('error') || !q.get('code')) {
      reply(200, 'Sign-in was cancelled. You can close this tab.')
      finish(new Error('Google sign-in was cancelled'))
    } else {
      reply(200, 'Dayfit is connected. You can close this tab.')
      finish(q.get('code') as string)
    }
  })
  const timer = setTimeout(() => finish(new Error('Sign-in timed out')), timeoutMs)
  function finish(result: string | Error): void {
    if (done) return
    done = true
    clearTimeout(timer)
    server.close()
    server.closeIdleConnections()
    if (typeof result === 'string') resolve(result)
    else reject(result)
  }
  return new Promise((res, rej) => {
    server.once('error', rej)
    server.listen(0, '127.0.0.1', () => {
      const { port } = server.address() as AddressInfo
      res({
        redirectUri: `http://127.0.0.1:${port}`,
        code,
        close: () => finish(new Error(SIGN_IN_CANCELLED))
      })
    })
  })
}

/** POSTs a form to Google's token endpoint; a non-2xx answer becomes a GoogleError. */
async function postForm(
  f: Fetch,
  url: string,
  form: Record<string, string>
): Promise<Record<string, unknown>> {
  const res = await f(url, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString()
  })
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>
  if (!res.ok) {
    const code = typeof body.error === 'string' ? body.error : 'http_error'
    const message =
      typeof body.error_description === 'string' ? body.error_description : `Google error ${code}`
    throw new GoogleError(message, code, res.status)
  }
  return body
}

const expiry = (body: Record<string, unknown>, nowMs: number): number =>
  nowMs + (typeof body.expires_in === 'number' ? body.expires_in : 3600) * 1000

export async function exchangeCode(
  f: Fetch,
  o: {
    clientId: string
    clientSecret: string
    code: string
    verifier: string
    redirectUri: string
  },
  nowMs: number
): Promise<{ refreshToken: string; accessToken: string; expiresAt: number; scope: string }> {
  const body = await postForm(f, TOKEN_URL, {
    grant_type: 'authorization_code',
    code: o.code,
    client_id: o.clientId,
    client_secret: o.clientSecret,
    code_verifier: o.verifier,
    redirect_uri: o.redirectUri
  })
  if (typeof body.refresh_token !== 'string')
    throw new GoogleError('Google did not return a sign-in token', 'no_refresh_token', 200)
  return {
    refreshToken: body.refresh_token,
    accessToken: String(body.access_token ?? ''),
    expiresAt: expiry(body, nowMs),
    scope: typeof body.scope === 'string' ? body.scope : ''
  }
}

export async function refreshAccess(
  f: Fetch,
  o: { clientId: string; clientSecret: string; refreshToken: string },
  nowMs: number
): Promise<{ accessToken: string; expiresAt: number }> {
  const body = await postForm(f, TOKEN_URL, {
    grant_type: 'refresh_token',
    refresh_token: o.refreshToken,
    client_id: o.clientId,
    client_secret: o.clientSecret
  })
  return { accessToken: String(body.access_token ?? ''), expiresAt: expiry(body, nowMs) }
}

/** Best effort: a token that can't be revoked is still forgotten locally. */
export async function revokeToken(f: Fetch, token: string): Promise<void> {
  try {
    await f(REVOKE_URL, {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ token }).toString()
    })
  } catch {
    // Offline or already revoked: nothing more to do.
  }
}
