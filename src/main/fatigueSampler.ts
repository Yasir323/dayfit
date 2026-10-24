import { dayRate, minuteOf, type MinuteStat, type Sample } from '../core/fatigue'
import type { DateStr } from '../core/types'

/** Samples per folded minute (one every 2 s). */
const PER_MINUTE = 30
/** Recent minutes kept for the slowing-down check. */
const KEEP_MINUTES = 30

/**
 * Collects cursor/idle samples in memory only and folds them into per-minute stats. Nothing raw
 * leaves this object; the service sees minute totals and the day's pace.
 */
export function createFatigueSampler(
  cursor: () => { x: number; y: number },
  idleSec: () => number
): {
  sample(today: DateStr): void
  snapshot(today: DateStr): { minutes: MinuteStat[]; todayRate: number | null }
} {
  let samples: Sample[] = []
  let recent: MinuteStat[] = []
  let day: { date: DateStr; minutes: MinuteStat[] } | null = null
  return {
    sample(today) {
      const p = cursor()
      samples.push({ x: p.x, y: p.y, idle: idleSec() })
      if (samples.length < PER_MINUTE) return
      const m = minuteOf(samples)
      samples = []
      recent = [...recent, m].slice(-KEEP_MINUTES)
      if (day?.date !== today) day = { date: today, minutes: [] }
      day.minutes.push(m)
    },
    snapshot(today) {
      return {
        minutes: recent,
        todayRate: day?.date === today ? dayRate(day.minutes) : null
      }
    }
  }
}
