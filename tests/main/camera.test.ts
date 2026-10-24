import { describe, expect, it, vi } from 'vitest'
import {
  createCameraController,
  resolveAsset,
  shouldRun,
  type CameraDeps,
  type CameraWindowHandle,
  type RunInput
} from '../../src/main/camera'
import type { MinuteScore } from '../../src/core/faceCues'
import { DEFAULT_SETTINGS, type SettingsPatch } from '../../src/core/types'
import type { CameraPermission, CameraStatus, ViewState } from '../../src/main/service'

const good: RunInput = {
  enabled: true,
  workDay: true,
  inHours: true,
  checkedOut: false,
  locked: false,
  idleSec: 10,
  inFixedBlock: false,
  busy: false,
  permission: 'granted'
}
const { permission: _p, ...goodUpdate } = good
void _p

const minute = (p: Partial<MinuteScore> = {}): MinuteScore => ({
  at: 1_800_000_000_000,
  present: 1,
  blinks: 15,
  perclos: 0.03,
  yawns: 0,
  pitch: 0,
  faceY: 0.5,
  iris: 0.04,
  ...p
})

/** Fake window factory, service and permission API. */
function setup(status: CameraPermission = 'granted', ask = true) {
  const windows: (CameraWindowHandle & { sent: string[]; destroyed: boolean })[] = []
  let camera = { ...DEFAULT_SETTINGS.features.camera }
  const statuses: CameraStatus[] = []
  const service = {
    addCameraMinute: vi.fn(),
    setCameraStatus: vi.fn((s: CameraStatus) => statuses.push(s)),
    setCalibration: vi.fn(() => ({}) as ViewState),
    updateSettings: vi.fn((p: SettingsPatch) => {
      if (p.features?.camera) camera = p.features.camera
      return { settings: { features: { camera } } } as unknown as ViewState
    }),
    view: vi.fn(() => ({ settings: { features: { camera } } }) as unknown as ViewState)
  }
  const deps: CameraDeps = {
    createWindow: () => {
      const w = {
        id: 100 + windows.length,
        sent: [] as string[],
        destroyed: false,
        destroy() {
          w.destroyed = true
        },
        isDestroyed: () => w.destroyed,
        send(ch: 'camera:calibrate') {
          w.sent.push(ch)
        }
      }
      windows.push(w)
      return w
    },
    mediaStatus: vi.fn(() => status),
    askAccess: vi.fn(async () => ask),
    service,
    publish: vi.fn(),
    nowMs: () => 42
  }
  const c = createCameraController(deps)
  return { c, deps, windows, service, statuses, camera: () => camera }
}

describe('shouldRun', () => {
  it('runs when everything allows it', () => {
    expect(shouldRun(good)).toBe(true)
  })
  it.each<[string, Partial<RunInput>]>([
    ['feature off', { enabled: false }],
    ['day off', { workDay: false }],
    ['outside hours', { inHours: false }],
    ['checked out', { checkedOut: true }],
    ['screen locked', { locked: true }],
    ['idle 5 min', { idleSec: 300 }],
    ['in a meeting', { inFixedBlock: true }],
    ['busy', { busy: true }],
    ['permission denied', { permission: 'denied' }],
    ['permission unknown', { permission: 'not-determined' }]
  ])('stops when %s', (_n, p) => {
    expect(shouldRun({ ...good, ...p })).toBe(false)
  })
  it('keeps running just under 5 min idle', () => {
    expect(shouldRun({ ...good, idleSec: 299 })).toBe(true)
  })
})

describe('camera controller: window', () => {
  it('opens one window while it should run and closes it when not', () => {
    const { c, windows, statuses } = setup()
    c.update(goodUpdate)
    c.update(goodUpdate)
    expect(windows).toHaveLength(1)
    expect(statuses.at(-1)?.running).toBe(true)
    expect(c.fromCamera(100)).toBe(true)
    expect(c.fromCamera(7)).toBe(false)
    c.update({ ...goodUpdate, locked: true })
    expect(windows[0].destroyed).toBe(true)
    expect(statuses.at(-1)?.running).toBe(false)
    expect(c.fromCamera(100)).toBe(false)
  })
  it('closes the window when access is revoked in System Settings', () => {
    const s = setup()
    s.c.update(goodUpdate)
    vi.mocked(s.deps.mediaStatus).mockReturnValue('denied')
    s.c.update(goodUpdate)
    expect(s.windows[0].destroyed).toBe(true)
    expect(s.statuses.at(-1)?.permission).toBe('denied')
  })
})

describe('camera controller: enable', () => {
  it('asks once, then turns the feature on', async () => {
    const s = setup('not-determined', true)
    vi.mocked(s.deps.askAccess).mockImplementation(async () => {
      vi.mocked(s.deps.mediaStatus).mockReturnValue('granted')
      return true
    })
    await s.c.enable()
    expect(s.deps.askAccess).toHaveBeenCalledTimes(1)
    expect(s.camera().enabled).toBe(true)
    expect(s.statuses.at(-1)?.permission).toBe('granted')
  })
  it('stays off when the user refuses', async () => {
    const s = setup('not-determined', false)
    await s.c.enable()
    expect(s.camera().enabled).toBe(false)
    expect(s.statuses.at(-1)?.permission).toBe('denied')
    expect(s.windows).toHaveLength(0)
  })
  it('does not ask again once denied', async () => {
    const s = setup('denied')
    await s.c.enable()
    expect(s.deps.askAccess).not.toHaveBeenCalled()
    expect(s.camera().enabled).toBe(false)
    expect(s.statuses.at(-1)?.permission).toBe('denied')
  })
  it('disable turns it off and closes the window', () => {
    const s = setup()
    s.c.update(goodUpdate)
    s.c.disable()
    expect(s.camera().enabled).toBe(false)
    expect(s.windows[0].destroyed).toBe(true)
  })
})

describe('camera controller: messages from the page', () => {
  it('stores a valid minute and publishes', () => {
    const s = setup()
    s.c.onMinute(minute())
    expect(s.service.addCameraMinute).toHaveBeenCalledWith(minute())
    expect(s.deps.publish).toHaveBeenCalled()
  })
  it.each<[string, unknown]>([
    ['NaN', minute({ blinks: NaN })],
    ['null', null],
    ['text', 'hello'],
    ['present above 1', minute({ present: 2 })],
    ['a huge array', Array.from({ length: 10_000 }, () => minute())]
  ])('drops %s', (_n, payload) => {
    const s = setup()
    s.c.onMinute(payload)
    expect(s.service.addCameraMinute).not.toHaveBeenCalled()
  })
  it('a camera error closes the window until enabled again', async () => {
    const s = setup()
    s.c.update(goodUpdate)
    s.c.onError('NotAllowedError')
    expect(s.windows[0].destroyed).toBe(true)
    expect(s.statuses.at(-1)?.permission).toBe('denied')
    s.c.update(goodUpdate)
    expect(s.windows).toHaveLength(1)
    await s.c.enable()
    s.c.update(goodUpdate)
    expect(s.windows).toHaveLength(2)
  })
})

describe('camera controller: calibration', () => {
  it('asks the page to calibrate only while running', () => {
    const s = setup()
    s.c.calibrate()
    expect(s.windows).toHaveLength(0)
    s.c.update(goodUpdate)
    s.c.calibrate()
    expect(s.windows[0].sent).toEqual(['camera:calibrate'])
    expect(s.statuses.at(-1)?.calibrating).toBe(true)
  })
  it('saves valid medians with the time', () => {
    const s = setup()
    s.c.update(goodUpdate)
    s.c.calibrate()
    s.c.onCalibration({ pitch: 2, faceY: 0.5, iris: 0.04 })
    expect(s.service.setCalibration).toHaveBeenCalledWith({
      pitch: 2,
      faceY: 0.5,
      iris: 0.04,
      at: 42
    })
    expect(s.statuses.at(-1)?.calibrating).toBe(false)
  })
  it('drops bad medians and ends calibrating', () => {
    const s = setup()
    s.c.update(goodUpdate)
    s.c.calibrate()
    for (const bad of [
      { pitch: NaN, faceY: 0.5, iris: 0.04 },
      { pitch: 0, faceY: 0.5, iris: 0 },
      null,
      'x'
    ])
      s.c.onCalibration(bad)
    expect(s.service.setCalibration).not.toHaveBeenCalled()
    expect(s.statuses.at(-1)?.calibrating).toBe(false)
  })
})

describe('resolveAsset', () => {
  const root = '/app/out/renderer'
  it('maps a page path inside the renderer folder', () => {
    expect(resolveAsset(root, '/camera.html')).toBe('/app/out/renderer/camera.html')
    expect(resolveAsset(root, '/mediapipe/vision_wasm_internal.wasm')).toBe(
      '/app/out/renderer/mediapipe/vision_wasm_internal.wasm'
    )
  })
  it.each(['/../main/index.js', '/%2e%2e/main/index.js', '/models/../../preload/camera.js', '/'])(
    'refuses %s',
    (p) => {
      expect(resolveAsset(root, p)).toBeNull()
    }
  )
})
