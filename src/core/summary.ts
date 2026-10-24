import { itemsForDate } from './recurrence'
import { isFixed, type Block, type DateStr, type Item } from './types'

/** Counters kept through the day for things the item list can't tell afterwards. */
export interface DayStats {
  /** Minutes at the computer (not idle). Absent in older state. */
  activeMin?: number
  /** Cursor pace (fatigue signals) for the day so far, when measured. */
  fatigueRate?: number | null
  /** Breaks fired and not snoozed. */
  breaksTaken: number
  /** Focus sessions that ran to the end. */
  focusMin: number
  /** Items sent to tomorrow at check-out. */
  moved: number
}

export const EMPTY_DAY_STATS: DayStats = { activeMin: 0, breaksTaken: 0, focusMin: 0, moved: 0 }

export interface DaySummary {
  date: DateStr
  focusMin: number
  breaksTaken: number
  waterMl: number
  waterTargetMl: number
  coffeeCups: number
  done: number
  moved: number
  dropped: number
  meetings: number
  /** Average check-in score (1–5, one decimal); null with no check-ins. Absent in older rows. */
  moodAvg?: number | null
  /** Worked past hours (the overtime reminder fired). Absent in older rows. */
  overtime?: boolean
  /** Minutes at the computer. Absent in older rows. */
  screenMin?: number
}

export interface SummaryInput {
  date: DateStr
  /** Every item; the day's view of them is taken here. */
  items: Item[]
  /** The day's planned blocks. */
  blocks: Block[]
  stats: DayStats
  waterMl: number
  waterTargetMl: number
  coffeeCups: number
  moods?: { at?: number; score: number }[]
  overtime?: boolean
}

export function summarizeDay(input: SummaryInput): DaySummary {
  const { date, items, blocks, stats } = input
  const day = itemsForDate(items, date)
  const doneIds = new Set(day.filter((i) => i.status === 'done').map((i) => i.id))
  const deepMin = blocks
    .filter((b) => b.kind === 'deep' && b.itemId !== null && doneIds.has(b.itemId))
    .reduce((sum, b) => sum + (b.end - b.start), 0)
  return {
    date,
    focusMin: deepMin + stats.focusMin,
    breaksTaken: stats.breaksTaken,
    waterMl: input.waterMl,
    waterTargetMl: input.waterTargetMl,
    coffeeCups: input.coffeeCups,
    done: day.filter((i) => i.status === 'done' && !isFixed(i)).length,
    moved: stats.moved,
    dropped: items.filter(
      (i) => i.status === 'dropped' && i.repeat.kind === 'none' && i.date === date
    ).length,
    meetings: day.filter(isFixed).length,
    moodAvg: moodAverage(input.moods ?? []),
    overtime: input.overtime ?? false,
    screenMin: Math.round(stats.activeMin ?? 0)
  }
}

const moodAverage = (moods: { score: number }[]): number | null =>
  moods.length === 0
    ? null
    : Math.round((moods.reduce((sum, m) => sum + m.score, 0) / moods.length) * 10) / 10

const hoursMinutes = (min: number): string => {
  const h = Math.floor(min / 60)
  const m = min % 60
  return h === 0 ? `${m}m` : `${h}h ${m}m`
}

/** One line for the check-out card, e.g. "Focus 2h 10m · Water 1500 / 2000 ml · Breaks 6 · Done 4". */
export function formatSummary(s: DaySummary): string {
  return [
    `Focus ${hoursMinutes(s.focusMin)}`,
    `Water ${s.waterMl} / ${s.waterTargetMl} ml`,
    `Breaks ${s.breaksTaken}`,
    `Done ${s.done}`,
    `Screen ${hoursMinutes(s.screenMin ?? 0)}`
  ].join(' · ')
}
