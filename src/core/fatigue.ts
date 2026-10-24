/**
 * Fatigue signals from the mouse and activity, without a keyboard hook: how far the cursor
 * travels per active second, against the user's own usual pace.
 */

/** One sample every 2 s: cursor position (points) and system idle time (seconds). */
export interface Sample {
  x: number
  y: number
  idle: number
}

/** One minute folded: seconds the cursor moved, and how far it went (points). */
export interface MinuteStat {
  active: number
  path: number
}

const SAMPLE_SEC = 2
/** A minute counts when it was at least this active (seconds). */
const ACTIVE_MINUTE_SEC = 30
/** How many active minutes the comparison looks at. */
const WINDOW_MIN = 20
/** Slowing down: the recent pace is at or below this share of the usual one. */
const SLOW_RATIO = 0.65
/** The baseline moves a seventh of the way to each day's pace (about a week of memory). */
const BASELINE_DAYS = 7

export function minuteOf(samples: Sample[]): MinuteStat {
  let active = 0
  let path = 0
  samples.forEach((s, k) => {
    if (k === 0) return
    const dx = s.x - samples[k - 1].x
    const dy = s.y - samples[k - 1].y
    // Only seconds with the cursor moving count: typing would otherwise read as a slow mouse.
    if (s.idle < SAMPLE_SEC && (dx !== 0 || dy !== 0)) active += SAMPLE_SEC
    path += Math.hypot(dx, dy)
  })
  return { active, path }
}

const rate = (minutes: MinuteStat[]): number | null => {
  const active = minutes.reduce((sum, m) => sum + m.active, 0)
  return active === 0 ? null : minutes.reduce((sum, m) => sum + m.path, 0) / active
}

/** Cursor points per active second over the day's active minutes; null with none. */
export function dayRate(minutes: MinuteStat[]): number | null {
  return rate(minutes.filter((m) => m.active >= ACTIVE_MINUTE_SEC))
}

/** True when the last 20 active minutes run 35% or more below the usual pace. */
export function slowing(minutes: MinuteStat[], baseline: number | null): boolean {
  if (baseline === null || baseline <= 0) return false
  const recent = minutes.filter((m) => m.active >= ACTIVE_MINUTE_SEC).slice(-WINDOW_MIN)
  if (recent.length < WINDOW_MIN) return false
  const r = rate(recent)
  return r !== null && r <= SLOW_RATIO * baseline
}

export function updateBaseline(prev: number | null, today: number | null): number | null {
  if (today === null) return prev
  if (prev === null) return today
  return prev + (today - prev) / BASELINE_DAYS
}
