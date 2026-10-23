import { describe, expect, it } from 'vitest'
import { modKey } from '../../src/renderer/src/lib/platform'

describe('modKey', () => {
  it('is ⌘ on a Mac and Ctrl elsewhere', () => {
    expect(modKey('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)')).toBe('⌘')
    expect(modKey('Mozilla/5.0 (Windows NT 10.0; Win64; x64)')).toBe('Ctrl')
  })
})
