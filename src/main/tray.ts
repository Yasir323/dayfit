import { BrowserWindow, Tray, nativeImage, screen } from 'electron'
import { join } from 'path'
import { is } from '@electron-toolkit/utils'
import trayTemplate from '../../resources/trayTemplate.png?asset'
import trayIco from '../../resources/tray.ico?asset'
import { createBlurGuard } from './blurGuard'
import type { ViewState } from './service'

export type FocusTarget = 'quick-add' | 'nudge' | 'review' | 'checkout'

const WIDTH = 380
const HEIGHT = 580

export interface Popover {
  show(): void
  hide(): void
  toggle(): void
  send(channel: 'dayfit:state', view: ViewState): void
  focus(target: FocusTarget): void
}

export function createPopover(): Popover {
  const mac = process.platform === 'darwin'
  const image = nativeImage.createFromPath(mac ? trayTemplate : trayIco)
  if (mac) image.setTemplateImage(true)
  const tray = new Tray(image)
  tray.setToolTip('Dayfit')

  const win = new BrowserWindow({
    width: WIDTH,
    height: HEIGHT,
    show: false,
    frame: false,
    resizable: false,
    skipTaskbar: true,
    fullscreenable: false,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })

  // The popover never opens windows or leaves the app.
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  win.webContents.on('will-navigate', (e) => e.preventDefault())
  const guard = createBlurGuard()
  win.on('blur', () => {
    win.hide()
    guard.blurHidden()
  })

  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    win.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    win.loadFile(join(__dirname, '../renderer/index.html'))
  }

  const position = (): void => {
    const b = tray.getBounds()
    const area = screen.getDisplayNearestPoint({ x: b.x, y: b.y }).workArea
    const x = Math.round(b.x + b.width / 2 - WIDTH / 2)
    // macOS menu bar is at the top (open below); Windows taskbar is usually at the bottom (open above).
    const y = mac ? Math.round(b.y + b.height + 4) : Math.round(b.y - HEIGHT - 4)
    win.setPosition(
      Math.min(Math.max(x, area.x), area.x + area.width - WIDTH),
      Math.min(Math.max(y, area.y), area.y + area.height - HEIGHT)
    )
  }

  const show = (): void => {
    position()
    win.show()
    win.focus()
  }
  // A tray click on the open popover blurs (hides) it first; don't let the click reopen it.
  const toggle = (): void => {
    if (win.isVisible()) win.hide()
    else if (guard.mayShow()) show()
  }
  tray.on('click', toggle)

  const whenLoaded = (fn: () => void): void => {
    if (win.webContents.isLoading()) win.webContents.once('did-finish-load', fn)
    else fn()
  }

  return {
    show,
    hide: () => win.hide(),
    toggle,
    send: (channel, view) => whenLoaded(() => win.webContents.send(channel, view)),
    focus: (target) => {
      show()
      whenLoaded(() => win.webContents.send('dayfit:focus', target))
    }
  }
}
