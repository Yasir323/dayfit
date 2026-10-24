import type { DaySummary } from './summary'
import { addDays } from './time'
import type { DateStr, Minutes } from './types'

const ENERGY_DAYS = 14
const ENERGY_MIN_CHECKINS = 6
const ENERGY_MIN_HOURS = 2
const RISK_DAYS = 10
const FEW_BREAKS = 3
const LOW_MOOD = 2.5
const STREAK_BREAKS = 3

/**
 * The hour of day (its start) with the lowest average check-in score over the last 14 days, or
 * null with too little data (fewer than 6 check-ins, or all in one hour).
 */
export function energyLow(
  moods: Record<DateStr, { at: Minutes; score: number }[]>,
  today: DateStr
): Minutes | null {
  const from = addDays(today, -(ENERGY_DAYS - 1))
  const byHour = new Map<Minutes, number[]>()
  let count = 0
  for (const [date, list] of Object.entries(moods)) {
    if (date < from || date > today) continue
    for (const m of list) {
      const hour = Math.floor(m.at / 60) * 60
      byHour.set(hour, [...(byHour.get(hour) ?? []), m.score])
      count++
    }
  }
  if (count < ENERGY_MIN_CHECKINS || byHour.size < ENERGY_MIN_HOURS) return null
  let low: { hour: Minutes; avg: number } | null = null
  for (const [hour, scores] of [...byHour].sort((a, b) => a[0] - b[0])) {
    const avg = scores.reduce((a, b) => a + b, 0) / scores.length
    if (!low || avg < low.avg) low = { hour, avg }
  }
  return low ? low.hour : null
}

export interface BurnoutRisk {
  level: 'Low' | 'Watch' | 'High'
  /** Days past working hours. */
  late: number
  /** Days with fewer than 3 breaks. */
  fewBreaks: number
  /** Days with an average mood of 2.5 or less. */
  lowMood: number
}

/** A rough warning from the last 10 saved days: a day with any signal counts once. */
export function burnoutRisk(days: DaySummary[]): BurnoutRisk {
  const recent = days.slice(-RISK_DAYS)
  const late = recent.filter((d) => d.overtime === true)
  const fewBreaks = recent.filter((d) => d.breaksTaken < FEW_BREAKS)
  const lowMood = recent.filter((d) => d.moodAvg != null && d.moodAvg <= LOW_MOOD)
  const signalDays = new Set([...late, ...fewBreaks, ...lowMood].map((d) => d.date)).size
  return {
    level: signalDays >= 6 ? 'High' : signalDays >= 3 ? 'Watch' : 'Low',
    late: late.length,
    fewBreaks: fewBreaks.length,
    lowMood: lowMood.length
  }
}

export interface Streaks {
  water: number
  breaks: number
  onTime: number
}

/**
 * Days in a row meeting each goal, counted back from the newest day. `days` runs oldest first,
 * one entry per calendar day, null where nothing was saved; a missing newest day (today, before
 * check-out) is skipped rather than breaking the streak.
 */
export function streaks(days: (DaySummary | null)[]): Streaks {
  const list = days.length > 0 && days[days.length - 1] === null ? days.slice(0, -1) : days
  const run = (ok: (d: DaySummary) => boolean): number => {
    let n = 0
    for (let k = list.length - 1; k >= 0; k--) {
      const d = list[k]
      if (!d || !ok(d)) break
      n++
    }
    return n
  }
  return {
    water: run((d) => d.waterMl >= d.waterTargetMl),
    breaks: run((d) => d.breaksTaken >= STREAK_BREAKS),
    onTime: run((d) => d.overtime !== true)
  }
}
