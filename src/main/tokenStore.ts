import fs from 'node:fs'

/** The Google sign-in kept between runs: never in the app state, never in backups. */
export interface StoredToken {
  refreshToken: string
  /** Space-separated scopes Google granted. */
  scope: string
}

/** Electron's `safeStorage`, or a fake in tests. */
export interface Crypto {
  isEncryptionAvailable(): boolean
  encryptString(s: string): Buffer
  decryptString(b: Buffer): string
}

export interface TokenStore {
  available(): boolean
  /** Null when there is no usable token (missing, unreadable, or no secure storage). */
  read(): StoredToken | null
  write(t: StoredToken): void
  remove(): void
}

export function createTokenStore(file: string, crypto: Crypto): TokenStore {
  const available = (): boolean => crypto.isEncryptionAvailable()
  return {
    available,
    read() {
      if (!available() || !fs.existsSync(file)) return null
      try {
        const raw: unknown = JSON.parse(crypto.decryptString(fs.readFileSync(file)))
        if (typeof raw !== 'object' || raw === null) return null
        const { refreshToken, scope } = raw as Record<string, unknown>
        if (typeof refreshToken !== 'string' || refreshToken === '') return null
        return { refreshToken, scope: typeof scope === 'string' ? scope : '' }
      } catch {
        return null
      }
    },
    write(t) {
      if (!available()) throw new Error("Secure storage isn't available on this system")
      fs.writeFileSync(file, crypto.encryptString(JSON.stringify(t)), { mode: 0o600 })
    },
    remove() {
      fs.rmSync(file, { force: true })
    }
  }
}
