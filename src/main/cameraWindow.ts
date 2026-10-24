import { BrowserWindow, net, protocol } from 'electron'
import { is } from '@electron-toolkit/utils'
import { join } from 'path'
import { pathToFileURL } from 'url'
import { resolveAsset, type CameraWindowHandle } from './camera'

/** Packaged builds load the camera page from here: MediaPipe fetch()es its WASM and model. */
export const CAMERA_SCHEME = 'dayfit-cam'

/** Must run before the app is ready. */
export function registerCameraScheme(): void {
  protocol.registerSchemesAsPrivileged([
    { scheme: CAMERA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true } }
  ])
}

/** Serves only files inside the renderer build; anything else is a 404. */
export function handleCameraScheme(): void {
  const root = join(__dirname, '../renderer')
  protocol.handle(CAMERA_SCHEME, (req) => {
    const file = resolveAsset(root, new URL(req.url).pathname)
    return file ? net.fetch(pathToFileURL(file).toString()) : new Response(null, { status: 404 })
  })
}

/** A hidden 1×1 window that only runs the camera page; never shown, never navigates. */
export function createCameraWindow(): CameraWindowHandle {
  const win = new BrowserWindow({
    width: 1,
    height: 1,
    show: false,
    skipTaskbar: true,
    focusable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/camera.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      // Hidden pages are throttled by default; the frame loop needs its timer.
      backgroundThrottling: false
    }
  })
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  if (is.dev && process.env['ELECTRON_RENDERER_URL'])
    void win.loadURL(`${process.env['ELECTRON_RENDERER_URL']}/camera.html`)
  else void win.loadURL(`${CAMERA_SCHEME}://app/camera.html`)
  const id = win.webContents.id
  return {
    id,
    destroy: () => win.destroy(),
    isDestroyed: () => win.isDestroyed(),
    send: (channel) => win.webContents.send(channel)
  }
}
