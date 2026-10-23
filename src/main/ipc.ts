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
  'markPunched',
  'snoozeBreak',
  'dismissAlert',
  'checkOut',
  'setManualBusy',
  'updateSettings'
] as const satisfies readonly (keyof DayfitService)[]

export type IpcMethod = (typeof IPC_METHODS)[number]

/** Window actions the renderer may ask for, outside the service. */
export interface ShellActions {
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
  ipcMain.on('dayfit:hide', () => shell.hide())
  ipcMain.on('dayfit:openPortal', () => shell.openPortal())
}
