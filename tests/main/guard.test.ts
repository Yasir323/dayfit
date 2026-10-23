import { describe, expect, it, vi } from 'vitest'
import { guarded } from '../../src/main/guard'

describe('guarded', () => {
  it('logs and swallows errors so a timer keeps running', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {})
    const fn = guarded('tick', () => {
      throw new Error('disk full')
    })
    expect(() => fn()).not.toThrow()
    expect(error).toHaveBeenCalledWith('tick failed', expect.any(Error))
    error.mockRestore()
  })

  it('passes arguments through', () => {
    const inner = vi.fn()
    guarded('x', inner)(1, 'a')
    expect(inner).toHaveBeenCalledWith(1, 'a')
  })
})
