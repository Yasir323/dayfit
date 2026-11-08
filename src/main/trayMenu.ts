import type { MenuItemConstructorOptions } from 'electron'

export interface TrayMenuActions {
  open(): void
  settings(): void
  quit(): void
}

/** The icon's right-click menu: the only way to quit a menu bar app with no Dock icon. */
export function trayMenuTemplate(a: TrayMenuActions): MenuItemConstructorOptions[] {
  return [
    { label: 'Open Dayfit', click: () => a.open() },
    { label: 'Settings…', click: () => a.settings() },
    { type: 'separator' },
    { label: 'Quit Dayfit', click: () => a.quit() }
  ]
}
