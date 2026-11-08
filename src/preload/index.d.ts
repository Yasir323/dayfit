import type { CalendarAction } from '../main/calendarSync'
import type { CameraAction, ExportResult, ImportResult } from '../main/ipc'
import type { DayfitService, ViewState } from '../main/service'

type Async<K extends keyof DayfitService> = (
  ...args: Parameters<DayfitService[K]>
) => Promise<ViewState>

export type FocusTarget = 'quick-add' | 'nudge' | 'review' | 'checkout' | 'settings'

export interface DayfitApi {
  view: Async<'view'>
  addItems: Async<'addItems'>
  updateItem: Async<'updateItem'>
  replan: Async<'replan'>
  answerDecisions: Async<'answerDecisions'>
  answerNudge: Async<'answerNudge'>
  planNow: Async<'planNow'>
  confirmCall: Async<'confirmCall'>
  setLock: Async<'setLock'>
  logWater: Async<'logWater'>
  logCoffee: Async<'logCoffee'>
  logMood: Async<'logMood'>
  snoozeCustom: Async<'snoozeCustom'>
  setErgonomics: Async<'setErgonomics'>
  markPunched: Async<'markPunched'>
  snoozeBreak: Async<'snoozeBreak'>
  startFocus: Async<'startFocus'>
  stopFocus: Async<'stopFocus'>
  dismissAlert: Async<'dismissAlert'>
  checkOut: Async<'checkOut'>
  setManualBusy: Async<'setManualBusy'>
  updateSettings: Async<'updateSettings'>
  /** Hides the popover (Esc). */
  previewTomorrow(): Promise<ReturnType<DayfitService['previewTomorrow']>>
  week(): Promise<ReturnType<DayfitService['week']>>
  exportData(): Promise<ExportResult>
  importData(): Promise<ImportResult>
  /** Google Calendar: connect, cancel, disconnect, sync, write-back on or off. */
  calendar(a: CalendarAction): Promise<ViewState>
  /** Camera cues: enable (asks for access), disable, calibrate. */
  camera(a: CameraAction): Promise<ViewState>
  hide(): void
  openPortal(): void
  quit(): void
  onState(cb: (v: ViewState) => void): () => void
  onFocus(cb: (target: FocusTarget) => void): () => void
}

declare global {
  interface Window {
    dayfit: DayfitApi
  }
}
