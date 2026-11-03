import { describe, expect, it, vi } from 'vitest'
import { createCollector, BUFFER_CAP } from '../../src/renderer/camera/collector'
import { foldMinute, type FrameCue, type MinuteScore } from '../../src/core/faceCues'

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

describe('collector: a yawn across a minute boundary', () => {
  it('is counted once, in the minute where it ends', () => {
    const minutes: MinuteScore[] = []
    const c = createCollector({
      now: () => 0,
      onMinute: (m) => minutes.push(m),
      onCalibration: () => {}
    })
    // 2 minutes of frames at 10 fps; a 2 s yawn from 59 s to 61 s.
    for (let i = 0; i < 1200; i++) {
      const t = i * 100
      c.push({
        t,
        present: true,
        eyesClosed: false,
        jaw: t >= 59_000 && t < 61_000 ? 0.9 : 0.1,
        pitch: 0,
        faceY: 0.5,
        iris: 0.04
      })
    }
    expect(minutes.map((m) => m.yawns).reduce((a, b) => a + b, 0)).toBe(1)
  })
})
