import { describe, expect, it, vi } from 'vitest'
import { createSingleFlight } from '../../src/main/singleFlight'

describe('createSingleFlight', () => {
  it('a call while one is running is skipped; after it settles, calls run again', async () => {
    let release = (): void => {}
    const fn = vi.fn(() => new Promise<void>((r) => (release = r)))
    const run = createSingleFlight(fn)
    run()
    run()
    expect(fn).toHaveBeenCalledTimes(1)
    release()
    await Promise.resolve()
    await Promise.resolve()
    run()
    expect(fn).toHaveBeenCalledTimes(2)
  })

  it('a failed run frees the slot', async () => {
    const fn = vi.fn(() => Promise.reject(new Error('x')))
    const run = createSingleFlight(fn)
    run()
    await Promise.resolve()
    await Promise.resolve()
    run()
    expect(fn).toHaveBeenCalledTimes(2)
  })
})
