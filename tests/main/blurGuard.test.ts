import { describe, expect, it } from 'vitest'
import { createBlurGuard } from '../../src/main/blurGuard'

describe('createBlurGuard', () => {
  it('ignores a show within 250 ms of a blur-hide (the tray click that caused the blur)', () => {
    let t = 1000
    const g = createBlurGuard(() => t)
    expect(g.mayShow()).toBe(true)
    g.blurHidden()
    t = 1200
    expect(g.mayShow()).toBe(false)
    t = 1250
    expect(g.mayShow()).toBe(true)
  })
})
