import { app, globalShortcut, powerMonitor } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { registerIpc } from './ipc'
import { showNotification } from './notify'
import { DayfitService, type ViewState } from './service'
import { createPopover } from './tray'

const TICK_MS = 30_000

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(() => {
    electronApp.setAppUserModelId('app.dayfit.desktop')
    app.dock?.hide()
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    const service = new DayfitService(join(app.getPath('userData'), 'dayfit.json'), {
      now: () => new Date()
    })
    const popover = createPopover()
    app.on('second-instance', () => popover.show())

    let hotkey: string | null = null
    let launchAtLogin: boolean | null = null
    /** Pushes the view to the renderer and applies settings-driven side effects. */
    const publish = (view: ViewState): void => {
      popover.send('dayfit:state', view)
      const s = view.settings
      if (s.hotkey !== hotkey) {
        if (hotkey) globalShortcut.unregister(hotkey)
        hotkey = s.hotkey
        try {
          globalShortcut.register(hotkey, () => popover.focus('quick-add'))
        } catch {
          // invalid accelerator string: leave the hotkey unbound
        }
      }
      if (s.launchAtLogin !== launchAtLogin) {
        launchAtLogin = s.launchAtLogin
        app.setLoginItemSettings({ openAtLogin: launchAtLogin })
      }
    }

    registerIpc(service, publish)
    publish(service.view())

    const tick = (): void => {
      const { events, nudges, view } = service.tick(powerMonitor.getSystemIdleTime())
      const handlers = {
        onDrank: () => publish(service.logWater()),
        onNudge: (id: string, a: 'done' | 'extend' | 'move') => publish(service.answerNudge(id, a)),
        onOpen: (nudge: boolean) => (nudge ? popover.focus('nudge') : popover.show())
      }
      for (const event of events)
        showNotification({ type: 'event', event }, process.platform, handlers)
      for (const id of nudges) {
        const item = view.items.find((i) => i.id === id)
        if (item)
          showNotification(
            { type: 'nudge', itemId: id, title: item.title },
            process.platform,
            handlers
          )
      }
      publish(view)
    }
    setInterval(tick, TICK_MS)
    powerMonitor.on('resume', tick)
    powerMonitor.on('unlock-screen', tick)
  })

  app.on('will-quit', () => globalShortcut.unregisterAll())
  // Menu bar app: stay alive with no windows open.
  app.on('window-all-closed', () => {})
}
