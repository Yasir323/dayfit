import { isAbsolute, join, normalize, relative } from 'node:path'
import { isMinuteScore } from '../core/faceCues'
import type { CameraPermission, CameraStatus, DayfitService, ViewState } from './service'

/** Camera cues run only when every one of these allows it. */
export interface RunInput {
  enabled: boolean
  workDay: boolean
  inHours: boolean
  checkedOut: boolean
  locked: boolean
  idleSec: number
  /** A meeting or other fixed-time block is running now. */
  inFixedBlock: boolean
  /** Manual busy, or auto busy (another app full screen). */
  busy: boolean
  permission: CameraPermission
}

/** Idle this long and the camera turns off (reading counts as present until then). */
export const CAMERA_IDLE_SEC = 300

export function shouldRun(i: RunInput): boolean {
  return (
    i.enabled &&
    i.workDay &&
    i.inHours &&
    !i.checkedOut &&
    !i.locked &&
    i.idleSec < CAMERA_IDLE_SEC &&
    !i.inFixedBlock &&
    !i.busy &&
    i.permission === 'granted'
  )
}

/** The hidden camera window, as the controller sees it. */
export interface CameraWindowHandle {
  /** The window's webContents id: only messages from it are trusted. */
  id: number
  destroy(): void
  isDestroyed(): boolean
  send(channel: 'camera:calibrate'): void
}

export interface CameraDeps {
  createWindow(): CameraWindowHandle
  mediaStatus(): CameraPermission
  askAccess(): Promise<boolean>
  service: Pick<
    DayfitService,
    'addCameraMinute' | 'setCameraStatus' | 'setCalibration' | 'updateSettings' | 'view'
  >
  publish(v: ViewState): void
  nowMs(): number
}

export interface CameraController {
  /** Opens or closes the camera window to match the run conditions. */
  update(i: Omit<RunInput, 'permission'>): void
  /** Asks for camera access if needed, then turns the feature on. */
  enable(): Promise<ViewState>
  disable(): ViewState
  /** Asks the page for 5 s of "sitting well" frames. */
  calibrate(): ViewState
  /** True for the camera window's webContents id. */
  fromCamera(senderId: number): boolean
  onMinute(payload: unknown): void
  onCalibration(payload: unknown): void
  onError(message: string): void
}

const isCalibration = (v: unknown): v is { pitch: number; faceY: number; iris: number } => {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  const finite = (x: unknown): x is number => typeof x === 'number' && Number.isFinite(x)
  return (
    finite(o.pitch) &&
    finite(o.faceY) &&
    finite(o.iris) &&
    o.iris > 0 &&
    o.faceY >= 0 &&
    o.faceY <= 1
  )
}

export function createCameraController(d: CameraDeps): CameraController {
  const svc = d.service
  let win: CameraWindowHandle | null = null
  /** The page couldn't open the camera; stays off until the user enables it again. */
  let blocked = false
  let deniedByPage = false
  let calibrating = false

  const permission = (): CameraPermission => (deniedByPage ? 'denied' : d.mediaStatus())
  const status = (): CameraStatus => ({
    running: win !== null,
    permission: permission(),
    calibrating
  })
  const report = (): void => svc.setCameraStatus(status())
  const close = (): void => {
    if (win && !win.isDestroyed()) win.destroy()
    win = null
    calibrating = false
  }
  const setEnabled = (enabled: boolean): ViewState => {
    const camera = svc.view().settings.features.camera
    return svc.updateSettings({ features: { camera: { ...camera, enabled } } })
  }

  return {
    update(i) {
      const run = !blocked && shouldRun({ ...i, permission: permission() })
      if (run && !win) win = d.createWindow()
      if (!run && win) close()
      report()
    },
    async enable() {
      let st = d.mediaStatus()
      if (st === 'not-determined' || st === 'unknown') {
        const ok = await d.askAccess()
        st = ok ? 'granted' : 'denied'
      }
      if (st !== 'granted') {
        deniedByPage = true
        report()
        return svc.view()
      }
      blocked = false
      deniedByPage = false
      const v = setEnabled(true)
      report()
      return v
    },
    disable() {
      close()
      const v = setEnabled(false)
      report()
      return v
    },
    calibrate() {
      if (!win) return svc.view()
      win.send('camera:calibrate')
      calibrating = true
      report()
      return svc.view()
    },
    fromCamera(senderId) {
      return win !== null && win.id === senderId
    },
    onMinute(payload) {
      if (!isMinuteScore(payload)) return
      svc.addCameraMinute(payload)
      d.publish(svc.view())
    },
    onCalibration(payload) {
      calibrating = false
      report()
      if (!isCalibration(payload)) {
        d.publish(svc.view())
        return
      }
      const { pitch, faceY, iris } = payload
      d.publish(svc.setCalibration({ pitch, faceY, iris, at: d.nowMs() }))
    },
    onError(message) {
      console.error('camera page:', message)
      blocked = true
      deniedByPage = true
      close()
      report()
      d.publish(svc.view())
    }
  }
}

/**
 * The file under `root` that a `dayfit-cam://app/<path>` request names, or null for anything
 * outside it (or the bare root).
 */
export function resolveAsset(root: string, urlPath: string): string | null {
  let rel: string
  try {
    rel = decodeURIComponent(urlPath)
  } catch {
    return null
  }
  const full = normalize(join(root, rel))
  const inside = relative(root, full)
  return inside && !inside.startsWith('..') && !isAbsolute(inside) ? full : null
}
