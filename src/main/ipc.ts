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
  'setManualBusy',
  'updateSettings'
] as const satisfies readonly (keyof DayfitService)[]

export type IpcMethod = (typeof IPC_METHODS)[number]

/** Registers the handlers; `onState` runs after every call with the fresh view (push + side effects). */
export function registerIpc(service: DayfitService, onState: (v: ViewState) => void): void {
  for (const method of IPC_METHODS) {
    ipcMain.handle(`dayfit:${method}`, (_e, ...args: unknown[]) => {
      const fn = service[method] as (...a: unknown[]) => ViewState
      const view = fn.apply(service, args)
      onState(view)
      return view
    })
  }
}
