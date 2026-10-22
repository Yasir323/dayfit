import type { DayfitService, ViewState } from '../main/service'

type Async<K extends keyof DayfitService> = (
  ...args: Parameters<DayfitService[K]>
) => Promise<ViewState>

export type FocusTarget = 'quick-add' | 'nudge' | 'review'

export interface DayfitApi {
  view: Async<'view'>
  addItems: Async<'addItems'>
  updateItem: Async<'updateItem'>
  replan: Async<'replan'>
  answerDecisions: Async<'answerDecisions'>
  answerNudge: Async<'answerNudge'>
  confirmCall: Async<'confirmCall'>
  setLock: Async<'setLock'>
  logWater: Async<'logWater'>
  setManualBusy: Async<'setManualBusy'>
  updateSettings: Async<'updateSettings'>
  onState(cb: (v: ViewState) => void): () => void
  onFocus(cb: (target: FocusTarget) => void): () => void
}

declare global {
  interface Window {
    dayfit: DayfitApi
  }
}
