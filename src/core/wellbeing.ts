import type { Minutes } from './types'

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
