import { describe, it, expect } from 'vitest'
import { parseBrainDump } from '../../src/core/brainDump'

const D = '2026-10-23'

describe('parseBrainDump', () => {
  it('skips blank lines and trims', () => {
    const r = parseBrainDump('a 15m\n\n  b #x  \n', D)
    expect(r).toHaveLength(2)
    expect(r[1].title).toBe('b')
  })
})
