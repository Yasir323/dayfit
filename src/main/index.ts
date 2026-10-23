import { app, globalShortcut, powerMonitor } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_ID } from './appId'
import { guarded } from './guard'
import { createHotkeyBinder } from './hotkey'
import { registerIpc } from './ipc'
import { planUpdatedNotice, showNotification } from './notify'
import { DayfitService, type ViewState } from './service'
import { createPopover } from './tray'

const TICK_MS = 30_000

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(() => {
    electronApp.setAppUserModelId(APP_ID)
    app.dock?.hide()
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    const service = new DayfitService(join(app.getPath('userData'), 'dayfit.json'), {
      now: () => new Date()
    })
    const popover = createPopover()
    app.on('second-instance', () => popover.show())

    const bindHotkey = createHotkeyBinder(globalShortcut, () => popover.focus('quick-add'))
    let launchAtLogin: boolean | null = null
    /**
     * Applies settings-driven side effects, then pushes the view (with the hotkey status) to the
     * renderer and returns it. Never throws because of the hotkey.
     */
    const publish = (raw: ViewState): ViewState => {
      const s = raw.settings
      const hotkeyOk = bindHotkey(s.hotkey)
      service.setHotkeyOk(hotkeyOk)
      const view = { ...raw, hotkeyOk }
      if (s.launchAtLogin !== launchAtLogin) {
        launchAtLogin = s.launchAtLogin
        app.setLoginItemSettings({ openAtLogin: launchAtLogin })
      }
      popover.send('dayfit:state', view)
      return view
    }

    registerIpc(service, publish, { hide: () => popover.hide() })
    const initial = publish(service.view())
    // A menu bar app shows nothing at launch; open the popover once so first-run setup is seen.
    if (!initial.settings.firstRunDone) popover.show()

    const handlers = {
      onDrank: guarded('water action', () => {
        publish(service.logWater())
      }),
      onSnooze: guarded('snooze action', () => {
        publish(service.snoozeBreak())
      }),
      onNudge: guarded('nudge action', (id: string, a: 'done' | 'extend' | 'move') => {
        const view = publish(service.answerNudge(id, a))
        // The popover is hidden, so say what moved.
        const notice = planUpdatedNotice(view)
        if (notice) showNotification(notice, process.platform, handlers)
      }),
      onOpen: (nudge: boolean) => (nudge ? popover.focus('nudge') : popover.show())
    }

    const tick = guarded('tick', (): void => {
      const { events, nudges, view } = service.tick(powerMonitor.getSystemIdleTime())
      for (const event of events)
        showNotification(
          { type: 'event', event, snoozeMin: view.settings.breaks.snoozeMin },
          process.platform,
          handlers
        )
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
    })
    setInterval(tick, TICK_MS)
    powerMonitor.on('resume', tick)
    powerMonitor.on('unlock-screen', tick)
  })

  app.on('will-quit', () => globalShortcut.unregisterAll())
  // Menu bar app: stay alive with no windows open.
  app.on('window-all-closed', () => {})
}
