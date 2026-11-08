import { DEFAULT_SETTINGS, type Block, type Item } from '../../src/core/types'
import type { ViewState } from '../../src/main/service'

export const TODAY = '2026-10-23'

export const item = (id: string, title: string, extra: Partial<Item> = {}): Item => ({
  id,
  title,
  type: 'task',
  durationMin: 30,
  label: null,
  priority: 'med',
  half: null,
  date: TODAY,
  fixedStart: null,
  deadline: null,
  repeat: { kind: 'none' },
  status: 'open',
  lockedStart: null,
  suggestedSlots: [],
  dnd: false,
  createdAt: 1,
  ...extra
})

export const block = (
  itemId: string | null,
  kind: Block['kind'],
  start: number,
  end: number,
  extra: Partial<Block> = {}
): Block => ({
  itemId,
  kind,
  start,
  end,
  chunk: null,
  reason: 'Fits',
  ...extra
})

export function makeView(over: Partial<ViewState> = {}): ViewState {
  return {
    today: TODAY,
    now: 600,
    settings: { ...DEFAULT_SETTINGS, firstRunDone: true },
    plan: {
      blocks: [
        block('standup', 'fixed', 540, 555, { reason: 'Fixed' }),
        block('deep', 'deep', 560, 620, {
          chunk: { index: 0, of: 2 },
          reason: 'Split: no 120m gap'
        }),
        block('deep', 'deep', 625, 685, {
          chunk: { index: 1, of: 2 },
          reason: 'Split: no 120m gap'
        })
      ],
      decisions: [],
      unscheduled: [],
      moves: []
    },
    items: [
      item('standup', 'Standup', {
        type: 'fixed',
        fixedStart: 540,
        durationMin: 15,
        repeat: { kind: 'daily' }
      }),
      item('deep', 'Payments refactor', { type: 'deep', durationMin: 120 })
    ],
    upcoming: [],
    tomorrow: [],
    week: [],
    awaitingCalls: [],
    nudges: [],
    busy: false,
    manualBusy: null,
    waterMl: 500,
    hotkeyOk: true,
    notificationsOk: true,
    calendar: {
      connected: false,
      connecting: false,
      canWrite: false,
      lastSyncAt: null,
      lastError: null
    },
    camera: {
      running: false,
      permission: 'unknown',
      calibrating: false,
      problem: null,
      calibrationFailed: false,
      lastMinute: null,
      setupChanged: false
    },
    attendance: { in: false, out: false },
    checkedOut: false,
    alerts: [],
    trayLabel: null,
    focus: null,
    daySummary: null,
    ergonomics: [],
    autoBusy: false,
    coffee: 0,
    ...over
  }
}
