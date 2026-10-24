import {
  calibrate,
  foldMinute,
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
        o.onMinute(foldMinute(minute, o.now()))
        minute = []
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
