import type { Block, Item, Minutes, Settings } from './types'

export type ReminderKind = 'meeting-soon' | 'meeting-now' | 'water' | 'eye' | 'stretch' | 'walk'
export interface ReminderEvent {
  kind: ReminderKind
  itemId: string | null
  title: string
  body: string
  silent: boolean
}
export interface ReminderState {
  activeMin: number
  lastEyeAt: Minutes | null
  lastStretchAt: Minutes | null
  lastWaterAt: Minutes | null
  fired: string[] // 'meeting-soon:<id>:<start>', 'meeting-now:<id>:<start>', 'walk:<start>'
}

export const EMPTY_REMINDER_STATE: ReminderState = {
  activeMin: 0,
  lastEyeAt: null,
  lastStretchAt: null,
  lastWaterAt: null,
  fired: []
}

const inside = (b: Block, now: Minutes): boolean => now >= b.start && now < b.end

export function isBusy(blocks: Block[], now: Minutes, manual: boolean | null): boolean {
  if (manual !== null) return manual
  return blocks.some((b) => (b.kind === 'fixed' || b.kind === 'deep') && inside(b, now))
}

export function dueReminders(input: {
  now: Minutes
  elapsedMin: number
  idleSec: number
  blocks: Block[]
  items: Item[]
  settings: Settings
  waterMlToday: number
  manualBusy: boolean | null
  state: ReminderState
}): { events: ReminderEvent[]; state: ReminderState } {
  const { now, elapsedMin, idleSec, blocks, items, settings, waterMlToday, manualBusy } = input
  const state: ReminderState = { ...input.state, fired: [...input.state.fired] }
  const events: ReminderEvent[] = []
  const busy = isBusy(blocks, now, manualBusy)
  const working = now >= settings.workStart && now < settings.workEnd
  const gentle = settings.busy.allowGentle

  // Meeting alerts: ignore busy mode.
  if (settings.meetingAlert.enabled) {
    const lead = settings.meetingAlert.leadMin
    for (const b of blocks) {
      if (b.kind !== 'fixed') continue
      const item = items.find((i) => i.id === b.itemId)
      // A meeting marked done or deleted needs no alert.
      if (item?.status === 'done' || item?.status === 'dropped') continue
      const title = item?.title ?? 'Meeting'
      const soonKey = `meeting-soon:${b.itemId}:${b.start}`
      const nowKey = `meeting-now:${b.itemId}:${b.start}`
      if (now >= b.start - lead && now < b.start && !state.fired.includes(soonKey)) {
        state.fired.push(soonKey)
        events.push({
          kind: 'meeting-soon',
          itemId: b.itemId,
          title: `${title} in ${lead} min`,
          body: 'Heads up, wrap up what you are doing.',
          silent: false
        })
      }
      if (inside(b, now) && !state.fired.includes(nowKey)) {
        state.fired.push(nowKey)
        events.push({
          kind: 'meeting-now',
          itemId: b.itemId,
          title: `${title} is starting`,
          body: 'Time to join.',
          silent: false
        })
      }
    }
  }

  // Eye rest: active-time counter, reset by idleness.
  if (settings.eye.enabled && working) {
    if (idleSec >= settings.eye.idleResetMin * 60) state.activeMin = 0
    else state.activeMin += elapsedMin
    if (state.activeMin >= settings.eye.intervalMin && (!busy || gentle)) {
      state.activeMin = 0
      state.lastEyeAt = now
      events.push({
        kind: 'eye',
        itemId: null,
        title: 'Rest your eyes',
        body: 'Look at something 20 feet away for 20 seconds.',
        silent: busy
      })
    }
  }

  // Water: spread glasses evenly over working hours.
  if (settings.water.enabled && working && (!busy || gentle)) {
    const { targetMl, glassMl } = settings.water
    const glasses = Math.ceil(targetMl / glassMl)
    const interval = (settings.workEnd - settings.workStart) / glasses
    const dueGlasses = Math.floor((now - settings.workStart) / interval)
    const sinceLast = state.lastWaterAt === null ? Infinity : now - state.lastWaterAt
    if (waterMlToday < dueGlasses * glassMl && sinceLast >= interval) {
      state.lastWaterAt = now
      events.push({
        kind: 'water',
        itemId: null,
        title: 'Water break',
        body: `${waterMlToday} / ${targetMl} ml so far today.`,
        silent: busy
      })
    }
  }

  // Stretch: waits out busy periods.
  if (settings.stretch.enabled && working && !busy) {
    if (now - (state.lastStretchAt ?? settings.workStart) >= settings.stretch.intervalMin) {
      state.lastStretchAt = now
      events.push({
        kind: 'stretch',
        itemId: null,
        title: 'Stretch break',
        body: 'Stand up and loosen your shoulders and back.',
        silent: false
      })
    }
  }

  return { events, state }
}
