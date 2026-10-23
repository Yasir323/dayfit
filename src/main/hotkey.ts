/** The part of Electron's globalShortcut the binder needs. */
export interface ShortcutApi {
  register(accelerator: string, callback: () => void): boolean
  unregister(accelerator: string): void
}

/**
 * Returns `bind(accelerator)`, which swaps the global shortcut to `accelerator` and reports
 * whether it is registered. Never throws: an invalid or taken accelerator just reports false.
 */
export function createHotkeyBinder(
  api: ShortcutApi,
  onPress: () => void
): (accelerator: string) => boolean {
  let requested: string | null = null
  let registered: string | null = null
  let ok = false
  return (accelerator) => {
    if (accelerator === requested) return ok
    requested = accelerator
    if (registered !== null) {
      try {
        api.unregister(registered)
      } catch (e) {
        console.error('hotkey unregister failed', e)
      }
      registered = null
    }
    try {
      ok = api.register(accelerator, onPress) === true
    } catch {
      ok = false // invalid accelerator string
    }
    if (ok) registered = accelerator
    return ok
  }
}
