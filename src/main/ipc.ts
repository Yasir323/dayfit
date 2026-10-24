import { ipcMain } from 'electron'
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
}

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
  ipcMain.on('dayfit:hide', () => shell.hide())
  ipcMain.on('dayfit:openPortal', () => shell.openPortal())
}
