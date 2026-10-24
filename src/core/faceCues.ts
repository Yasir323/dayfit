/** One camera frame, reduced to the few numbers the cues need. Never stored. */
export interface FrameCue {
  /** Frame time, ms. */
  t: number
  present: boolean
  eyesClosed: boolean
  /** MediaPipe `jawOpen` score, 0–1. */
  jaw: number
  /** Head pitch, degrees. */
  pitch: number
  /** Nose tip height in the frame, 0 (top) – 1 (bottom). */
  faceY: number
  /** Mean iris width in frame widths; grows as the face comes closer. */
  iris: number
}

/** One minute of frames: the only camera data Dayfit keeps. */
export interface MinuteScore {
  /** End of the minute, epoch ms. */
  at: number
  /** Share of the minute with a face in view, 0–1. */
  present: number
  /** Blinks per minute of face time. */
  blinks: number
  /** Share of face time with the eyes closed. */
  perclos: number
  yawns: number
  pitch: number
  faceY: number
  iris: number
}

/** "Sitting well", recorded once from the Settings button. */
export interface Calibration {
  pitch: number
  faceY: number
  iris: number
  at: number
}

export type CameraKind = 'dry-eyes' | 'drowsy' | 'slouch' | 'screen-distance'

export interface CameraState {
  /** When each cue last fired, epoch ms. */
  lastAt: Partial<Record<CameraKind, number>>
}

export const EMPTY_CAMERA_STATE: CameraState = { lastAt: {} }

export interface CameraCues {
  dryEyes: boolean
  drowsy: boolean
  posture: boolean
  distance: boolean
}

export interface Blendshape {
  categoryName: string
  score: number
}

export interface Point {
  x: number
  y: number
  z?: number
}

export const BLINK_CLOSED = 0.5
export const YAWN_JAW = 0.6
export const YAWN_MIN_MS = 1500
/** A minute with a face in view less than this is "away" and ignored by every cue. */
export const PRESENT_MIN = 0.5
/** Normal is about 15–20 a minute; staring at a screen drops it. */
export const DRY_BLINKS = 8
export const DRY_WINDOW = 10
export const PERCLOS_DROWSY = 0.15
export const YAWNS_DROWSY = 3
export const YAWN_WINDOW_MIN = 15
export const SLOUCH_Y = 0.08
export const SLOUCH_PITCH = 15
export const CLOSE_IRIS = 1.3
export const CAMERA_COOLDOWN_MIN = 30
export const STALE_LOW = 0.6
export const STALE_HIGH = 1.6
/** The short rules look at this many of the latest present minutes… */
const SHORT_WINDOW = 5
/** …and the posture and distance ones need this many of them. */
const MOST_OF_SHORT = 4
const DROWSY_OF_SHORT = 3
/** Minutes older than this many window lengths don't count (back after a long gap). */
const RECENT_FACTOR = 2
/** Gaps longer than this between frames (a stall) count as this long. */
const MAX_FRAME_GAP_MS = 500
const MIN = 60_000
const EPS = 1e-9

const NOSE_TIP = 1
const RIGHT_IRIS = [469, 471] as const
const LEFT_IRIS = [474, 476] as const

const median = (xs: number[]): number => {
  if (xs.length === 0) return 0
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y)

/**
 * Reduces MediaPipe's output for one frame. `matrix` is the facial transformation matrix as a
 * row-major 4×4; `face` is null when no face was found.
 */
export function frameCue(
  t: number,
  face: { blendshapes: Blendshape[]; matrix: number[]; landmarks: Point[] } | null
): FrameCue {
  if (!face) return { t, present: false, eyesClosed: false, jaw: 0, pitch: 0, faceY: 0, iris: 0 }
  const score = (name: string): number =>
    face.blendshapes.find((b) => b.categoryName === name)?.score ?? 0
  const m = face.matrix
  const lm = face.landmarks
  const irisOf = ([a, b]: readonly [number, number]): number =>
    lm[a] && lm[b] ? dist(lm[a], lm[b]) : 0
  return {
    t,
    present: true,
    eyesClosed: (score('eyeBlinkLeft') + score('eyeBlinkRight')) / 2 > BLINK_CLOSED,
    jaw: score('jawOpen'),
    pitch: (Math.atan2(m[9] ?? 0, m[10] ?? 1) * 180) / Math.PI,
    faceY: lm[NOSE_TIP]?.y ?? 0,
    iris: (irisOf(RIGHT_IRIS) + irisOf(LEFT_IRIS)) / 2
  }
}

/** How long each frame stands for: the typical gap between frames. */
const frameMs = (frames: FrameCue[]): number => {
  const gaps: number[] = []
  for (let i = 1; i < frames.length; i++) gaps.push(frames[i].t - frames[i - 1].t)
  const g = median(gaps.filter((x) => x > 0))
  return Math.min(MAX_FRAME_GAP_MS, g > 0 ? g : 100)
}

/** Folds a minute of frames into its score. */
export function foldMinute(frames: FrameCue[], at: number): MinuteScore {
  const seen = frames.filter((f) => f.present)
  if (seen.length === 0)
    return { at, present: 0, blinks: 0, perclos: 0, yawns: 0, pitch: 0, faceY: 0, iris: 0 }
  const step = frameMs(frames)
  let blinks = 0
  let yawns = 0
  let wasClosed = false
  let jawRun = 0
  const endJaw = (): void => {
    if (jawRun * step >= YAWN_MIN_MS) yawns++
    jawRun = 0
  }
  for (const f of frames) {
    if (!f.present) {
      wasClosed = false
      endJaw()
      continue
    }
    if (f.eyesClosed && !wasClosed) blinks++
    wasClosed = f.eyesClosed
    if (f.jaw > YAWN_JAW) jawRun++
    else endJaw()
  }
  endJaw()
  const faceMin = (seen.length * step) / MIN
  return {
    at,
    present: seen.length / frames.length,
    blinks: Math.round(blinks / faceMin),
    perclos: seen.filter((f) => f.eyesClosed).length / seen.length,
    yawns,
    pitch: median(seen.map((f) => f.pitch)),
    faceY: median(seen.map((f) => f.faceY)),
    iris: median(seen.map((f) => f.iris))
  }
}

/** The "sitting well" medians, or null when the face was missing most of the time. */
export function calibrate(frames: FrameCue[], at: number): Calibration | null {
  const seen = frames.filter((f) => f.present)
  if (seen.length === 0 || seen.length / frames.length < PRESENT_MIN) return null
  return {
    pitch: median(seen.map((f) => f.pitch)),
    faceY: median(seen.map((f) => f.faceY)),
    iris: median(seen.map((f) => f.iris)),
    at
  }
}

const isPresent = (m: MinuteScore): boolean => m.present >= PRESENT_MIN

/**
 * False when today's first present minutes put the face at a very different size than the
 * calibration: another desk or camera, so posture and distance would be guesses.
 */
export function calibrationFits(minutes: MinuteScore[], cal: Calibration): boolean {
  const first = minutes.filter(isPresent).slice(0, DRY_WINDOW)
  if (first.length < DRY_WINDOW || cal.iris <= 0) return true
  const ratio = median(first.map((m) => m.iris)) / cal.iris
  return ratio >= STALE_LOW && ratio <= STALE_HIGH
}

const slouched = (m: MinuteScore, cal: Calibration): boolean =>
  m.faceY - cal.faceY >= SLOUCH_Y - EPS || Math.abs(m.pitch - cal.pitch) >= SLOUCH_PITCH - EPS

const tooClose = (m: MinuteScore, cal: Calibration): boolean =>
  cal.iris > 0 && m.iris / cal.iris >= CLOSE_IRIS - EPS

const COPY: Record<CameraKind, { title: string; body: string }> = {
  'dry-eyes': {
    title: 'Blink',
    body: "You've been staring — blink a few times and look 20 ft away for 20 s"
  },
  drowsy: { title: 'You look tired', body: 'You look tired — take a short break' },
  slouch: { title: 'Posture', body: 'Sit back up — shoulders down, screen at eye level' },
  'screen-distance': {
    title: 'Too close',
    body: "You're close to the screen — lean back to arm's length"
  }
}

/** One camera cue at most: the first due one whose cooldown has passed. */
export function stepCamera(i: {
  minutes: MinuteScore[]
  cal: Calibration | null
  cues: CameraCues
  nowMs: number
  state: CameraState
  coffeeOk: boolean
}): { event: { kind: CameraKind; title: string; body: string } | null; state: CameraState } {
  const { nowMs, cues } = i
  const present = i.minutes.filter(isPresent)
  const since = (windowMin: number): MinuteScore[] =>
    present.filter((m) => m.at > nowMs - windowMin * RECENT_FACTOR * MIN)
  const last = (n: number): MinuteScore[] => since(n).slice(-n)
  const cal = i.cal && calibrationFits(i.minutes, i.cal) ? i.cal : null

  const due: Record<CameraKind, () => boolean> = {
    'dry-eyes': () => {
      const w = last(DRY_WINDOW)
      return cues.dryEyes && w.length === DRY_WINDOW && median(w.map((m) => m.blinks)) < DRY_BLINKS
    },
    drowsy: () => {
      if (!cues.drowsy) return false
      const w = last(SHORT_WINDOW)
      const closed = w.filter((m) => m.perclos >= PERCLOS_DROWSY - EPS).length
      const yawns = present
        .filter((m) => m.at > nowMs - YAWN_WINDOW_MIN * MIN)
        .reduce((n, m) => n + m.yawns, 0)
      return closed >= DROWSY_OF_SHORT || yawns >= YAWNS_DROWSY
    },
    slouch: () =>
      cues.posture &&
      cal !== null &&
      last(SHORT_WINDOW).filter((m) => slouched(m, cal)).length >= MOST_OF_SHORT,
    'screen-distance': () =>
      cues.distance &&
      cal !== null &&
      last(SHORT_WINDOW).filter((m) => tooClose(m, cal)).length >= MOST_OF_SHORT
  }

  const order: CameraKind[] = ['dry-eyes', 'drowsy', 'slouch', 'screen-distance']
  for (const kind of order) {
    const lastAt = i.state.lastAt[kind]
    if (lastAt !== undefined && nowMs - lastAt < CAMERA_COOLDOWN_MIN * MIN) continue
    if (!due[kind]()) continue
    const copy = COPY[kind]
    const body = kind === 'drowsy' && i.coffeeOk ? `${copy.body}, or a coffee` : copy.body
    return {
      event: { kind, title: copy.title, body },
      state: { lastAt: { ...i.state.lastAt, [kind]: nowMs } }
    }
  }
  return { event: null, state: i.state }
}

/** The day's camera totals for the summary. */
export function summarizeCamera(
  minutes: MinuteScore[],
  cal: Calibration | null
): { minutes: number; blinkMedian: number; yawns: number; slouchMin: number; closeMin: number } {
  const present = minutes.filter(isPresent)
  return {
    minutes: present.length,
    blinkMedian: median(present.map((m) => m.blinks)),
    yawns: present.reduce((n, m) => n + m.yawns, 0),
    slouchMin: cal ? present.filter((m) => slouched(m, cal)).length : 0,
    closeMin: cal ? present.filter((m) => tooClose(m, cal)).length : 0
  }
}

const SCORE_FIELDS = [
  'at',
  'present',
  'blinks',
  'perclos',
  'yawns',
  'pitch',
  'faceY',
  'iris'
] as const

/** Checks a minute sent by the camera page before it is stored. */
export function isMinuteScore(v: unknown): v is MinuteScore {
  if (typeof v !== 'object' || v === null || Array.isArray(v)) return false
  const o = v as Record<string, unknown>
  for (const k of SCORE_FIELDS) if (typeof o[k] !== 'number' || !Number.isFinite(o[k])) return false
  const m = o as unknown as MinuteScore
  return (
    m.present >= 0 &&
    m.present <= 1 &&
    m.perclos >= 0 &&
    m.perclos <= 1 &&
    m.blinks >= 0 &&
    m.yawns >= 0 &&
    m.iris >= 0 &&
    m.at > 0
  )
}
