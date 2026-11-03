import {
  calibrate,
  foldMinute,
  YAWN_JAW,
  type Calibration,
  type FrameCue,
  type MinuteScore
} from '../../core/faceCues'

export const FPS = 10
const FRAME_MS = 1000 / FPS
const MINUTE_MS = 60_000
const CALIBRATION_MS = 5_000
/** A little over a minute of frames; older ones are dropped if minutes stop closing. */
export const BUFFER_CAP = FPS * 70
/** A minute with fewer frames than this (a frozen or starved feed) is scored as away. */
export const MIN_FRAMES = (FPS * 60) / 2
/** An open mouth at a minute's end moves to the next minute if it is no longer than this. */
const YAWN_CARRY = FPS * 10

/** Where a trailing open-mouth run starts, so a yawn isn't split across two minutes. */
function yawnTail(fs: FrameCue[]): number {
  let i = fs.length
  while (i > 0 && fs[i - 1].present && fs[i - 1].jaw >= YAWN_JAW) i--
  return fs.length - i <= YAWN_CARRY ? i : fs.length
}

/** Groups frames into minute scores (and a calibration on request). Frames never leave. */
export function createCollector(o: {
  now(): number
  onMinute(m: MinuteScore): void
  onCalibration(c: Calibration | null): void
}): { push(f: FrameCue): void; startCalibration(): void; buffered(): number } {
  let minute: FrameCue[] = []
  let calib: FrameCue[] | null = null
  // A run is complete once its frames cover the span, counting the last frame's own length.
  const spans = (fs: FrameCue[], ms: number): boolean =>
    fs.length > 0 && fs[fs.length - 1].t - fs[0].t >= ms - FRAME_MS
  return {
    push(f) {
      minute.push(f)
      if (minute.length > BUFFER_CAP) minute = minute.slice(-BUFFER_CAP)
      if (spans(minute, MINUTE_MS)) {
        const cut = yawnTail(minute)
        const done = minute.slice(0, cut)
        o.onMinute(foldMinute(done.length >= MIN_FRAMES ? done : [], o.now()))
        minute = minute.slice(cut)
      }
      if (calib) {
        calib.push(f)
        if (spans(calib, CALIBRATION_MS) || calib.length > BUFFER_CAP) {
          o.onCalibration(calibrate(calib, o.now()))
          calib = null
        }
      }
    },
    startCalibration() {
      calib = []
    },
    buffered: () => minute.length
  }
}
