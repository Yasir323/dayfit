import { fitFirst, subtract } from './freeTime'
import type { Block, Minutes, Settings } from './types'

const SPREAD_MIN = 60

/** Earliest call start times in the remaining work day, each at least an hour after the previous. */
export function suggestCallSlots(
  blocks: Block[],
  durationMin: number,
  now: Minutes,
  s: Settings,
  count = 3
): Minutes[] {
  const lo = Math.max(now, s.workStart)
  const free = subtract([{ start: lo, end: s.workEnd }], blocks, s.bufferMin)
  const out: Minutes[] = []
  let earliest = lo
  while (out.length < count) {
    const fit = fitFirst(free, durationMin, { start: earliest, end: s.workEnd })
    if (!fit) break
    out.push(fit.start)
    earliest = fit.start + SPREAD_MIN
  }
  return out
}
