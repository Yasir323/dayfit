import { describe, expect, it, vi } from 'vitest'
import { trayMenuTemplate } from '../../src/main/trayMenu'

describe('tray menu', () => {
  const actions = (): { open: () => void; settings: () => void; quit: () => void } => ({
    open: vi.fn(),
    settings: vi.fn(),
    quit: vi.fn()
  })
  it('offers open, settings and quit', () => {
    const items = trayMenuTemplate(actions())
    expect(items.map((i) => i.label ?? i.type)).toEqual([
      'Open Dayfit',
      'Settings…',
      'separator',
      'Quit Dayfit'
    ])
  })
  it('each item runs its action', () => {
    const a = actions()
    const items = trayMenuTemplate(a)
    const click = (label: string): void =>
      (items.find((i) => i.label === label)?.click as () => void)()
    click('Open Dayfit')
    click('Settings…')
    click('Quit Dayfit')
    expect(a.open).toHaveBeenCalledOnce()
    expect(a.settings).toHaveBeenCalledOnce()
    expect(a.quit).toHaveBeenCalledOnce()
  })
})
