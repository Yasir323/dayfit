import { describe, expect, it, vi } from 'vitest'
import { createCollector, BUFFER_CAP } from '../../src/renderer/camera/collector'
import { foldMinute, type FrameCue } from '../../src/core/faceCues'

const frame = (t: number, p: Partial<FrameCue> = {}): FrameCue => ({
  t,
  present: true,
  eyesClosed: false,
  jaw: 0,
  pitch: 1,
  faceY: 0.5,
  iris: 0.04,
  ...p
})

const make = (): {
  c: ReturnType<typeof createCollector>
  onMinute: ReturnType<typeof vi.fn>
  onCalibration: ReturnType<typeof vi.fn>
} => {
  const onMinute = vi.fn()
  const onCalibration = vi.fn()
  const c = createCollector({ now: () => 5000, onMinute, onCalibration })
  return { c, onMinute, onCalibration }
}

describe('camera collector', () => {
  it('folds a minute of frames into one score', () => {
    const { c, onMinute } = make()
    const fs = Array.from({ length: 600 }, (_, i) => frame(i * 100, { eyesClosed: i % 50 < 2 }))
    for (const f of fs) c.push(f)
    expect(onMinute).toHaveBeenCalledTimes(1)
    expect(onMinute).toHaveBeenCalledWith(foldMinute(fs, 5000))
  })
  it('emits one score per minute', () => {
    const { c, onMinute } = make()
    for (let i = 0; i < 1200; i++) c.push(frame(i * 100))
    expect(onMinute).toHaveBeenCalledTimes(2)
  })
  it('calibrates from 5 s of frames', () => {
    const { c, onCalibration } = make()
    c.startCalibration()
    for (let i = 0; i < 50; i++) c.push(frame(i * 100))
    expect(onCalibration).toHaveBeenCalledTimes(1)
    expect(onCalibration).toHaveBeenCalledWith({ pitch: 1, faceY: 0.5, iris: 0.04, at: 5000 })
  })
  it('reports a failed calibration when no face was seen', () => {
    const { c, onCalibration } = make()
    c.startCalibration()
    for (let i = 0; i < 50; i++) c.push(frame(i * 100, { present: false }))
    expect(onCalibration).toHaveBeenCalledWith(null)
  })
  it('never holds more than the cap', () => {
    const { c } = make()
    for (let i = 0; i < 2000; i++) c.push(frame(0))
    expect(c.buffered()).toBeLessThanOrEqual(BUFFER_CAP)
  })
})

describe('camera collector: starved minutes', () => {
  it('scores a minute with too few frames as away', () => {
    const { c, onMinute } = make()
    // A frozen feed: only every 4th frame is new (2.5 fps).
    for (let i = 0; i < 600; i += 4) c.push(frame(i * 100))
    c.push(frame(60_000))
    expect(onMinute).toHaveBeenCalledTimes(1)
    expect(onMinute.mock.calls[0][0]).toMatchObject({ present: 0, blinks: 0, perclos: 0 })
  })
})
