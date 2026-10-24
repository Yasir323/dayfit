import { contextBridge, ipcRenderer } from 'electron'

/** All the camera page can do: send scores out, and hear "calibrate now". No frames leave. */
const dayfitCamera = {
  sendMinute: (m: unknown): void => ipcRenderer.send('camera:minute', m),
  sendCalibration: (c: unknown): void => ipcRenderer.send('camera:calibration', c),
  sendError: (message: string): void => ipcRenderer.send('camera:error', String(message)),
  onCalibrate: (cb: () => void): void => {
    ipcRenderer.on('camera:calibrate', () => cb())
  }
}

export type DayfitCameraApi = typeof dayfitCamera

contextBridge.exposeInMainWorld('dayfitCamera', dayfitCamera)
