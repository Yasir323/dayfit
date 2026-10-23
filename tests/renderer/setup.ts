// Node 25 ships its own (file-less, non-functional) `localStorage` global, which shadows jsdom's
// in the renderer test environment. Electron's Chromium is unaffected; this only fixes tests.
if (typeof globalThis.localStorage?.clear !== 'function') {
  class MemoryStorage implements Storage {
    private data = new Map<string, string>()
    get length(): number {
      return this.data.size
    }
    clear(): void {
      this.data.clear()
    }
    getItem(key: string): string | null {
      return this.data.get(key) ?? null
    }
    key(index: number): string | null {
      return [...this.data.keys()][index] ?? null
    }
    removeItem(key: string): void {
      this.data.delete(key)
    }
    setItem(key: string, value: string): void {
      this.data.set(key, String(value))
    }
  }
  Object.defineProperty(globalThis, 'Storage', { value: MemoryStorage, configurable: true })
  Object.defineProperty(globalThis, 'localStorage', {
    value: new MemoryStorage(),
    configurable: true
  })
}
