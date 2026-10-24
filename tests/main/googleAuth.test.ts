import { createHash } from 'node:crypto'
import { describe, expect, it, vi } from 'vitest'
import {
  authUrl,
  exchangeCode,
  GoogleError,
  listenForCode,
  pkcePair,
  READ_SCOPE,
  refreshAccess,
  revokeToken,
  WRITE_SCOPE,
  type Fetch
} from '../../src/main/googleAuth'

const json = (status: number, body: unknown): Response =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

/** A fake fetch that records each call and answers with `answer`. */
const fakeFetch = (
  answer: () => Response
): { f: Fetch; calls: { url: string; init?: RequestInit }[] } => {
  const calls: { url: string; init?: RequestInit }[] = []
  const f = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init })
    return answer()
  }) as Fetch
  return { f, calls }
}

describe('pkcePair', () => {
  it('makes a verifier and its S256 challenge', () => {
    const { verifier, challenge } = pkcePair()
    expect(verifier).toMatch(/^[A-Za-z0-9\-._~]{43,128}$/)
    expect(challenge).toBe(createHash('sha256').update(verifier).digest('base64url'))
  })
})

describe('authUrl', () => {
  const base = {
    clientId: 'cid',
    redirectUri: 'http://127.0.0.1:5000',
    scopes: [READ_SCOPE],
    challenge: 'ch',
    state: 'st',
    incremental: false
  }
  it('asks for an offline code with PKCE', () => {
    const u = new URL(authUrl(base))
    expect(u.origin + u.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth')
    expect(Object.fromEntries(u.searchParams)).toEqual({
      client_id: 'cid',
      redirect_uri: 'http://127.0.0.1:5000',
      response_type: 'code',
      scope: READ_SCOPE,
      code_challenge: 'ch',
      code_challenge_method: 'S256',
      state: 'st',
      access_type: 'offline',
      prompt: 'consent'
    })
  })
  it('adds granted scopes when asking for more', () => {
    const u = new URL(authUrl({ ...base, scopes: [READ_SCOPE, WRITE_SCOPE], incremental: true }))
    expect(u.searchParams.get('scope')).toBe(`${READ_SCOPE} ${WRITE_SCOPE}`)
    expect(u.searchParams.get('include_granted_scopes')).toBe('true')
  })
})

describe('listenForCode', () => {
  it('resolves the code when the state matches', async () => {
    const lb = await listenForCode('s1', 5000)
    const res = await fetch(`${lb.redirectUri}/?code=abc&state=s1`)
    expect(res.status).toBe(200)
    expect(await res.text()).toContain('Dayfit is connected')
    await expect(lb.code).resolves.toBe('abc')
  })
  it('rejects a mismatched state', async () => {
    const lb = await listenForCode('s1', 5000)
    const caught = lb.code.catch((e: Error) => e.message)
    await fetch(`${lb.redirectUri}/?code=abc&state=bad`)
    expect(await caught).toBe("Sign-in didn't match. Try again.")
  })
  it('rejects when the user cancels at Google', async () => {
    const lb = await listenForCode('s1', 5000)
    const caught = lb.code.catch((e: Error) => e.message)
    await fetch(`${lb.redirectUri}/?error=access_denied&state=s1`)
    expect(await caught).toBe('Google sign-in was cancelled')
  })
  it('answers other requests with 404 and keeps waiting', async () => {
    const lb = await listenForCode('s1', 5000)
    const res = await fetch(`${lb.redirectUri}/favicon.ico`)
    expect(res.status).toBe(404)
    const settled = vi.fn()
    lb.code.then(settled, settled)
    await new Promise((r) => setTimeout(r, 20))
    expect(settled).not.toHaveBeenCalled()
    lb.close()
    await lb.code.catch(() => undefined)
  })
  it('times out', async () => {
    const lb = await listenForCode('s1', 50)
    await expect(lb.code).rejects.toThrow('Sign-in timed out')
  })
  it('close cancels and stops listening', async () => {
    const lb = await listenForCode('s1', 5000)
    lb.close()
    await expect(lb.code).rejects.toThrow('Sign-in cancelled')
    await expect(fetch(`${lb.redirectUri}/?code=a&state=s1`)).rejects.toThrow()
  })
})

describe('exchangeCode', () => {
  const opts = {
    clientId: 'cid',
    clientSecret: 'sec',
    code: 'abc',
    verifier: 'ver',
    redirectUri: 'http://127.0.0.1:5000'
  }
  it('posts the code with the verifier and secret', async () => {
    const { f, calls } = fakeFetch(() =>
      json(200, { refresh_token: 'r', access_token: 'a', expires_in: 3600, scope: READ_SCOPE })
    )
    const t = await exchangeCode(f, opts, 1000)
    expect(t).toEqual({
      refreshToken: 'r',
      accessToken: 'a',
      expiresAt: 3_601_000,
      scope: READ_SCOPE
    })
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/token')
    expect(calls[0].init?.method).toBe('POST')
    expect(Object.fromEntries(new URLSearchParams(String(calls[0].init?.body)))).toEqual({
      grant_type: 'authorization_code',
      code: 'abc',
      client_id: 'cid',
      client_secret: 'sec',
      code_verifier: 'ver',
      redirect_uri: 'http://127.0.0.1:5000'
    })
  })
  it('fails without a refresh token', async () => {
    const { f } = fakeFetch(() => json(200, { access_token: 'a', expires_in: 3600 }))
    await expect(exchangeCode(f, opts, 0)).rejects.toMatchObject({ code: 'no_refresh_token' })
  })
  it('turns an error answer into a GoogleError', async () => {
    const { f } = fakeFetch(() =>
      json(401, { error: 'invalid_client', error_description: 'The OAuth client was not found.' })
    )
    const e = await exchangeCode(f, opts, 0).catch((x: unknown) => x)
    expect(e).toBeInstanceOf(GoogleError)
    expect(e).toMatchObject({
      code: 'invalid_client',
      status: 401,
      message: 'The OAuth client was not found.'
    })
  })
})

describe('refreshAccess', () => {
  const opts = { clientId: 'cid', clientSecret: 'sec', refreshToken: 'r' }
  it('gets a new access token', async () => {
    const { f, calls } = fakeFetch(() => json(200, { access_token: 'a2', expires_in: 100 }))
    expect(await refreshAccess(f, opts, 5000)).toEqual({ accessToken: 'a2', expiresAt: 105_000 })
    expect(new URLSearchParams(String(calls[0].init?.body)).get('grant_type')).toBe('refresh_token')
  })
  it('reports invalid_grant', async () => {
    const { f } = fakeFetch(() => json(400, { error: 'invalid_grant' }))
    await expect(refreshAccess(f, opts, 0)).rejects.toMatchObject({ code: 'invalid_grant' })
  })
})

describe('revokeToken', () => {
  it('posts to the revoke endpoint', async () => {
    const { f, calls } = fakeFetch(() => json(200, {}))
    await revokeToken(f, 'r')
    expect(calls[0].url).toBe('https://oauth2.googleapis.com/revoke')
    expect(String(calls[0].init?.body)).toBe('token=r')
  })
  it('swallows failures', async () => {
    const f = (async () => {
      throw new TypeError('offline')
    }) as unknown as Fetch
    await expect(revokeToken(f, 'r')).resolves.toBeUndefined()
  })
})
