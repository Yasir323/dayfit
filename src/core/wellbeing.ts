import { isHeld } from './breaks'
import type { Block, Item, Minutes, Settings } from './types'

/** Per-day state of the wellbeing nudges; reset at rollover. */
export interface WellbeingState {
  /** Check-in times already fired (or skipped) today. */
  moodDone: Minutes[]
  /** Custom reminder id → its `at` times already fired today. */
  customFired: Record<string, Minutes[]>
  /** Custom reminder id → when an `every` reminder last fired (or a snooze's restart). */
  customLast: Record<string, Minutes>
  /** Active work minutes since the last sit/stand switch, and which one is next. */
  standActiveMin: number
  standing: boolean
  daylightFired: boolean
  windDownFired: boolean
  callFatigueFired: boolean
  breatheOffered: boolean
  commuteFired: boolean
  fatigueLastAt: Minutes | null
}

export const EMPTY_WELLBEING_STATE: WellbeingState = {
  moodDone: [],
  customFired: {},
  customLast: {},
  standActiveMin: 0,
  standing: false,
  daylightFired: false,
  windDownFired: false,
  callFatigueFired: false,
  breatheOffered: false,
  commuteFired: false,
  fatigueLastAt: null
}

/** Idle for this long or more counts as away: nudges wait for the user to come back. */
const AWAY_SEC = 300
/** A timed nudge (check-in, custom `at` reminder) this late is skipped, not fired. */
export const LATE_LIMIT_MIN = 90

export type WellbeingKind =
  | 'checkin'
  | 'custom'
  | 'posture'
  | 'daylight'
  | 'wind-down'
  | 'call-fatigue'
  | 'breathe'
  | 'commute'
  | 'fatigue'

export interface WellbeingEvent {
  kind: WellbeingKind
  title: string
  body: string
  /** The custom reminder behind a 'custom' event. */
  reminderId?: string
}

export interface WellbeingInput {
  now: Minutes
  elapsedMin: number
  idleSec: number
  blocks: Block[]
  items: Item[]
  settings: Settings
  manualBusy: boolean | null
  /** Another app is full screen (auto busy); manual Busy/Available still wins. */
  autoBusy: boolean
  state: WellbeingState
}

/** Busy as the hold rule sees it: the manual choice, else auto busy, else the plan decides. */
export const effectiveBusy = (manualBusy: boolean | null, autoBusy: boolean): boolean | null =>
  manualBusy ?? (autoBusy ? true : null)

/** One tick of the wellbeing nudges: what fires now, and the state after. */
export function stepWellbeing(input: WellbeingInput): {
  events: WellbeingEvent[]
  state: WellbeingState
} {
  const { now, settings: s } = input
  const f = s.features
  const state: WellbeingState = { ...input.state, moodDone: [...input.state.moodDone] }
  const events: WellbeingEvent[] = []
  const active = input.idleSec < AWAY_SEC
  const held = isHeld(
    input.blocks,
    input.items,
    now,
    effectiveBusy(input.manualBusy, input.autoBusy),
    s.bufferMin
  )
  const inHours = now >= s.workStart && now < s.workEnd

  // Mood check-in: one at a time; a missed one is dropped once it is too late to matter.
  if (f.mood.enabled) {
    for (const t of [...f.mood.times].sort((a, b) => a - b)) {
      if (state.moodDone.includes(t) || now < t) continue
      if (now - t > LATE_LIMIT_MIN) {
        state.moodDone.push(t)
        continue
      }
      if (active && inHours && !held) {
        state.moodDone.push(t)
        events.push({
          kind: 'checkin',
          title: 'How are you feeling?',
          body: 'Tap a face in Dayfit.'
        })
      }
      break
    }
  }

  return { events, state }
}
