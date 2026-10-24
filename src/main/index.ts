import { app, dialog, globalShortcut, powerMonitor, screen, shell } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_ID } from './appId'
import { guarded } from './guard'
import { createHotkeyBinder } from './hotkey'
import { registerIpc, type ExportResult, type ImportResult } from './ipc'
import { parseBackup } from './backup'
import { probeWindows } from './probes'
import { isFullscreen } from '../core/fullscreen'
import { toDateStr } from '../core/time'
import { createFatigueSampler } from './fatigueSampler'
import { planUpdatedNotice, showNotification } from './notify'
import { DayfitService, type ViewState } from './service'
import { createPopover } from './tray'
import { createSeenHandler } from './seen'
import { migrateJson, openDb, restoreMigrated } from './db'
import type { BreakPart } from '../core/breaks'
import { isPortalUrl } from '../core/portalUrl'

const TICK_MS = 30_000
const FATIGUE_SAMPLE_MS = 2_000

// The screenshot driver (scripts/drive.mjs) runs against a throwaway profile.
if (process.env.DAYFIT_USER_DATA) app.setPath('userData', process.env.DAYFIT_USER_DATA)

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(() => {
    electronApp.setAppUserModelId(APP_ID)
    app.dock?.hide()
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    const userData = app.getPath('userData')
    const db = openDb(join(userData, 'dayfit.db'))
    // First launch on the database: bring over the old JSON state once.
    migrateJson(db, join(userData, 'dayfit.json'))
    // A corrupt database starts again from the copy kept at migration, if there is one.
    restoreMigrated(db, join(userData, 'dayfit.json'))
    const service = new DayfitService(db, {
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
    // Registered before anything can show the popover (first run, hotkey, notifications).
    popover.onShow(guarded('seen', createSeenHandler(service, publish)))

    // Only a validated http(s) link ever reaches the browser.
    const openPortal = guarded('open portal', (): void => {
      const url = service.view().settings.endOfDay.portalUrl.trim()
      if (isPortalUrl(url)) void shell.openExternal(url)
    })
    const failed = (e: unknown): { ok: false; error: string } => ({
      ok: false,
      error: e instanceof Error ? e.message : 'Something went wrong'
    })
    // The dialogs take focus, which hides the popover; it comes back to show the result.
    const exportData = async (): Promise<ExportResult> => {
      try {
        const { canceled, filePath } = await dialog.showSaveDialog({
          title: 'Export Dayfit data',
          defaultPath: join(app.getPath('documents'), `dayfit-backup-${service.view().today}.json`),
          filters: [{ name: 'Dayfit backup', extensions: ['json'] }]
        })
        if (canceled || !filePath) return { ok: false, error: null }
        await writeFile(filePath, JSON.stringify(service.exportData(), null, 2))
        return { ok: true, file: filePath }
      } catch (e) {
        return failed(e)
      } finally {
        popover.show()
      }
    }
    const importData = async (): Promise<ImportResult> => {
      try {
        const { canceled, filePaths } = await dialog.showOpenDialog({
          title: 'Import Dayfit data',
          properties: ['openFile'],
          filters: [{ name: 'Dayfit backup', extensions: ['json'] }]
        })
        if (canceled || filePaths.length === 0) return { ok: false, error: null }
        const backup = parseBackup(await readFile(filePaths[0], 'utf8'))
        if (backup instanceof Error) return { ok: false, error: backup.message }
        return { ok: true, view: publish(service.importData(backup)) }
      } catch (e) {
        return failed(e)
      } finally {
        popover.show()
      }
    }
    registerIpc(service, publish, {
      hide: () => popover.hide(),
      openPortal,
      exportData,
      importData
    })
    const initial = publish(service.view())
    // A menu bar app shows nothing at launch; open the popover once so first-run setup is seen.
    if (!initial.settings.firstRunDone) popover.show()

    const handlers = {
      onDrank: guarded('water action', () => {
        publish(service.logWater())
      }),
      onSnooze: guarded('snooze action', (parts: BreakPart[]) => {
        publish(service.snoozeBreak(parts))
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
    // Before each tick: is another app full screen? A failed probe counts as no.
    const fullScreenNow = async (): Promise<boolean> => {
      if (!service.view().settings.features.autoBusyFullscreen.enabled) return false
      const windows = await probeWindows()
      const displays = screen
        .getAllDisplays()
        .map((d) => ({ x: d.bounds.x, y: d.bounds.y, w: d.bounds.width, h: d.bounds.height }))
      return windows !== null && isFullscreen(windows, displays, process.pid)
    }
    // Fatigue signals (opt-in): cursor and idle sampled every 2 s, kept in memory as minute totals.
    const sampler = createFatigueSampler(
      () => screen.getCursorScreenPoint(),
      () => powerMonitor.getSystemIdleTime()
    )
    const fatigueOn = (): boolean => service.view().settings.features.fatigue.enabled
    setInterval(
      guarded('fatigue sample', () => {
        if (fatigueOn()) sampler.sample(toDateStr(new Date()))
      }),
      FATIGUE_SAMPLE_MS
    )
    const probeThenTick = (): void => {
      if (fatigueOn()) {
        const snap = sampler.snapshot(toDateStr(new Date()))
        service.setFatigue(snap.minutes, snap.todayRate)
      }
      fullScreenNow()
        .catch((e: unknown) => {
          console.error('full-screen probe failed', e)
          return false
        })
        .then((full) => {
          service.setAutoBusy(full)
          tick()
        })
    }
    setInterval(probeThenTick, TICK_MS)
    powerMonitor.on('resume', probeThenTick)
    powerMonitor.on('unlock-screen', probeThenTick)
  })

  app.on('will-quit', () => globalShortcut.unregisterAll())
  // Menu bar app: stay alive with no windows open.
  app.on('window-all-closed', () => {})
}
