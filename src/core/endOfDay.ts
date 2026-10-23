import { isHeld } from './breaks'
import type { Block, Item, Minutes, Settings } from './types'

export const ATTENDANCE_REPEAT_MIN = 10
export const HEADS_UP_LEAD_MIN = 15
export const OVERTIME_AFTER_MIN = 15
/** Idle for this long or more counts as away: reminders wait for the user to come back. */
export const ACTIVE_IDLE_SEC = 300
export const CHECKOUT_BUTTON_LEAD_MIN = 60

export type AttendanceKind = 'in' | 'out'
export type EndOfDayKind = 'attendance-in' | 'attendance-out' | 'heads-up' | 'overtime' | 'lunch'
export interface EndOfDayEvent {
  kind: EndOfDayKind
  title: string
  body: string
}

export interface EndOfDayState {
  inDone: boolean
  outDone: boolean
  outStarted: boolean
  lastInAt: Minutes | null
  lastOutAt: Minutes | null
  headsUpFired: boolean
  overtimeFired: boolean
  lunchFired: boolean
  checkedOut: boolean
}

export const EMPTY_END_OF_DAY_STATE: EndOfDayState = {
  inDone: false,
  outDone: false,
  outStarted: false,
  lastInAt: null,
  lastOutAt: null,
  headsUpFired: false,
  overtimeFired: false,
  lunchFired: false,
  checkedOut: false
}

const COPY: Record<EndOfDayKind, { title: string; body: string }> = {
  'attendance-in': { title: 'Punch in', body: 'Mark your attendance for today.' },
  'attendance-out': { title: 'Punch out', body: 'Mark your attendance before you leave.' },
  'heads-up': { title: 'Wrapping up in 15 min', body: "Review what's left for today." },
  overtime: { title: "You're past your hours", body: 'Time to stop for today.' },
  lunch: { title: 'Lunch time', body: 'Step away from the desk.' }
}

/** Which attendance punches are owed right now (drives the banner and the reminders). */
export function attendanceDue(
  state: EndOfDayState,
  now: Minutes,
  s: Settings
): { in: boolean; out: boolean } {
  if (!s.endOfDay.attendance) return { in: false, out: false }
  return {
    in: !state.inDone && now >= s.workStart && now < s.workEnd,
    out: !state.outDone && (state.outStarted || now >= s.workEnd)
  }
}

const repeatDue = (last: Minutes | null, now: Minutes): boolean =>
  last === null || now - last >= ATTENDANCE_REPEAT_MIN

export function stepEndOfDay(input: {
  now: Minutes
  idleSec: number
  blocks: Block[]
  items: Item[]
  settings: Settings
  manualBusy: boolean | null
  state: EndOfDayState
}): { events: EndOfDayEvent[]; state: EndOfDayState } {
  const { now, settings: s } = input
  const state = { ...input.state }
  const kinds: EndOfDayKind[] = []
  const active = input.idleSec < ACTIVE_IDLE_SEC
  const held = isHeld(input.blocks, input.items, now, input.manualBusy, s.bufferMin)
  const due = attendanceDue(state, now, s)

  // Attendance repeats until punched; it is never held, but waits for the user to be present.
  if (active && due.in && repeatDue(state.lastInAt, now)) {
    state.lastInAt = now
    kinds.push('attendance-in')
  }
  if (active && due.out && repeatDue(state.lastOutAt, now)) {
    state.lastOutAt = now
    kinds.push('attendance-out')
  }
  if (
    s.endOfDay.headsUp &&
    !state.headsUpFired &&
    !state.checkedOut &&
    now >= s.workEnd - HEADS_UP_LEAD_MIN &&
    now < s.workEnd &&
    !held
  ) {
    state.headsUpFired = true
    kinds.push('heads-up')
  }
  if (
    s.endOfDay.overtime &&
    !state.overtimeFired &&
    active &&
    // One notification per tick: overtime waits if punch-out just fired.
    !kinds.includes('attendance-out') &&
    now >= s.workEnd + OVERTIME_AFTER_MIN
  ) {
    state.overtimeFired = true
    kinds.push('overtime')
  }
  const inLunch = input.blocks.some((b) => b.kind === 'lunch' && now >= b.start && now < b.end)
  if (!state.lunchFired && active && !held && inLunch) {
    state.lunchFired = true
    kinds.push('lunch')
  }
  return { events: kinds.map((kind) => ({ kind, ...COPY[kind] })), state }
}

export function markPunched(state: EndOfDayState, kind: AttendanceKind): EndOfDayState {
  return kind === 'in' ? { ...state, inDone: true } : { ...state, outDone: true }
}

/** "Done for today": the check-out punch reminder starts on the next active tick. */
export function startCheckout(state: EndOfDayState): EndOfDayState {
  return { ...state, checkedOut: true, outStarted: true, lastOutAt: null }
}
