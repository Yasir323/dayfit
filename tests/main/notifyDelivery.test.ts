import { beforeEach, describe, expect, it, vi } from 'vitest'

type Listener = (...args: unknown[]) => void
const shown: { listeners: Record<string, Listener> }[] = []

vi.mock('electron', () => ({
  Notification: class {
    static isSupported = (): boolean => true
    listeners: Record<string, Listener> = {}
    constructor() {
      shown.push(this)
    }
    on(name: string, fn: Listener): this {
      this.listeners[name] = fn
      return this
    }
    show = vi.fn()
  }
}))

import { showNotification, type NotifyHandlers } from '../../src/main/notify'

const handlers = (): NotifyHandlers & {
  onDelivery: ReturnType<typeof vi.fn<(shown: boolean) => void>>
} => ({
  onDrank: vi.fn(),
  onSnooze: vi.fn(),
  onNudge: vi.fn(),
  onPunched: vi.fn(),
  onOpenPortal: vi.fn(),
  onOpen: vi.fn(),
  onDelivery: vi.fn<(shown: boolean) => void>()
})

beforeEach(() => {
  shown.length = 0
})

describe('notification delivery', () => {
  it('reports a refused notification', () => {
    const h = handlers()
    showNotification({ type: 'info', title: 'T', body: 'B' }, 'darwin', h)
    shown[0].listeners.failed({}, 'UNErrorDomain error 1')
    expect(h.onDelivery).toHaveBeenCalledWith(false)
  })
  it('reports a shown notification', () => {
    const h = handlers()
    showNotification({ type: 'info', title: 'T', body: 'B' }, 'darwin', h)
    shown[0].listeners.show({})
    expect(h.onDelivery).toHaveBeenCalledWith(true)
  })
})
