import { describe, expect, it, vi } from 'vitest'
import { createSeenHandler } from '../../src/main/seen'
import type { ViewState } from '../../src/main/service'

describe('createSeenHandler', () => {
  it('marks the label seen and publishes the result', () => {
    const view = { trayLabel: null } as ViewState
    const service = { markSeen: vi.fn(() => view) }
    const publish = vi.fn((v: ViewState) => v)
    createSeenHandler(service, publish)()
    expect(service.markSeen).toHaveBeenCalledTimes(1)
    expect(publish).toHaveBeenCalledWith(view)
  })
})
