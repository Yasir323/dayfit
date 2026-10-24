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
  /** Custom reminder id → when a snoozed reminder comes back. */
  customSnooze: Record<string, Minutes>
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
  customSnooze: {},
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

/** Meetings this close together count as one run. */
const RUN_GAP_MIN = 5
/** A run of meetings at least this long earns a breathing offer… */
const BREATHE_RUN_MIN = 90
/** …made within this many minutes of the run ending. */
const BREATHE_WITHIN_MIN = 10

/** End of the latest run of back-to-back fixed blocks lasting 90+ minutes that ended by `now`. */
function meetingRunEnd(blocks: Block[], now: Minutes): Minutes | null {
  const fixed = blocks.filter((b) => b.kind === 'fixed').sort((a, b) => a.start - b.start)
  let best: Minutes | null = null
  let runEnd: Minutes | null = null
  let runMin = 0
  const close = (): void => {
    if (runEnd !== null && runMin >= BREATHE_RUN_MIN && runEnd <= now) best = runEnd
  }
  for (const b of fixed) {
    if (runEnd !== null && b.start - runEnd <= RUN_GAP_MIN) {
      runMin += b.end - b.start
      runEnd = Math.max(runEnd, b.end)
    } else {
      close()
      runEnd = b.end
      runMin = b.end - b.start
    }
  }
  close()
  return best
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
  const state: WellbeingState = {
    ...input.state,
    moodDone: [...input.state.moodDone],
    customFired: { ...input.state.customFired },
    customLast: { ...input.state.customLast },
    customSnooze: { ...input.state.customSnooze }
  }
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

  // Sit/stand: counts active work time, switches each interval (the switch waits out a hold).
  if (f.standing.enabled && inHours && active) {
    state.standActiveMin += input.elapsedMin
    if (state.standActiveMin >= f.standing.intervalMin && !held) {
      events.push(
        state.standing
          ? { kind: 'posture', title: 'Time to sit down', body: 'Switch back to sitting.' }
          : { kind: 'posture', title: 'Time to stand up', body: 'Switch to standing for a while.' }
      )
      state.standing = !state.standing
      state.standActiveMin = 0
    }
  }

  if (
    f.daylight.enabled &&
    !state.daylightFired &&
    now >= f.daylight.at &&
    inHours &&
    active &&
    !held
  ) {
    state.daylightFired = true
    events.push({
      kind: 'daylight',
      title: 'Get some daylight',
      body: 'Step outside or open a window for 5 min.'
    })
  }

  // Wind-down is about the evening: no hold, no working hours.
  if (
    f.windDown.enabled &&
    !state.windDownFired &&
    now >= s.workEnd + f.windDown.afterMin &&
    active
  ) {
    state.windDownFired = true
    events.push({
      kind: 'wind-down',
      title: 'Time to wind down',
      body: 'Close the laptop for today.'
    })
  }

  if (f.callFatigue.enabled && !state.callFatigueFired && active && !held) {
    const callMin = input.blocks
      .filter((b) => b.kind === 'fixed' && b.end <= now)
      .reduce((sum, b) => sum + (b.end - b.start), 0)
    if (callMin >= f.callFatigue.thresholdMin) {
      state.callFatigueFired = true
      events.push({
        kind: 'call-fatigue',
        title: 'Lots of calls today',
        body: 'Try camera off, audio only or a walking call next.'
      })
    }
  }

  // Breathing: offered once, just after a long run of back-to-back meetings.
  if (f.breathe.enabled && !state.breatheOffered && active && !held) {
    const end = meetingRunEnd(input.blocks, now)
    if (end !== null && now - end <= BREATHE_WITHIN_MIN) {
      state.breatheOffered = true
      events.push({
        kind: 'breathe',
        title: 'Take a breather',
        body: 'One minute of box breathing?'
      })
    }
  }

  // Custom reminders. `at` ones are about the clock (medication): they ignore busy and working
  // hours, and only wait for the user to be back. `every` ones are work-time habits.
  for (const r of f.reminders) {
    if (!r.enabled) continue
    const custom: WellbeingEvent = {
      kind: 'custom',
      title: r.title,
      body: 'Reminder',
      reminderId: r.id
    }
    const snooze = state.customSnooze[r.id]
    if (snooze !== undefined) {
      if (now >= snooze && active) {
        delete state.customSnooze[r.id]
        events.push(custom)
      }
      continue
    }
    if (r.kind === 'at') {
      const fired = state.customFired[r.id] ?? []
      const due = [...r.times].sort((a, b) => a - b).filter((t) => !fired.includes(t) && now >= t)
      const late = due.filter((t) => now - t > LATE_LIMIT_MIN)
      const onTime = due.filter((t) => now - t <= LATE_LIMIT_MIN)
      if (late.length > 0) state.customFired[r.id] = [...fired, ...late]
      if (onTime.length > 0 && active) {
        state.customFired[r.id] = [...(state.customFired[r.id] ?? []), ...onTime]
        events.push(custom)
      }
    } else if (inHours && active && !held && r.everyMin > 0) {
      const last = state.customLast[r.id] ?? s.workStart
      if (now - last >= r.everyMin) {
        state.customLast[r.id] = now
        events.push(custom)
      }
    }
  }

  return { events, state }
}
