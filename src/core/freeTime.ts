import type { Minutes } from './types'

export interface Interval {
  start: Minutes
  end: Minutes
}

const byStart = (a: Interval, b: Interval): number => a.start - b.start || a.end - b.end

/** Removes each busy interval, padded by `pad` on both sides, from `free`. Empty pieces are dropped. */
export function subtract(free: Interval[], busy: Interval[], pad: number): Interval[] {
  let out = [...free].sort(byStart)
  for (const b of busy) {
    const lo = b.start - pad
    const hi = b.end + pad
    const next: Interval[] = []
    for (const f of out) {
      if (hi <= f.start || lo >= f.end) {
        next.push(f)
        continue
      }
      if (lo > f.start) next.push({ start: f.start, end: lo })
      if (hi < f.end) next.push({ start: hi, end: f.end })
    }
    out = next
  }
  return out
}

/** Earliest interval of length `len` inside `free` (and inside `within`, if given). */
export function fitFirst(free: Interval[], len: number, within?: Interval): Interval | null {
  for (const f of [...free].sort(byStart)) {
    const start = within ? Math.max(f.start, within.start) : f.start
    const end = within ? Math.min(f.end, within.end) : f.end
    if (end - start >= len) return { start, end: start + len }
  }
  return null
}
