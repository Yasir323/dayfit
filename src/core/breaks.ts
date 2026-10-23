import type { Block, Item, Minutes, Settings } from './types'

export type BreakPart = 'eye' | 'water' | 'stretch' | 'walk'
export const PART_ORDER: BreakPart[] = ['eye', 'water', 'stretch', 'walk']
/** Fallback check cadence (working minutes) when Eye is off. */
export const FALLBACK_CHECK_MIN = 20

type TimedPart = 'water' | 'stretch' | 'walk'
const TIMED: TimedPart[] = ['water', 'stretch', 'walk']

export interface BreakState {
  eyeActiveMin: number
  checkMin: number // working minutes since the last check; used only when Eye is off
  workMin: { water: number; stretch: number; walk: number }
  pending: BreakPart[]
  snoozeUntil: Minutes | null
  lastFired: BreakPart[]
}

export const EMPTY_BREAK_STATE: BreakState = {
  eyeActiveMin: 0,
  checkMin: 0,
  workMin: { water: 0, stretch: 0, walk: 0 },
  pending: [],
  snoozeUntil: null,
  lastFired: []
}

export interface BreakFire {
  parts: BreakPart[]
  title: string
  body: string
}

const ordered = (parts: Iterable<BreakPart>): BreakPart[] => {
  const set = new Set(parts)
  return PART_ORDER.filter((p) => set.has(p))
}

const holds = (i: Item): boolean => i.status === 'open' && (i.dnd || i.priority === 'high')

/** True while the user is focused: manual busy, or a DND / high-priority item is running. */
export function isHeld(
  blocks: Block[],
  items: Item[],
  now: Minutes,
  manualBusy: boolean | null,
  bufferMin: number
): boolean {
  if (manualBusy !== null) return manualBusy
  const holding = new Set(items.filter(holds).map((i) => i.id))
  const byItem = new Map<string, Block[]>()
  for (const b of blocks) {
    if (b.itemId === null || !holding.has(b.itemId)) continue
    if (now >= b.start && now < b.end) return true
    byItem.set(b.itemId, [...(byItem.get(b.itemId) ?? []), b])
  }
  // A short planned gap between two blocks of the same item (deep chunks) is not a real break.
  for (const own of byItem.values()) {
    own.sort((a, b) => a.start - b.start)
    for (let k = 1; k < own.length; k++) {
      const prev = own[k - 1]
      const next = own[k]
      if (now >= prev.end && now < next.start && next.start - prev.end <= bufferMin) return true
    }
  }
  return false
}

const PART_LINE: Record<BreakPart, (s: Settings, ml: number) => string> = {
  eye: () => 'Look 20 ft away',
  water: (s, ml) => `Drink water (${ml} / ${s.water.targetMl} ml)`,
  stretch: () => 'Stretch',
  walk: (s) => `Walk ${s.walk.durationMin} min`
}

export function composeBreak(parts: BreakPart[], s: Settings, waterMlToday: number): BreakFire {
  const p = ordered(parts)
  if (p.length === 1 && p[0] === 'eye')
    return {
      parts: p,
      title: 'Rest your eyes',
      body: 'Look at something 20 feet away for 20 seconds.'
    }
  return {
    parts: p,
    title: 'Break time',
    body: p.map((part) => PART_LINE[part](s, waterMlToday)).join(' · ')
  }
}

export function stepBreaks(input: {
  now: Minutes
  elapsedMin: number
  idleSec: number
  blocks: Block[]
  items: Item[]
  settings: Settings
  waterMlToday: number
  manualBusy: boolean | null
  state: BreakState
}): { fire: BreakFire | null; state: BreakState } {
  const { now, elapsedMin, idleSec, settings: s } = input
  if (now < s.workStart || now >= s.workEnd) return { fire: null, state: input.state }
  const state: BreakState = {
    ...input.state,
    workMin: { ...input.state.workMin },
    pending: [...input.state.pending],
    lastFired: [...input.state.lastFired]
  }

  // Accumulate: eye counts active screen time, the rest count working minutes.
  for (const p of TIMED) if (s[p].enabled) state.workMin[p] += elapsedMin
  if (s.eye.enabled) {
    if (idleSec >= s.eye.idleResetMin * 60) state.eyeActiveMin = 0
    else state.eyeActiveMin += elapsedMin
  } else state.checkMin += elapsedMin

  // Check: parts due now, or within half a check interval, ride together.
  const checkInterval = s.eye.enabled ? s.eye.intervalMin : FALLBACK_CHECK_MIN
  const checkDue = s.eye.enabled
    ? state.eyeActiveMin >= s.eye.intervalMin
    : state.checkMin >= FALLBACK_CHECK_MIN
  if (checkDue) {
    const slack = checkInterval / 2
    const included: BreakPart[] = s.eye.enabled ? ['eye'] : []
    for (const p of TIMED)
      if (s[p].enabled && state.workMin[p] >= s[p].intervalMin - slack) included.push(p)
    state.eyeActiveMin = 0
    state.checkMin = 0
    for (const p of included) if (p !== 'eye') state.workMin[p] = 0
    state.pending = ordered([...state.pending, ...included])
  }

  if (state.snoozeUntil !== null && now >= state.snoozeUntil) state.snoozeUntil = null

  const held = isHeld(input.blocks, input.items, now, input.manualBusy, s.bufferMin)
  if (state.pending.length === 0 || state.snoozeUntil !== null || held) return { fire: null, state }
  const fire = composeBreak(state.pending, s, input.waterMlToday)
  state.lastFired = fire.parts
  state.pending = []
  return { fire, state }
}

/** Re-queues the last fired break for `snoozeMin` (clamped to 1–60) minutes. */
export function snoozeBreak(state: BreakState, now: Minutes, snoozeMin: number): BreakState {
  if (state.lastFired.length === 0) return state
  return {
    ...state,
    pending: ordered([...state.pending, ...state.lastFired]),
    snoozeUntil: now + Math.min(60, Math.max(1, snoozeMin)),
    lastFired: []
  }
}
