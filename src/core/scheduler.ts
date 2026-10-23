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
  type Half,
  type Item,
  type ItemType,
  type LunchAnswer,
  type LunchClash,
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
  /** Today's lunch-clash answer, if the user gave one. */
  lunch?: LunchAnswer | null
}

const DEEP_CHUNK_MIN = 60
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

/** Item ids answered tomorrow / unscheduled / drop. */
function skippedIds(input: PlanInput): Set<string> {
  const notPlaced = new Set(
    input.answers.filter((a) => NOT_PLACED.includes(a.choice)).map((a) => a.itemId)
  )
  return new Set(input.items.filter((i) => notPlaced.has(i.id)).map((i) => i.id))
}

const overlaps = (a: Interval, b: Interval): boolean => a.start < b.end && b.start < a.end

/**
 * Step 0: a lock that would overlap a fixed or frozen block is ignored for this plan, so the
 * item is placed as if unlocked (the stored lock is untouched).
 */
function releaseBlockedLocks(input: PlanInput): Item[] {
  const skip = skippedIds(input)
  const frozenIds = new Set(input.frozen.map((b) => b.itemId))
  const hard: Interval[] = [
    ...input.frozen,
    ...input.items
      .filter((i) => isFixed(i) && !skip.has(i.id) && !frozenIds.has(i.id))
      .map((i) => ({
        start: i.fixedStart as Minutes,
        end: (i.fixedStart as Minutes) + i.durationMin
      }))
  ]
  return input.items.map((i) => {
    if (i.lockedStart === null || isFixed(i) || frozenIds.has(i.id)) return i
    const own = { start: i.lockedStart, end: i.lockedStart + i.durationMin }
    return hard.some((h) => overlaps(own, h)) ? { ...i, lockedStart: null } : i
  })
}

// Step 2: window and free time.
function startPlan(input: PlanInput): Plan {
  const { settings: s } = input
  const answers = new Map(input.answers.map((a) => [a.itemId, a.choice]))
  const skip = skippedIds(input)
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

const slotReason = (half: Half): string =>
  `Earliest free slot${half === 'am' ? ' in first half' : half === 'pm' ? ' in second half' : ''}`

/**
 * Places `item` via `fit` in its preferred half (or the whole window). If only the other half,
 * or a gap straddling the boundary, has room, it asks first (half-overflow) unless answered
 * use-other-half. Nothing fitting anywhere is a no-fit.
 */
function placeWithHalf(
  plan: Plan,
  item: Item,
  fit: (area: Interval, half: Half) => Block[] | null
): void {
  const half = item.half
  let placed = fit(half ? halfArea(plan, half) : plan.window, half)
  if (!placed && half) {
    const otherHalf = half === 'am' ? 'pm' : 'am'
    // The other half, or failing that a gap straddling the boundary.
    const other = fit(halfArea(plan, otherHalf), otherHalf) ?? fit(plan.window, null)
    if (other && plan.answers.get(item.id) === 'use-other-half') placed = other
    else if (other) {
      plan.decisions.push({ kind: 'half-overflow', itemId: item.id, preferred: half })
      return
    }
  }
  if (!placed) {
    plan.decisions.push({ kind: 'no-fit', itemId: item.id })
    return
  }
  for (const b of placed) commit(plan, b)
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
  half: Half
): Block[] | null {
  const whole = fitFirst(plan.free, total, area)
  if (whole) {
    const chunk = offset > 0 ? { index: offset, of: offset + 1 } : null
    return [{ itemId: item.id, kind: 'deep', ...whole, chunk, reason: slotReason(half) }]
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
    placeWithHalf(plan, item, (area, half) => fitDeep(plan, item, total, prior.count, area, half))
  }
}

/** A task or household item with its latest allowed end today (null: no deadline today). */
interface Task {
  item: Item
  due: Minutes | null
}

const TASK_TYPES: ItemType[] = ['task', 'household']

/** Unconfirmed calls keep their suggested slots free, best effort. */
function softHolds(plan: Plan, items: Item[]): Interval[] {
  return items
    .filter(
      (i) => i.type === 'call' && i.status === 'open' && !isFixed(i) && !plan.blocked.has(i.id)
    )
    .flatMap((i) => i.suggestedSlots.map((s) => ({ start: s, end: s + i.durationMin })))
}

/** Earliest `len` slot in `area` ending by `due`: clear of the holds if possible, else over them. */
function fitAround(
  plan: Plan,
  holds: Interval[],
  len: number,
  area: Interval,
  due: Minutes | null
): Interval | null {
  const within = { start: area.start, end: due === null ? area.end : Math.min(area.end, due) }
  return (
    fitFirst(subtract(plan.free, holds, plan.buffer), len, within) ??
    fitFirst(plan.free, len, within)
  )
}

function byDueThenPriority(a: Task, b: Task): number {
  const da = a.due ?? Infinity
  const db = b.due ?? Infinity
  return da !== db ? (da < db ? -1 : 1) : byPriorityThenAge(a.item, b.item)
}

/** Similar items: same label, or same type when unlabelled. Groups in order of first member. */
function batches(tasks: Task[]): Task[][] {
  const groups = new Map<string, Task[]>()
  for (const t of tasks) {
    const key = t.item.label !== null ? `#${t.item.label}` : `~${t.item.type}`
    const group = groups.get(key)
    if (group) group.push(t)
    else groups.set(key, [t])
  }
  return [...groups.values()]
}

/** The half all members' preferences agree on (null: none set); undefined when they conflict. */
function sharedHalf(group: Task[]): Half | undefined {
  const halves = new Set(group.map((t) => t.item.half).filter((h) => h !== null))
  return halves.size > 1 ? undefined : ([...halves][0] ?? null)
}

/** Places the group back to back in one gap, every member meeting its deadline. */
function placeBatch(plan: Plan, holds: Interval[], group: Task[]): boolean {
  const { label, type } = group[0].item
  const shared = sharedHalf(group)
  if (shared === undefined) return false
  // Walk back from the last member: the group may end no later than due + what follows it.
  let tail = 0
  let due: Minutes | null = null
  for (const t of [...group].reverse()) {
    if (t.due !== null) due = Math.min(due ?? Infinity, t.due + tail)
    tail += plan.buffer + t.item.durationMin
  }
  const area = shared ? halfArea(plan, shared) : plan.window
  const slot = fitAround(plan, holds, tail - plan.buffer, area, due)
  if (!slot) return false
  const reason = label !== null ? `Batched with #${label}` : `Batched with other ${type}s`
  let start = slot.start
  for (const { item } of group) {
    const end = start + item.durationMin
    commit(plan, { itemId: item.id, kind: 'task', start, end, chunk: null, reason })
    start = end + plan.buffer
  }
  return true
}

function placeSingle(plan: Plan, holds: Interval[], { item, due }: Task): void {
  placeWithHalf(plan, item, (area, half) => {
    const slot = fitAround(plan, holds, item.durationMin, area, due)
    return (
      slot && [{ itemId: item.id, kind: 'task', ...slot, chunk: null, reason: slotReason(half) }]
    )
  })
}

const clonePlan = (p: Plan): Plan => ({
  ...p,
  blocks: [...p.blocks],
  free: [...p.free],
  decisions: [...p.decisions],
  blocked: new Set(p.blocked)
})

/** Step 5 from `base`: the `batched` groups first, then every other task singly in rank order. */
function simulateTasks(
  base: Plan,
  holds: Interval[],
  tasks: Task[],
  batched: Task[][]
): Plan | null {
  const p = clonePlan(base)
  for (const g of batched) if (!placeBatch(p, holds, g)) return null
  const inBatch = new Set(batched.flat().map((t) => t.item.id))
  for (const t of tasks) if (!inBatch.has(t.item.id)) placeSingle(p, holds, t)
  return p
}

/** True when `next` keeps every item `cur` placed and raises no new half-overflow. */
function costsNothing(cur: Plan, next: Plan): boolean {
  const overflow = (p: Plan): Set<string> =>
    new Set(p.decisions.filter((d) => d.kind === 'half-overflow').map((d) => d.itemId))
  const before = overflow(cur)
  const after = overflow(next)
  return (
    [...cur.blocked].every((id) => next.blocked.has(id)) && [...after].every((id) => before.has(id))
  )
}

/**
 * Step 5: tasks and household items, by deadline then priority. Similar items are batched only
 * when that costs nothing: every item placed unbatched stays placed, with no new half-overflow.
 */
function placeTasks(plan: Plan, input: PlanInput): void {
  const holds = softHolds(plan, input.items)
  const tasks = input.items
    .filter(
      (i) =>
        TASK_TYPES.includes(i.type) && i.status === 'open' && !isFixed(i) && !plan.blocked.has(i.id)
    )
    .map((item) => ({
      item,
      due:
        item.deadline?.date === input.date ? (item.deadline.time ?? input.settings.workEnd) : null
    }))
    .sort(byDueThenPriority)
  const accepted: Task[][] = []
  let current = simulateTasks(plan, holds, tasks, []) as Plan
  for (const group of batches(tasks)) {
    if (group.length < 2) continue
    const next = simulateTasks(plan, holds, tasks, [...accepted, group])
    if (next && costsNothing(current, next)) {
      accepted.push(group)
      current = next
    }
  }
  Object.assign(plan, current)
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

export const MIN_SHORT_LUNCH_MIN = 30

const fitsFree = (free: Interval[], start: Minutes, len: number): boolean =>
  free.some((f) => f.start <= start && start + len <= f.end)

/** Earliest start at or after `from` where `len` fits in free time, or null. */
function nextSlot(free: Interval[], from: Minutes, len: number): Minutes | null {
  for (const f of [...free].sort((a, b) => a.start - b.start)) {
    const start = Math.max(f.start, from)
    if (start + len <= f.end) return start
  }
  return null
}

const titleOf = (b: Block, items: Item[]): string =>
  items.find((i) => i.id === b.itemId)?.title ?? 'Busy'

// Step 2b: lunch, before flexible work. Only fixed, locked and frozen blocks are in its way; when
// it can't sit at its usual time the user decides (LunchClash) instead of it moving silently.
function placeLunch(plan: Plan, input: PlanInput): { clash: LunchClash | null; rejected: boolean } {
  const s = input.settings
  if (s.lunch === null || plan.blocks.some((b) => b.kind === 'lunch'))
    return { clash: null, rejected: false }
  const answer = input.lunch ?? null
  if (answer?.kind === 'skip') return { clash: null, rejected: false }
  const put = (start: Minutes, len: number): void =>
    commit(plan, {
      itemId: null,
      kind: 'lunch',
      start,
      end: start + len,
      chunk: null,
      reason: 'Lunch'
    })
  let rejected = false
  if (answer?.kind === 'at') {
    if (fitsFree(plan.free, answer.start, answer.len)) {
      put(answer.start, answer.len)
      return { clash: null, rejected: false }
    }
    rejected = true
  }
  const usual = s.lunch
  const len = s.endOfDay.lunchMin
  if (usual < plan.window.start)
    return {
      clash: {
        reason: 'passed',
        usual,
        clashWith: null,
        shorten: null,
        move: nextSlot(plan.free, plan.window.start, len)
      },
      rejected
    }
  if (fitsFree(plan.free, usual, len)) {
    put(usual, len)
    return { clash: null, rejected }
  }
  const pad = s.bufferMin
  const blocker = [...plan.blocks]
    .sort((a, b) => a.start - b.start)
    .find((b) => b.start < usual + len + pad && b.end > usual - pad)
  const around = plan.free.find((f) => f.start <= usual && usual < f.end)
  const n = around ? Math.min(len, around.end - usual) : 0
  return {
    clash: {
      reason: 'clash',
      usual,
      clashWith: blocker ? titleOf(blocker, input.items) : 'Busy',
      shorten: n >= MIN_SHORT_LUNCH_MIN ? { start: usual, len: n } : null,
      move: nextSlot(plan.free, usual, len)
    },
    rejected
  }
}

/**
 * Why lunch can't start at `start` for `len` minutes, or null when it can. Immovable means a fixed
 * block, a locked block, or one that has already started.
 */
export function lunchPickError(
  start: Minutes,
  len: number,
  blocks: Block[],
  items: Item[],
  s: Settings,
  now: Minutes
): string | null {
  if (start < s.workStart || start + len > s.workEnd) return 'Outside working hours'
  if (start < now) return 'That time has passed'
  const pad = s.bufferMin
  const hit = [...blocks]
    .sort((a, b) => a.start - b.start)
    .find(
      (b) =>
        (b.kind === 'fixed' || b.reason === 'Locked' || b.start <= now) &&
        b.kind !== 'lunch' &&
        b.start < start + len + pad &&
        b.end > start - pad
    )
  return hit ? `Clashes with ${titleOf(hit, items)}` : null
}

export function planDay(raw: PlanInput): PlanResult {
  const input = { ...raw, items: releaseBlockedLocks(raw) }
  const plan = startPlan(input)
  const lunch = placeLunch(plan, input)
  placeDeepWork(plan, input.items, input.frozen)
  placeTasks(plan, input)
  return {
    blocks: [...plan.blocks].sort(blockOrder(input.items)),
    decisions: plan.decisions,
    unscheduled: input.items
      .filter((i) => plan.answers.get(i.id) === 'unscheduled')
      .map((i) => i.id),
    lunchClash: lunch.clash,
    lunchAnswerRejected: lunch.rejected
  }
}
