import { describe, expect, it } from 'vitest'
import {
  calibrate,
  calibrationFits,
  foldMinute,
  frameCue,
  isMinuteScore,
  stepCamera,
  summarizeCamera,
  type Calibration,
  type CameraCues,
  type FrameCue,
  type MinuteScore,
  type Point
} from '../../src/core/faceCues'

const ALL_CUES: CameraCues = { dryEyes: true, drowsy: true, posture: true, distance: true }
const T0 = new Date(2026, 9, 26, 10, 0).getTime()
const MIN = 60_000

const frame = (p: Partial<FrameCue> = {}): FrameCue => ({
  t: 0,
  present: true,
  eyesClosed: false,
  jaw: 0,
  pitch: 0,
  faceY: 0.5,
  iris: 0.04,
  ...p
})
/** `n` frames at 100 ms steps; `p(i)` customises frame i. */
const frames = (n: number, p: (i: number) => Partial<FrameCue> = () => ({})): FrameCue[] =>
  Array.from({ length: n }, (_, i) => frame({ t: i * 100, ...p(i) }))

const minute = (i: number, p: Partial<MinuteScore> = {}): MinuteScore => ({
  at: T0 + i * MIN,
  present: 1,
  blinks: 15,
  perclos: 0.03,
  yawns: 0,
  pitch: 0,
  faceY: 0.5,
  iris: 0.04,
  ...p
})
const run = (n: number, p: (i: number) => Partial<MinuteScore> = () => ({})): MinuteScore[] =>
  Array.from({ length: n }, (_, i) => minute(i, p(i)))

const cal: Calibration = { pitch: 0, faceY: 0.5, iris: 0.04, at: T0 - 86_400_000 }
const step = (
  minutes: MinuteScore[],
  o: Partial<Parameters<typeof stepCamera>[0]> = {}
): ReturnType<typeof stepCamera> =>
  stepCamera({
    minutes,
    cal,
    cues: ALL_CUES,
    nowMs: (minutes.at(-1)?.at ?? T0) + MIN,
    state: { lastAt: {} },
    coffeeOk: false,
    ...o
  })

/** A face mesh with landmark 1 at `noseY` and irises `d` wide. */
const mesh = (noseY: number, d: number): Point[] => {
  const pts: Point[] = Array.from({ length: 478 }, () => ({ x: 0.5, y: 0.5 }))
  pts[1] = { x: 0.5, y: noseY }
  pts[469] = { x: 0.4, y: 0.4 }
  pts[471] = { x: 0.4 + d, y: 0.4 }
  pts[474] = { x: 0.6, y: 0.4 }
  pts[476] = { x: 0.6 + d, y: 0.4 }
  return pts
}
/** Row-major 4×4 rotation about the x axis by `deg`. */
const rotX = (deg: number): number[] => {
  const r = (deg * Math.PI) / 180
  const c = Math.cos(r)
  const s = Math.sin(r)
  return [1, 0, 0, 0, 0, c, -s, 0, 0, s, c, 0, 0, 0, 0, 1]
}
const shapes = (
  blinkL: number,
  blinkR: number,
  jaw = 0
): { categoryName: string; score: number }[] => [
  { categoryName: 'eyeBlinkLeft', score: blinkL },
  { categoryName: 'eyeBlinkRight', score: blinkR },
  { categoryName: 'jawOpen', score: jaw }
]

describe('frameCue', () => {
  it('marks a frame with no face absent', () => {
    expect(frameCue(5, null)).toMatchObject({ t: 5, present: false })
  })
  it('reads eyes, jaw, pitch, nose and iris', () => {
    const f = frameCue(5, {
      blendshapes: shapes(0.7, 0.6, 0.3),
      matrix: rotX(20),
      landmarks: mesh(0.62, 0.05)
    })
    expect(f.present).toBe(true)
    expect(f.eyesClosed).toBe(true)
    expect(f.jaw).toBe(0.3)
    expect(f.pitch).toBeCloseTo(20, 5)
    expect(f.faceY).toBe(0.62)
    expect(f.iris).toBeCloseTo(0.05, 10)
  })
  it('counts eyes open below the threshold', () => {
    const f = frameCue(0, {
      blendshapes: shapes(0.4, 0.5),
      matrix: rotX(0),
      landmarks: mesh(0.5, 0.04)
    })
    expect(f.eyesClosed).toBe(false)
  })
})

describe('foldMinute', () => {
  it('counts blinks and the closed fraction', () => {
    // 12 blinks of 2 frames each, spread over 600 frames.
    const m = foldMinute(
      frames(600, (i) => ({ eyesClosed: i % 50 < 2 })),
      T0
    )
    expect(m.blinks).toBe(12)
    expect(m.perclos).toBeCloseTo(0.04, 5)
    expect(m.present).toBe(1)
    expect(m.at).toBe(T0)
  })
  it('scales blinks to the time a face was there', () => {
    const fs = frames(600, (i) => (i >= 300 ? { present: false } : { eyesClosed: i % 50 < 2 }))
    const m = foldMinute(fs, T0)
    expect(m.present).toBe(0.5)
    expect(m.blinks).toBe(12)
  })
  it('counts a yawn only when the jaw stays open 1.5 s', () => {
    const yawn = foldMinute(
      frames(600, (i) => ({ jaw: i >= 100 && i < 116 ? 0.7 : 0 })),
      T0
    )
    expect(yawn.yawns).toBe(1)
    const short = foldMinute(
      frames(600, (i) => ({ jaw: i >= 100 && i < 114 ? 0.7 : 0 })),
      T0
    )
    expect(short.yawns).toBe(0)
  })
  it('takes medians over present frames only', () => {
    const fs = frames(5, (i) =>
      i === 4
        ? { present: false, faceY: 9, pitch: 9, iris: 9 }
        : { faceY: i / 10, pitch: i, iris: i }
    )
    const m = foldMinute(fs, T0)
    expect(m.faceY).toBeCloseTo(0.15, 10)
    expect(m.pitch).toBe(1.5)
    expect(m.iris).toBe(1.5)
  })
  it('scores an empty minute as all zero', () => {
    expect(
      foldMinute(
        frames(10, () => ({ present: false })),
        T0
      )
    ).toEqual({
      at: T0,
      present: 0,
      blinks: 0,
      perclos: 0,
      yawns: 0,
      pitch: 0,
      faceY: 0,
      iris: 0
    })
  })
})

describe('calibrate', () => {
  it('records the medians', () => {
    const c = calibrate(
      frames(50, (i) => ({ pitch: i % 2 ? 2 : 4, faceY: 0.4, iris: 0.05 })),
      T0
    )
    expect(c).toEqual({ pitch: 3, faceY: 0.4, iris: 0.05, at: T0 })
  })
  it('gives up when the face was mostly missing', () => {
    expect(
      calibrate(
        frames(50, (i) => ({ present: i < 20 })),
        T0
      )
    ).toBeNull()
  })
})

describe('calibrationFits', () => {
  it('fits a similar setup', () => {
    expect(
      calibrationFits(
        run(10, () => ({ iris: 0.06 })),
        cal
      )
    ).toBe(true)
  })
  it('does not fit a very different setup', () => {
    expect(
      calibrationFits(
        run(10, () => ({ iris: 0.068 })),
        cal
      )
    ).toBe(false)
  })
  it('judges only minutes after the calibration', () => {
    const morning = run(10, () => ({ iris: 0.1 })) // another setup, before recalibrating
    const recal = { ...cal, at: morning[9].at + 1 }
    const afternoon = run(10, (i) => ({ at: recal.at + (i + 1) * MIN, iris: 0.041 }))
    expect(calibrationFits([...morning, ...afternoon], recal)).toBe(true)
    expect(calibrationFits(morning, recal)).toBe(true) // nothing after it yet
  })
  it('is not judged before 10 present minutes', () => {
    expect(
      calibrationFits(
        run(9, () => ({ iris: 0.1 })),
        cal
      )
    ).toBe(true)
  })
})

describe('stepCamera rules', () => {
  it('dry eyes: fires at median 7 blinks over 10 present minutes', () => {
    expect(step(run(10, () => ({ blinks: 7 }))).event?.kind).toBe('dry-eyes')
    expect(step(run(10, () => ({ blinks: 8 }))).event).toBeNull()
    expect(step(run(9, () => ({ blinks: 2 }))).event).toBeNull()
  })
  it('dry eyes: skips away minutes rather than counting them', () => {
    const ms = run(12, (i) =>
      i < 2 ? { blinks: 7 } : i < 4 ? { present: 0.2, blinks: 0 } : { blinks: 7 }
    )
    // 10 present minutes, all at 7.
    expect(step(ms).event?.kind).toBe('dry-eyes')
    const fewer = run(10, (i) => (i < 2 ? { present: 0.2, blinks: 0 } : { blinks: 7 }))
    expect(step(fewer).event).toBeNull()
  })
  it('drowsy: eyes closed in 3 of the last 5 minutes', () => {
    expect(step(run(5, (i) => ({ perclos: i < 3 ? 0.15 : 0.02 }))).event?.kind).toBe('drowsy')
    expect(step(run(5, (i) => ({ perclos: i < 2 ? 0.2 : 0.02 }))).event).toBeNull()
  })
  it('drowsy: 3 yawns within 15 minutes', () => {
    const ms = run(15, (i) => ({ yawns: i === 1 || i === 7 || i === 14 ? 1 : 0 }))
    expect(step(ms).event?.kind).toBe('drowsy')
    const spread = run(20, (i) => ({ yawns: i === 1 || i === 10 || i === 19 ? 1 : 0 }))
    expect(step(spread).event).toBeNull()
  })
  it('drowsy: offers coffee only when allowed', () => {
    const ms = run(5, () => ({ perclos: 0.3 }))
    expect(step(ms).event?.body).not.toContain('coffee')
    expect(step(ms, { coffeeOk: true }).event?.body).toContain('or a coffee')
  })
  it('slouch: nose low or head tilted in 4 of 5', () => {
    expect(step(run(5, (i) => ({ faceY: i < 4 ? 0.58 : 0.5 }))).event?.kind).toBe('slouch')
    expect(step(run(5, (i) => ({ pitch: i < 4 ? 15 : 0 }))).event?.kind).toBe('slouch')
    expect(step(run(5, (i) => ({ pitch: i < 4 ? -15 : 0 }))).event?.kind).toBe('slouch')
    expect(step(run(5, (i) => ({ faceY: i < 3 ? 0.6 : 0.5 }))).event).toBeNull()
  })
  it('slouch and distance need a calibration that fits', () => {
    const slouched = run(10, () => ({ faceY: 0.6, iris: 0.06 }))
    expect(step(slouched, { cal: null }).event).toBeNull()
    const moved = run(10, () => ({ faceY: 0.6, iris: 0.07 }))
    expect(step(moved).event).toBeNull()
  })
  it('screen distance: face close in 4 of 5', () => {
    expect(step(run(5, (i) => ({ iris: i < 4 ? 0.052 : 0.04 }))).event?.kind).toBe(
      'screen-distance'
    )
    expect(step(run(5, (i) => ({ iris: i < 3 ? 0.06 : 0.04 }))).event).toBeNull()
  })
  it('waits 30 minutes before the same cue again', () => {
    const ms = run(5, () => ({ perclos: 0.3 }))
    const first = step(ms)
    const nowMs = ms[4].at + MIN
    expect(first.state.lastAt.drowsy).toBe(nowMs)
    const later = (min: number): MinuteScore[] => ms.map((m) => ({ ...m, at: m.at + min * MIN }))
    expect(step(later(29), { state: first.state }).event).toBeNull()
    expect(step(later(30), { state: first.state }).event?.kind).toBe('drowsy')
  })
  it('gives one cue per step, in order', () => {
    const ms = run(10, () => ({ blinks: 5, perclos: 0.3, faceY: 0.6 }))
    expect(step(ms).event?.kind).toBe('dry-eyes')
    const after = step(ms).state
    expect(step(ms, { state: after }).event?.kind).toBe('drowsy')
  })
  it('never fires a cue that is turned off', () => {
    const ms = run(10, () => ({ blinks: 5 }))
    expect(step(ms, { cues: { ...ALL_CUES, dryEyes: false } }).event).toBeNull()
  })
  it('ignores minutes where no one was there', () => {
    expect(step(run(10, () => ({ present: 0.3, blinks: 0, perclos: 0.9 }))).event).toBeNull()
  })
})

describe('summarizeCamera', () => {
  it('sums the day', () => {
    const ms = [
      ...run(3, () => ({ blinks: 10, yawns: 1, faceY: 0.6 })),
      minute(3, { blinks: 20, iris: 0.06 }),
      minute(4, { present: 0.1 })
    ]
    expect(summarizeCamera(ms, cal)).toEqual({
      minutes: 4,
      blinkMedian: 10,
      yawns: 3,
      slouchMin: 3,
      closeMin: 1
    })
  })
  it('counts no slouch or distance without a calibration', () => {
    const s = summarizeCamera(
      run(3, () => ({ faceY: 0.9, iris: 1 })),
      null
    )
    expect(s.slouchMin).toBe(0)
    expect(s.closeMin).toBe(0)
  })
})

describe('isMinuteScore', () => {
  it('accepts a valid score', () => {
    expect(isMinuteScore(minute(0))).toBe(true)
  })
  it.each<[string, unknown]>([
    ['missing field', { ...minute(0), iris: undefined }],
    ['NaN', { ...minute(0), blinks: NaN }],
    ['Infinity', { ...minute(0), pitch: Infinity }],
    ['present above 1', { ...minute(0), present: 2 }],
    ['negative count', { ...minute(0), yawns: -1 }],
    ['impossible blink count', { ...minute(0), blinks: 601 }],
    ['impossible yawn count', { ...minute(0), yawns: 61 }],
    ['not an object', 'hello'],
    ['null', null],
    ['array', [minute(0)]]
  ])('rejects %s', (_n, v) => {
    expect(isMinuteScore(v)).toBe(false)
  })
})
