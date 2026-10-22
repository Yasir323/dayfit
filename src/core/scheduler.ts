import { fitFirst, subtract, type Interval } from './freeTime'
import { halfBoundary } from './time'
import {
  isFixed,
  type Block,
  type BlockKind,
  type DateStr,
  type Decision,
  type DecisionAnswer,
  type DecisionChoice,
  type Item,
  type Minutes,
  type PlanResult,
  type Priority,
  type Settings
} from './types'

export interface PlanInput {
  date: DateStr
  now: Minutes
  items: Item[] // already itemsForDate(...)
  settings: Settings
  frozen: Block[] // kept verbatim (done / in progress / overdue)
  answers: DecisionAnswer[]
}

const DEEP_CHUNK_MIN = 60
const WALK_SLACK_MIN = 30
const PRIORITY_RANK: Record<Priority, number> = { high: 0, med: 1, low: 2 }
const NOT_PLACED: DecisionChoice[] = ['tomorrow', 'unscheduled', 'drop']

/** Mutable state threaded through the planning steps. */
interface Plan {
  blocks: Block[]
  free: Interval[]
  decisions: Decision[]
  buffer: number
  window: Interval
  boundary: Minutes
  answers: Map<string, DecisionChoice>
  /** Item ids answered tomorrow / unscheduled / drop: never placed. */
  skip: Set<string>
  /** Item ids that already have a block (frozen, fixed, locked or placed). */
  blocked: Set<string>
}

function commit(plan: Plan, block: Block): void {
  plan.blocks.push(block)
  plan.free = subtract(plan.free, [block], plan.buffer)
  if (block.itemId !== null) plan.blocked.add(block.itemId)
}

const byPriorityThenAge = (a: Item, b: Item): number =>
  PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
  a.createdAt - b.createdAt ||
  (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

const lockedKind = (i: Item): BlockKind => (i.type === 'deep' ? 'deep' : 'task')

// Step 1: frozen blocks verbatim, then fixed and locked items (frozen wins on conflict).
function initialBlocks(input: PlanInput, skip: Set<string>): Block[] {
  const blocks: Block[] = input.frozen.map((b) => ({ ...b, chunk: b.chunk && { ...b.chunk } }))
  const frozenIds = new Set(input.frozen.map((b) => b.itemId))
  for (const i of input.items) {
    if (frozenIds.has(i.id) || skip.has(i.id)) continue
    if (isFixed(i)) {
      const start = i.fixedStart as Minutes
      blocks.push({
        itemId: i.id,
        kind: 'fixed',
        start,
        end: start + i.durationMin,
        chunk: null,
        reason: 'Fixed'
      })
    } else if (i.lockedStart !== null) {
      const start = i.lockedStart
      blocks.push({
        itemId: i.id,
        kind: lockedKind(i),
        start,
        end: start + i.durationMin,
        chunk: null,
        reason: 'Locked'
      })
    }
  }
  return blocks
}

// Step 2: window and free time.
function startPlan(input: PlanInput): Plan {
  const { settings: s } = input
  const answers = new Map(input.answers.map((a) => [a.itemId, a.choice]))
  const notPlaced = (i: Item): boolean => {
    const c = answers.get(i.id)
    return c !== undefined && NOT_PLACED.includes(c)
  }
  const skip = new Set(input.items.filter(notPlaced).map((i) => i.id))
  const window = { start: Math.max(s.workStart, input.now), end: s.workEnd }
  const plan: Plan = {
    blocks: [],
    free: window.end > window.start ? [window] : [],
    decisions: [],
    buffer: s.bufferMin,
    window,
    boundary: halfBoundary(s),
    answers,
    skip,
    blocked: new Set(skip)
  }
  for (const b of initialBlocks(input, skip)) commit(plan, b)
  return plan
}

function halfArea(plan: Plan, half: 'am' | 'pm'): Interval {
  return half === 'am'
    ? { start: plan.window.start, end: Math.min(plan.boundary, plan.window.end) }
    : { start: Math.max(plan.boundary, plan.window.start), end: plan.window.end }
}

function chunkLengths(total: number): number[] {
  const n = Math.max(1, Math.floor(total / DEEP_CHUNK_MIN))
  const out = Array<number>(n).fill(DEEP_CHUNK_MIN)
  out[n - 1] += total - n * DEEP_CHUNK_MIN
  return out
}

/**
 * Blocks for `total` minutes of `item` inside `area`: whole if possible, else 60m chunks in order;
 * null if neither fits. `offset` frozen chunks already exist, so numbering continues after them.
 */
function fitDeep(
  plan: Plan,
  item: Item,
  total: number,
  offset: number,
  area: Interval,
  half: 'am' | 'pm' | null
): Block[] | null {
  const whole = fitFirst(plan.free, total, area)
  if (whole) {
    const where = half === 'am' ? ' in first half' : half === 'pm' ? ' in second half' : ''
    const chunk = offset > 0 ? { index: offset, of: offset + 1 } : null
    return [
      { itemId: item.id, kind: 'deep', ...whole, chunk, reason: `Earliest free slot${where}` }
    ]
  }
  const lengths = chunkLengths(total)
  if (lengths.length < 2) return null
  let free = plan.free
  let from = area.start
  const blocks: Block[] = []
  for (const [k, len] of lengths.entries()) {
    const slot = fitFirst(free, len, { start: from, end: area.end })
    if (!slot) return null
    blocks.push({
      itemId: item.id,
      kind: 'deep',
      ...slot,
      chunk: { index: offset + k, of: offset + lengths.length },
      reason: `Split: no ${total}m gap`
    })
    free = subtract(free, [slot], plan.buffer)
    from = slot.end
  }
  return blocks
}

/** Minutes and block count already frozen per item. */
function frozenByItem(frozen: Block[]): Map<string, { min: number; count: number }> {
  const out = new Map<string, { min: number; count: number }>()
  for (const b of frozen) {
    if (b.itemId === null) continue
    const cur = out.get(b.itemId) ?? { min: 0, count: 0 }
    out.set(b.itemId, { min: cur.min + (b.end - b.start), count: cur.count + 1 })
  }
  return out
}

// Step 3: deep work. Partly frozen items get their remaining minutes placed.
function placeDeepWork(plan: Plan, items: Item[], frozen: Block[]): void {
  const done = frozenByItem(frozen)
  const deep = items
    .filter(
      (i) =>
        i.type === 'deep' &&
        i.status === 'open' &&
        !isFixed(i) &&
        i.lockedStart === null &&
        (done.has(i.id) || !plan.blocked.has(i.id)) &&
        !plan.skip.has(i.id)
    )
    .sort(byPriorityThenAge)
  for (const item of deep) {
    const prior = done.get(item.id) ?? { min: 0, count: 0 }
    const total = item.durationMin - prior.min
    if (total <= 0) continue
    const fit = (area: Interval, half: 'am' | 'pm' | null): Block[] | null =>
      fitDeep(plan, item, total, prior.count, area, half)
    const half = item.half
    let placed = fit(half ? halfArea(plan, half) : plan.window, half)
    if (!placed && half) {
      const otherHalf = half === 'am' ? 'pm' : 'am'
      // The other half, or failing that a gap straddling the boundary.
      const other = fit(halfArea(plan, otherHalf), otherHalf) ?? fit(plan.window, null)
      if (other && plan.answers.get(item.id) === 'use-other-half') placed = other
      else if (other) {
        plan.decisions.push({ kind: 'half-overflow', itemId: item.id, preferred: half })
        continue
      }
    }
    if (!placed) {
      plan.decisions.push({ kind: 'no-fit', itemId: item.id })
      continue
    }
    for (const b of placed) commit(plan, b)
  }
}

/** Start nearest `target` (ties: earlier) where `len` fits in free time, within ±WALK_SLACK_MIN. */
function nearestStart(free: Interval[], len: number, target: Minutes): Minutes | null {
  let best: Minutes | null = null
  for (const f of free) {
    if (f.end - f.start < len) continue
    const s = Math.min(Math.max(target, f.start), f.end - len)
    const d = Math.abs(s - target)
    if (d > WALK_SLACK_MIN) continue
    if (best === null || d < Math.abs(best - target) || (d === Math.abs(best - target) && s < best))
      best = s
  }
  return best
}

// Step 4: walks.
function placeWalks(plan: Plan, s: Settings): void {
  if (!s.walk.enabled) return
  const len = s.walk.durationMin
  for (
    let target = s.workStart + s.walk.intervalMin;
    target + len <= s.workEnd;
    target += s.walk.intervalMin
  ) {
    // A walk already near this target (e.g. frozen on replan) covers it.
    if (plan.blocks.some((b) => b.kind === 'walk' && Math.abs(b.start - target) <= WALK_SLACK_MIN))
      continue
    const start = nearestStart(plan.free, len, target)
    if (start === null) continue
    commit(plan, {
      itemId: null,
      kind: 'walk',
      start,
      end: start + len,
      chunk: null,
      reason: 'Walk break'
    })
  }
}

/** Start, then end, then the item's createdAt, then itemId (item-less blocks last). */
function blockOrder(items: Item[]): (a: Block, b: Block) => number {
  const created = new Map(items.map((i) => [i.id, i.createdAt]))
  const age = (b: Block): number =>
    b.itemId === null ? Infinity : (created.get(b.itemId) ?? Infinity)
  const id = (b: Block): string => b.itemId ?? '\uffff'
  return (a, b) =>
    a.start - b.start ||
    a.end - b.end ||
    (age(a) === age(b) ? 0 : age(a) < age(b) ? -1 : 1) ||
    (id(a) < id(b) ? -1 : id(a) > id(b) ? 1 : 0)
}

export function planDay(input: PlanInput): PlanResult {
  const plan = startPlan(input)
  placeDeepWork(plan, input.items, input.frozen)
  placeWalks(plan, input.settings)
  return {
    blocks: [...plan.blocks].sort(blockOrder(input.items)),
    decisions: plan.decisions,
    unscheduled: input.items
      .filter((i) => plan.answers.get(i.id) === 'unscheduled')
      .map((i) => i.id)
  }
}
