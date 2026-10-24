import { ipcMain } from 'electron'
import type { CalendarAction } from './calendarSync'
import type { DayfitService, ViewState } from './service'

/** Every public service method except `tick`; each becomes a `dayfit:<method>` channel. */
export const IPC_METHODS = [
  'view',
  'addItems',
  'updateItem',
  'replan',
  'answerDecisions',
  'answerNudge',
  'planNow',
  'confirmCall',
  'setLock',
  'logWater',
  'logCoffee',
  'logMood',
  'snoozeCustom',
  'setErgonomics',
  'markPunched',
  'snoozeBreak',
  'startFocus',
  'stopFocus',
  'dismissAlert',
  'checkOut',
  'setManualBusy',
  'updateSettings'
] as const satisfies readonly (keyof DayfitService)[]

export type IpcMethod = (typeof IPC_METHODS)[number]

/** `error` null means the user cancelled the file dialog. */
export type ExportResult = { ok: true; file: string } | { ok: false; error: string | null }
export type ImportResult = { ok: true; view: ViewState } | { ok: false; error: string | null }

/** Window actions the renderer may ask for, outside the service. */
export interface ShellActions {
  /** `dayfit:exportData`: save dialog, then writes the backup file. */
  exportData(): Promise<ExportResult>
  /** `dayfit:importData`: open dialog, then replaces all data from the file. */
  importData(): Promise<ImportResult>
  /** `dayfit:hide` (Esc in the popover). */
  hide(): void
  /** `dayfit:openPortal` (attendance banner): opens the HRMS link in the browser. */
  openPortal(): void
  /** `dayfit:calendar`: Google Calendar connect, sync and write-back; never rejects. */
  calendar(a: CalendarAction): Promise<ViewState>
  /** `dayfit:camera`: camera cues on (asks for access), off, or calibrate. */
  camera(a: CameraAction): Promise<ViewState>
}

export type CameraAction = 'enable' | 'disable' | 'calibrate'

/**
 * Registers the handlers; `onState` runs after every call with the fresh view (push + side
 * effects) and returns the view handed back to the caller.
 */
export function registerIpc(
  service: DayfitService,
  onState: (v: ViewState) => ViewState,
  shell: ShellActions
): void {
  for (const method of IPC_METHODS) {
    ipcMain.handle(`dayfit:${method}`, (_e, ...args: unknown[]) => {
      const fn = service[method] as (...a: unknown[]) => ViewState
      return onState(fn.apply(service, args))
    })
  }
  // Read-only queries that return data, not a new view.
  ipcMain.handle('dayfit:previewTomorrow', () => service.previewTomorrow())
  ipcMain.handle('dayfit:week', () => service.week())
  ipcMain.handle('dayfit:exportData', () => shell.exportData())
  ipcMain.handle('dayfit:importData', () => shell.importData())
  ipcMain.handle('dayfit:calendar', async (_e, a: CalendarAction) =>
    onState(await shell.calendar(a))
  )
  ipcMain.handle('dayfit:camera', async (_e, a: CameraAction) => onState(await shell.camera(a)))
  ipcMain.on('dayfit:hide', () => shell.hide())
  ipcMain.on('dayfit:openPortal', () => shell.openPortal())
}
