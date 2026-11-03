import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createTokenStore, type Crypto } from '../../src/main/tokenStore'

const fakeCrypto = (available = true): Crypto => ({
  isEncryptionAvailable: () => available,
  encryptString: (s) => Buffer.from('enc:' + Buffer.from(s).toString('base64')),
  decryptString: (b) => {
    const s = b.toString()
    if (!s.startsWith('enc:')) throw new Error('bad')
    return Buffer.from(s.slice(4), 'base64').toString()
  }
})

let dir: string
let file: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfit-token-'))
  file = path.join(dir, 'google-token.bin')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

const token = { refreshToken: 'r1', scope: 'a b' }

describe('token store', () => {
  it('round trips the token, encrypted on disk', () => {
    const store = createTokenStore(file, fakeCrypto())
    store.write(token)
    expect(store.read()).toEqual(token)
    expect(fs.readFileSync(file, 'utf8')).not.toContain('refreshToken')
  })
  it('reads null with no file', () => {
    expect(createTokenStore(file, fakeCrypto()).read()).toBeNull()
  })
  it('reads null when the file does not decrypt', () => {
    fs.writeFileSync(file, 'garbage')
    expect(createTokenStore(file, fakeCrypto()).read()).toBeNull()
  })
  it('reads null when the token has no refresh token', () => {
    const c = fakeCrypto()
    fs.writeFileSync(file, c.encryptString(JSON.stringify({ scope: 'a' })))
    expect(createTokenStore(file, c).read()).toBeNull()
  })
  it('reads null when secure storage is unavailable', () => {
    createTokenStore(file, fakeCrypto()).write(token)
    const store = createTokenStore(file, fakeCrypto(false))
    expect(store.available()).toBe(false)
    expect(store.read()).toBeNull()
  })
  it('refuses to write without secure storage', () => {
    expect(() => createTokenStore(file, fakeCrypto(false)).write(token)).toThrow(
      "Secure storage isn't available on this system"
    )
    expect(fs.existsSync(file)).toBe(false)
  })
  it('removes the file, and removing twice is fine', () => {
    const store = createTokenStore(file, fakeCrypto())
    store.write(token)
    store.remove()
    expect(fs.existsSync(file)).toBe(false)
    expect(() => store.remove()).not.toThrow()
  })
})

describe('token store: cache', () => {
  it('decrypts the file once and keeps the result until it changes', () => {
    const crypto = fakeCrypto()
    const decrypt = vi.spyOn(crypto, 'decryptString')
    const store = createTokenStore(file, crypto)
    expect(store.read()).toBeNull()
    store.write(token)
    expect(store.read()).toEqual(token)
    expect(store.read()).toEqual(token)
    expect(decrypt).not.toHaveBeenCalled()
    store.remove()
    expect(store.read()).toBeNull()
    const fresh = createTokenStore(file, crypto)
    fs.writeFileSync(file, crypto.encryptString(JSON.stringify(token)))
    fresh.read()
    fresh.read()
    expect(decrypt).toHaveBeenCalledTimes(1)
  })
})
