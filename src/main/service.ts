import { randomUUID } from 'node:crypto'
import { suggestCallSlots } from '../core/callSlots'
import { applyNudgeAnswer, dueNudges, type NudgeAnswer } from '../core/nudge'
import { itemsForDate, rolloverItems } from '../core/recurrence'
import { dueReminders, EMPTY_REMINDER_STATE, isBusy, type ReminderEvent } from '../core/reminders'
import { diffMoves, frozenBlocks } from '../core/replan'
import { planDay } from '../core/scheduler'
import { addDays, minutesOf, toDateStr } from '../core/time'
import {
  isFixed,
  type Block,
  type DateStr,
  type DecisionAnswer,
  type Item,
  type Minutes,
  type NewItem,
  type Settings
} from '../core/types'
import { loadState, saveState, type AppState, type DayPlan } from './store'

export interface Clock {
  now(): Date
}

export interface ViewState {
  today: DateStr
  now: Minutes
  settings: Settings
  plan: DayPlan
  items: Item[] // itemsForDate(today)
  upcoming: Item[] // open, date > today
  awaitingCalls: Item[] // type call, not fixed, open, today
  nudges: string[]
  busy: boolean
  waterMl: number
}

const MAX_ELAPSED_MIN = 5
/** Matches nudge.ts MAX_NUDGES: a nudge state at this count is never repeated. */
const NUDGES_EXHAUSTED = 2

const emptyPlan = (): DayPlan => ({ blocks: [], decisions: [], unscheduled: [], moves: [] })
const byCreated = (a: Item, b: Item): number => a.createdAt - b.createdAt
const isAwaitingCall = (i: Item): boolean => i.type === 'call' && !isFixed(i) && i.status === 'open'
const sameBlock = (a: Block, b: Block): boolean =>
  a.itemId === b.itemId && a.start === b.start && a.end === b.end

/** Owns the app state and every mutation; glues the pure core modules to the JSON store. */
export class DayfitService {
  private state: AppState
  /** Decision answers other than tomorrow/drop: current day only, not persisted. */
  private answers: DecisionAnswer[] = []
  private lastTickAt: number | null = null

  constructor(
    private readonly file: string,
    private readonly clock: Clock,
    private readonly idGen: () => string = randomUUID
  ) {
    this.state = loadState(file)
  }

  view(): ViewState {
    this.ensureDay()
    return this.buildView()
  }

  addItems(items: NewItem[]): ViewState {
    this.ensureDay()
    const createdAt = this.clock.now().getTime()
    for (const n of items)
      this.state.items.push({
        ...n,
        id: this.idGen(),
        status: 'open',
        lockedStart: null,
        suggestedSlots: [],
        createdAt
      })
    return this.replanAndSave()
  }

  updateItem(id: string, patch: Partial<Item>): ViewState {
    this.ensureDay()
    const item = this.find(id)
    if (!item) return this.buildView()
    // Repeating items carry one status for every day, so they cannot be marked done.
    if (patch.status === 'done' && item.repeat.kind !== 'none') return this.buildView()
    Object.assign(item, patch, { id: item.id, createdAt: item.createdAt })
    if (item.status !== 'open') this.state.overdue = this.state.overdue.filter((o) => o !== id)
    return this.replanAndSave()
  }

  replan(): ViewState {
    this.ensureDay()
    return this.replanAndSave()
  }

  answerDecisions(answers: DecisionAnswer[]): ViewState {
    this.ensureDay()
    const today = this.today()
    for (const a of answers) {
      const item = this.find(a.itemId)
      if (a.choice === 'tomorrow' || a.choice === 'drop') {
        if (item && a.choice === 'tomorrow') {
          item.date = addDays(today, 1)
          item.lockedStart = null
          item.suggestedSlots = []
        }
        if (item && a.choice === 'drop') item.status = 'dropped'
        this.answers = this.answers.filter((x) => x.itemId !== a.itemId)
      } else {
        this.answers = [...this.answers.filter((x) => x.itemId !== a.itemId), { ...a }]
      }
    }
    return this.replanAndSave()
  }

  answerNudge(id: string, answer: NudgeAnswer): ViewState {
    this.ensureDay()
    const now = this.nowMin()
    this.state.overdue = this.state.overdue.filter((o) => o !== id)
    delete this.state.nudges[id]
    const item = this.find(id)
    if (!item) {
      this.save()
      return this.buildView()
    }
    const block = this.latestBlock(id)
    if (!block) {
      if (answer === 'done' && item.repeat.kind === 'none') item.status = 'done'
      return this.replanAndSave()
    }
    const result = applyNudgeAnswer(item, block, answer, now)
    if (result.item.status === 'done' && item.repeat.kind !== 'none') {
      // Keep the series open; just stop nudging it for the rest of today.
      this.state.nudges[id] = { count: NUDGES_EXHAUSTED, lastAt: now }
    } else {
      Object.assign(item, result.item)
    }
    return this.replanAndSave((frozen) => {
      if (answer === 'move') return frozen.filter((b) => b.itemId !== id)
      const kept = frozen.filter((b) => !sameBlock(b, block))
      return result.frozen ? [...kept, result.frozen] : kept
    })
  }

  confirmCall(id: string, start: Minutes): ViewState {
    this.ensureDay()
    const item = this.find(id)
    if (!item) return this.buildView()
    item.fixedStart = start
    item.suggestedSlots = []
    return this.replanAndSave()
  }

  setLock(id: string, locked: boolean): ViewState {
    this.ensureDay()
    const item = this.find(id)
    if (!item) return this.buildView()
    const first = this.todayPlan()
      .blocks.filter((b) => b.itemId === id && b.kind !== 'walk')
      .sort((a, b) => a.start - b.start)[0]
    item.lockedStart = locked ? (first?.start ?? null) : null
    this.save()
    return this.buildView()
  }

  logWater(): ViewState {
    this.ensureDay()
    const today = this.today()
    this.state.waterMl[today] = (this.state.waterMl[today] ?? 0) + this.state.settings.water.glassMl
    this.save()
    return this.buildView()
  }

  setManualBusy(v: boolean | null): ViewState {
    this.ensureDay()
    this.state.manualBusy = v
    this.save()
    return this.buildView()
  }

  updateSettings(p: Partial<Settings>): ViewState {
    this.ensureDay()
    this.state.settings = { ...this.state.settings, ...p }
    return this.replanAndSave()
  }

  tick(idleSec: number): { events: ReminderEvent[]; nudges: string[]; view: ViewState } {
    this.ensureDay()
    const at = this.clock.now().getTime()
    const elapsedMin =
      this.lastTickAt === null
        ? 0
        : Math.min(MAX_ELAPSED_MIN, Math.max(0, (at - this.lastTickAt) / 60000))
    this.lastTickAt = at

    const s = this.state
    const today = this.today()
    const now = this.nowMin()
    const blocks = this.todayPlan().blocks
    const items = itemsForDate(s.items, today)
    const before = JSON.stringify(s.reminder)

    const r = dueReminders({
      now,
      elapsedMin,
      idleSec,
      blocks,
      items,
      settings: s.settings,
      waterMlToday: s.waterMl[today] ?? 0,
      manualBusy: s.manualBusy,
      state: s.reminder
    })
    s.reminder = r.state

    const nudges = dueNudges(blocks, items, now, s.nudges)
    for (const id of nudges) {
      s.nudges[id] = { count: (s.nudges[id]?.count ?? 0) + 1, lastAt: now }
      if (!s.overdue.includes(id)) s.overdue.push(id)
    }

    if (nudges.length > 0 || JSON.stringify(s.reminder) !== before) this.save()
    return { events: r.events, nudges, view: this.buildView() }
  }

  // --- internals ---

  private today(): DateStr {
    return toDateStr(this.clock.now())
  }

  private nowMin(): Minutes {
    return minutesOf(this.clock.now())
  }

  private find(id: string): Item | undefined {
    return this.state.items.find((i) => i.id === id)
  }

  private todayPlan(): DayPlan {
    return this.state.plans[this.today()] ?? emptyPlan()
  }

  /** The item's latest-ending non-walk block in today's plan. */
  private latestBlock(id: string): Block | undefined {
    return this.todayPlan()
      .blocks.filter((b) => b.itemId === id && b.kind !== 'walk')
      .reduce<Block | undefined>((best, b) => (!best || b.end > best.end ? b : best), undefined)
  }

  private save(): void {
    saveState(this.file, this.state)
  }

  /** Day rollover, run lazily whenever the local date has changed since the last run. */
  private ensureDay(): void {
    const today = this.today()
    if (this.state.lastDate === today) return
    const s = this.state
    s.items = rolloverItems(s.items, today)
    s.reminder = structuredClone(EMPTY_REMINDER_STATE)
    s.nudges = {}
    s.overdue = []
    s.lastDate = today
    this.answers = []
    this.replanAndSave()
  }

  /** Re-plans today; `adjustFrozen` edits the frozen set first (nudge answers). */
  private replanAndSave(adjustFrozen?: (frozen: Block[]) => Block[]): ViewState {
    const s = this.state
    const today = this.today()
    const now = this.nowMin()
    const prev = this.todayPlan().blocks
    let items = itemsForDate(s.items, today)
    const ids = new Set(items.map((i) => i.id))
    const done = new Set(items.filter((i) => i.status === 'done').map((i) => i.id))

    let frozen = frozenBlocks(prev, items, now, new Set(s.overdue))
      .filter((b) => b.itemId === null || ids.has(b.itemId))
      .filter((b) => !(b.itemId !== null && done.has(b.itemId) && b.start > now))
      .map((b) =>
        b.itemId !== null && done.has(b.itemId) ? { ...b, end: Math.min(b.end, now) } : b
      )
    if (adjustFrozen) frozen = adjustFrozen(frozen)

    const input = { date: today, now, settings: s.settings, frozen, answers: this.answers }
    const first = planDay({ ...input, items })
    for (const item of items.filter(isAwaitingCall)) {
      const stored = this.find(item.id) as Item
      stored.suggestedSlots = suggestCallSlots(first.blocks, item.durationMin, now, s.settings)
    }
    items = itemsForDate(s.items, today)
    const next = planDay({ ...input, items })

    s.plans[today] = { ...next, moves: diffMoves(prev, next.blocks) }
    this.save()
    return this.buildView()
  }

  private buildView(): ViewState {
    const s = this.state
    const today = this.today()
    const now = this.nowMin()
    const plan = this.todayPlan()
    const items = itemsForDate(s.items, today)
    return structuredClone({
      today,
      now,
      settings: s.settings,
      plan,
      items,
      upcoming: s.items
        .filter((i) => i.status === 'open' && i.date > today)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : byCreated(a, b))),
      awaitingCalls: items.filter(isAwaitingCall).sort(byCreated),
      nudges: [...s.overdue],
      busy: isBusy(plan.blocks, now, s.manualBusy),
      waterMl: s.waterMl[today] ?? 0
    })
  }
}
