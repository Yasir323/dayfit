import { app, globalShortcut, powerMonitor, shell } from 'electron'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_ID } from './appId'
import { guarded } from './guard'
import { createHotkeyBinder } from './hotkey'
import { registerIpc } from './ipc'
import { planUpdatedNotice, showNotification } from './notify'
import { DayfitService, type ViewState } from './service'
import { createPopover } from './tray'
import { isPortalUrl } from '../core/portalUrl'

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
      popover.setLabel(view.trayLabel)
      popover.send('dayfit:state', view)
      return view
    }

    // Only a validated http(s) link ever reaches the browser.
    const openPortal = guarded('open portal', (): void => {
      const url = service.view().settings.endOfDay.portalUrl.trim()
      if (isPortalUrl(url)) void shell.openExternal(url)
    })
    registerIpc(service, publish, { hide: () => popover.hide(), openPortal })
    // Opening the popover means the latest reminder has been seen: clear the menu-bar label.
    popover.onShow(
      guarded('seen', () => {
        publish(service.markSeen())
      })
    )
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
      onPunched: guarded('punch action', (kind: 'in' | 'out') => {
        publish(service.markPunched(kind))
      }),
      onOpenPortal: openPortal,
      onOpen: (target: 'nudge' | 'checkout' | null) =>
        target ? popover.focus(target) : popover.show()
    }

    const tick = guarded('tick', (): void => {
      const { events, nudges, view } = service.tick(powerMonitor.getSystemIdleTime())
      for (const event of events)
        showNotification(
          {
            type: 'event',
            event,
            snoozeMin: view.settings.breaks.snoozeMin,
            portalUrl: view.settings.endOfDay.portalUrl
          },
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
