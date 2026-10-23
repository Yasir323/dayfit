import { contextBridge, ipcRenderer } from 'electron'
import type { DayfitApi } from './index.d'

const call =
  (method: string) =>
  (...args: unknown[]) =>
    ipcRenderer.invoke(`dayfit:${method}`, ...args)

const subscribe =
  <T>(channel: string) =>
  (cb: (v: T) => void): (() => void) => {
    const listener = (_e: unknown, v: T): void => cb(v)
    ipcRenderer.on(channel, listener)
    return () => ipcRenderer.removeListener(channel, listener)
  }

const dayfit = {
  view: call('view'),
  addItems: call('addItems'),
  updateItem: call('updateItem'),
  replan: call('replan'),
  answerDecisions: call('answerDecisions'),
  answerNudge: call('answerNudge'),
  planNow: call('planNow'),
  confirmCall: call('confirmCall'),
  setLock: call('setLock'),
  logWater: call('logWater'),
  markPunched: call('markPunched'),
  checkOut: call('checkOut'),
  setManualBusy: call('setManualBusy'),
  updateSettings: call('updateSettings'),
  hide: () => ipcRenderer.send('dayfit:hide'),
  openPortal: () => ipcRenderer.send('dayfit:openPortal'),
  onState: subscribe('dayfit:state'),
  onFocus: subscribe('dayfit:focus')
} as DayfitApi

contextBridge.exposeInMainWorld('dayfit', dayfit)
