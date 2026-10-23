import { describe, expect, it, vi, type Mock } from 'vitest'
import { createHotkeyBinder, type ShortcutApi } from '../../src/main/hotkey'

interface FakeApi {
  register: Mock<ShortcutApi['register']>
  unregister: Mock<ShortcutApi['unregister']>
}

const fakeApi = (register: ShortcutApi['register']): FakeApi => ({
  register: vi.fn(register),
  unregister: vi.fn<ShortcutApi['unregister']>()
})

describe('createHotkeyBinder', () => {
  it('registers once per accelerator and reports success', () => {
    const api = fakeApi(() => true)
    const bind = createHotkeyBinder(api, () => {})
    expect(bind('A')).toBe(true)
    expect(bind('A')).toBe(true)
    expect(api.register).toHaveBeenCalledTimes(1)
  })

  it('reports false, without throwing, for an invalid or taken accelerator', () => {
    const throwing = createHotkeyBinder(
      fakeApi(() => {
        throw new Error('bad accelerator')
      }),
      () => {}
    )
    expect(throwing('Nope+')).toBe(false)
    const taken = createHotkeyBinder(
      fakeApi(() => false),
      () => {}
    )
    expect(taken('A')).toBe(false)
  })

  it('unregisters only an accelerator that actually registered', () => {
    let ok = false
    const api = fakeApi(() => ok)
    const bind = createHotkeyBinder(api, () => {})
    bind('Taken')
    ok = true
    expect(bind('B')).toBe(true)
    expect(api.unregister).not.toHaveBeenCalled()
    bind('C')
    expect(api.unregister).toHaveBeenCalledWith('B')
  })

  it('still registers the new accelerator when unregistering the old one throws', () => {
    const api = fakeApi(() => true)
    api.unregister.mockImplementation(() => {
      throw new Error('boom')
    })
    const bind = createHotkeyBinder(api, () => {})
    bind('A')
    expect(bind('B')).toBe(true)
    expect(api.register).toHaveBeenLastCalledWith('B', expect.any(Function))
  })
})
