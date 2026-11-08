import {
  app,
  dialog,
  globalShortcut,
  ipcMain,
  powerMonitor,
  safeStorage,
  screen,
  session,
  shell,
  systemPreferences
} from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'path'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import { APP_ID } from './appId'
import { guarded } from './guard'
import { createHotkeyBinder } from './hotkey'
import { registerIpc, type CameraAction, type ExportResult, type ImportResult } from './ipc'
import { parseBackup } from './backup'
import { probeWindows } from './probes'
import { isFullscreen } from '../core/fullscreen'
import { minutesOf, toDateStr, weekday } from '../core/time'
import { createFatigueSampler } from './fatigueSampler'
import { createSingleFlight } from './singleFlight'
import {
  createCalendarController,
  runCalendarAction,
  type CalendarAction,
  type CalendarController
} from './calendarSync'
import { createTokenStore } from './tokenStore'
import { createCameraController, type CameraController } from './camera'
import { createCameraWindow, handleCameraScheme, registerCameraScheme } from './cameraWindow'
import type { CameraPermission } from './service'
import { planUpdatedNotice, showNotification } from './notify'
import { DayfitService, type ViewState } from './service'
import { createPopover } from './tray'
import { createSeenHandler } from './seen'
import { migrateJson, openDb, restoreMigrated } from './db'
import type { BreakPart } from '../core/breaks'
import { isPortalUrl } from '../core/portalUrl'
import { FLAGS } from '../core/flags'

const TICK_MS = 30_000
const FATIGUE_SAMPLE_MS = 2_000
const CALENDAR_SYNC_MS = 15 * 60_000

// The screenshot driver (scripts/drive.mjs) runs against a throwaway profile.
if (process.env.DAYFIT_USER_DATA) app.setPath('userData', process.env.DAYFIT_USER_DATA)

// Before ready: the camera page's scheme needs fetch() for MediaPipe's WASM and model.
registerCameraScheme()

/** Electron's camera status in Dayfit's terms. */
const cameraStatus = (): CameraPermission => {
  if (process.platform !== 'darwin' && process.platform !== 'win32') return 'granted'
  const st = systemPreferences.getMediaAccessStatus('camera')
  if (st === 'granted') return 'granted'
  if (st === 'not-determined') return 'not-determined'
  if (st === 'denied' || st === 'restricted') return 'denied'
  return 'unknown'
}

if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.whenReady().then(() => {
    electronApp.setAppUserModelId(APP_ID)
    app.dock?.hide()
    app.on('browser-window-created', (_, window) => optimizer.watchWindowShortcuts(window))

    handleCameraScheme()
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
    // Camera cues: created below, opened and closed after each tick.
    let camera: CameraController | null = null
    let screenLocked = false
    // Created below; publish tells it when the blocks to write back change.
    let calendar: CalendarController | null = null
    let lastWriteBlocks = ''
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
      if (calendar && s.calendar.writeBack) {
        const blocks = JSON.stringify(service.writeBlocks())
        if (blocks !== lastWriteBlocks) {
          lastWriteBlocks = blocks
          calendar.blocksChanged()
        }
      }
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
    // Google Calendar: no network until a token is stored or the user clicks Connect.
    // Off in builds where it hasn't shipped yet (FLAGS.calendar).
    calendar = !FLAGS.calendar
      ? null
      : createCalendarController({
          fetch,
          tokens: createTokenStore(join(userData, 'google-token.bin'), safeStorage),
          openExternal: (url) => void shell.openExternal(url),
          service,
          today: () => toDateStr(new Date()),
          nowMin: () => minutesOf(new Date()),
          nowMs: () => Date.now(),
          publish: (v) => {
            publish(v)
          }
        })
    const cal = calendar
    cal?.refreshLink()
    const syncCalendar = (): void => {
      cal?.sync().then(publish, (e: unknown) => console.error('calendar sync failed', e))
    }
    if (cal) {
      syncCalendar()
      setInterval(syncCalendar, CALENDAR_SYNC_MS)
    }
    const calendarAction = async (a: CalendarAction): Promise<ViewState> => {
      if (!cal) return service.view()
      try {
        return await runCalendarAction(cal, a)
      } catch (e) {
        console.error('calendar action failed', e)
        return service.view()
      }
    }
    // Camera cues: a hidden window that only runs while the conditions allow it.
    const cam = createCameraController({
      createWindow: createCameraWindow,
      mediaStatus: cameraStatus,
      askAccess: () =>
        process.platform === 'darwin'
          ? systemPreferences.askForMediaAccess('camera')
          : Promise.resolve(true),
      service,
      publish: (v) => {
        publish(v)
      },
      nowMs: () => Date.now()
    })
    camera = cam
    // Only the camera window may use the camera; other permissions keep Electron's default.
    session.defaultSession.setPermissionRequestHandler((wc, permission, callback, details) => {
      if (permission !== 'media') return callback(true)
      const media = 'mediaTypes' in details ? (details.mediaTypes ?? []) : []
      callback(cam.fromCamera(wc.id) && !media.includes('audio'))
    })
    session.defaultSession.setPermissionCheckHandler((wc, permission) =>
      permission === 'media' ? wc !== null && cam.fromCamera(wc.id) : true
    )
    for (const [channel, handle] of [
      ['camera:minute', (p: unknown) => cam.onMinute(p)],
      ['camera:calibration', (p: unknown) => cam.onCalibration(p)],
      ['camera:error', (p: unknown) => cam.onError(String(p))]
    ] as const)
      ipcMain.on(channel, (e, payload: unknown) => {
        if (cam.fromCamera(e.sender.id)) handle(payload)
      })
    const cameraAction = async (a: CameraAction): Promise<ViewState> => {
      try {
        const v =
          a === 'enable' ? await cam.enable() : a === 'disable' ? cam.disable() : cam.calibrate()
        updateCamera(v)
        return service.view()
      } catch (e) {
        console.error('camera action failed', e)
        return service.view()
      }
    }
    registerIpc(service, publish, {
      hide: () => popover.hide(),
      openPortal,
      exportData,
      importData,
      calendar: calendarAction,
      camera: cameraAction
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
        target ? popover.focus(target) : popover.show(),
      onDelivery: guarded('notification delivery', (shown: boolean) => {
        if (service.view().notificationsOk === shown) return
        service.setNotificationsOk(shown)
        publish(service.view())
      })
    }

    /** Opens or closes the camera window to match the view (feature, hours, meeting, busy…). */
    function updateCamera(v: ViewState): void {
      if (!camera) return
      const s = v.settings
      camera.update({
        enabled: s.features.camera.enabled,
        workDay: s.workDays.includes(weekday(v.today)),
        inHours: v.now >= s.workStart && v.now < s.workEnd,
        checkedOut: v.checkedOut,
        locked: screenLocked,
        idleSec: powerMonitor.getSystemIdleTime(),
        inFixedBlock: v.plan.blocks.some(
          (b) => b.kind === 'fixed' && b.start <= v.now && v.now < b.end
        ),
        busy: v.manualBusy === true || v.autoBusy
      })
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
      updateCamera(service.view())
    })
    // Before each tick: is another app full screen? A failed probe counts as no.
    const fullScreenNow = async (): Promise<boolean> => {
      if (!service.currentSettings().features.autoBusyFullscreen.enabled) return false
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
    const fatigueOn = (): boolean => service.currentSettings().features.fatigue.enabled
    setInterval(
      guarded('fatigue sample', () => {
        if (fatigueOn()) sampler.sample(toDateStr(new Date()))
      }),
      FATIGUE_SAMPLE_MS
    )
    const shareFatigue = guarded('fatigue update', (): void => {
      if (!fatigueOn()) return
      const snap = sampler.snapshot(toDateStr(new Date()))
      service.setFatigue(snap.minutes, snap.todayRate)
    })
    // One run at a time: waking the Mac fires both resume and unlock-screen.
    const probeThenTick = createSingleFlight(async (): Promise<void> => {
      shareFatigue()
      const full = await fullScreenNow().catch((e: unknown) => {
        console.error('full-screen probe failed', e)
        return false
      })
      service.setAutoBusy(full)
      tick()
    })
    setInterval(probeThenTick, TICK_MS)
    powerMonitor.on('resume', probeThenTick)
    powerMonitor.on('unlock-screen', probeThenTick)
    // The camera turns off the moment the screen locks.
    powerMonitor.on('lock-screen', () => {
      screenLocked = true
      updateCamera(service.view())
    })
    powerMonitor.on('unlock-screen', () => {
      screenLocked = false
      updateCamera(service.view())
    })
    // Meetings may have changed while the Mac slept; the controller runs one sync at a time.
    powerMonitor.on('resume', syncCalendar)
    powerMonitor.on('unlock-screen', syncCalendar)
  })

  app.on('will-quit', () => globalShortcut.unregisterAll())
  // Menu bar app: stay alive with no windows open.
  app.on('window-all-closed', () => {})
}
