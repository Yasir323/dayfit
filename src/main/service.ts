import { randomUUID } from 'node:crypto'
import { suggestCallSlots } from '../core/callSlots'
import { applyNudgeAnswer, dueNudges, type NudgeAnswer } from '../core/nudge'
import { itemsForDate, rolloverItems } from '../core/recurrence'
import { dueReminders, EMPTY_REMINDER_STATE, type ReminderEvent } from '../core/reminders'
import { diffMoves, frozenBlocks } from '../core/replan'
import { clearAlerts, recordAlerts, type Alert } from '../core/alerts'
import { isHeld, PART_ORDER, snoozeBreak, type BreakPart } from '../core/breaks'
import {
  attendanceDue,
  markPunched,
  startCheckout,
  stepEndOfDay,
  EMPTY_END_OF_DAY_STATE,
  type AttendanceKind
} from '../core/endOfDay'
import { lunchPickError, planDay, slotError } from '../core/scheduler'
import { addDays, minutesOf, toDateStr, weekOf } from '../core/time'
import {
  isFixed,
  type Block,
  type DateStr,
  type DecisionAnswer,
  type Item,
  type LunchAnswer,
  type LunchChoice,
  type Minutes,
  type NewItem,
  type Settings
} from '../core/types'
import { openDb, type Db } from './db'
import { loadState, saveState, type AppState, type DayPlan, type StateSource } from './store'

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
  tomorrow: Item[] // open, itemsForDate(tomorrow), repeating included
  week: { date: DateStr; count: number }[] // Monday–Sunday of today's week
  awaitingCalls: Item[] // type call, not fixed, open, today
  nudges: string[]
  busy: boolean
  manualBusy: boolean | null
  waterMl: number
  coffee: number
  /** Attendance punches owed right now (banner). */
  attendance: { in: boolean; out: boolean }
  /** "Done for today" pressed on the check-out screen. */
  checkedOut: boolean
  /** Reminder banners not yet acted on. */
  alerts: Alert[]
  /** Short label for the menu bar, or null once seen. */
  trayLabel: string | null
  /** The running focus session, if any. */
  focus: { itemId: string; title: string; endsAt: number; minutesLeft: number } | null
  /** False when the quick-add shortcut could not be registered (set by the shell). */
  hotkeyOk: boolean
}

const MAX_ELAPSED_MIN = 5
const CALL_SLOTS = 3
/** Matches nudge.ts MAX_NUDGES: a nudge state at this count is never repeated. */
const NUDGES_EXHAUSTED = 2

const byFixedThenCreated = (a: Item, b: Item): number =>
  (a.fixedStart ?? Infinity) === (b.fixedStart ?? Infinity)
    ? a.createdAt - b.createdAt
    : (a.fixedStart ?? Infinity) < (b.fixedStart ?? Infinity)
      ? -1
      : 1

const emptyPlan = (): DayPlan => ({ blocks: [], decisions: [], unscheduled: [], moves: [] })
const byCreated = (a: Item, b: Item): number => a.createdAt - b.createdAt
const isAwaitingCall = (i: Item): boolean => i.type === 'call' && !isFixed(i) && i.status === 'open'
const sameBlock = (a: Block, b: Block): boolean =>
  a.itemId === b.itemId && a.start === b.start && a.end === b.end

/** Owns the app state and every mutation; glues the pure core modules to the JSON store. */
export class DayfitService {
  private state: AppState
  /**
   * Today's review answers, kept in the state file so they survive a restart: everything except
   * tomorrow/drop on non-repeating items, which are applied to the item instead.
   */
  private get answers(): DecisionAnswer[] {
    return this.state.answers
  }
  private set answers(a: DecisionAnswer[]) {
    this.state.answers = a
  }
  private lastTickAt: number | null = null
  private hotkeyOk = true
  /** Clock snapshot taken once per public call, so date and minutes always agree. */
  private at: Date

  private readonly db: Db

  constructor(
    source: StateSource,
    private readonly clock: Clock,
    private readonly idGen: () => string = randomUUID
  ) {
    this.db = typeof source === 'string' ? openDb(source) : source
    this.state = loadState(this.db)
    this.at = clock.now()
  }

  view(): ViewState {
    this.begin()
    return this.buildView()
  }

  addItems(items: NewItem[]): ViewState {
    this.begin()
    const createdAt = this.at.getTime()
    const today = this.today()
    for (const n of items)
      this.state.items.push({
        ...n,
        // A one-off dated in the past (e.g. a form opened before midnight) belongs to today.
        date: n.repeat.kind === 'none' && n.date < today ? today : n.date,
        id: this.idGen(),
        status: 'open',
        lockedStart: null,
        suggestedSlots: [],
        createdAt
      })
    return this.replanAndSave()
  }

  updateItem(id: string, patch: Partial<Item>): ViewState {
    this.begin()
    const item = this.find(id)
    if (!item) return this.buildView()
    const { status, ...rest } = patch
    Object.assign(item, rest, { id: item.id, createdAt: item.createdAt })
    // A repeating item is done for today only: the series stays open.
    if (status === 'done' && item.repeat.kind !== 'none') {
      const today = this.today()
      item.doneDates = [...new Set([...(item.doneDates ?? []), today])]
    } else if (status !== undefined) item.status = status
    return this.replanAndSave()
  }

  replan(): ViewState {
    this.begin()
    return this.replanAndSave()
  }

  answerDecisions(answers: DecisionAnswer[], choice?: LunchChoice): ViewState {
    this.begin()
    const today = this.today()
    const lunch = choice && this.resolveLunch(choice)
    if (lunch) {
      if (lunch.kind === 'at') {
        const error = lunchPickError(
          lunch.start,
          lunch.len,
          this.todayPlan().blocks,
          itemsForDate(this.state.items, today),
          this.state.settings,
          this.nowMin()
        )
        if (error) throw new Error(error)
      }
      this.state.lunchAnswer = { date: today, answer: lunch }
    }
    for (const a of answers) {
      const item = this.find(a.itemId)
      const repeating = item !== undefined && item.repeat.kind !== 'none'
      // Repeating items: tomorrow/drop skip today only, so the series is left untouched.
      if ((a.choice === 'tomorrow' || a.choice === 'drop') && !repeating) {
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
    this.begin()
    const item = this.find(id)
    if (!item || !this.state.overdue.includes(id)) return this.buildView()
    const now = this.nowMin()
    this.state.overdue = this.state.overdue.filter((o) => o !== id)
    delete this.state.nudges[id]
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
      const moved = (): Block[] => frozen.filter((b) => b.itemId !== id)
      if (answer === 'move') return moved()
      const kept = frozen.filter((b) => !sameBlock(b, block))
      if (!result.frozen) return kept
      if (answer === 'extend') {
        // Clip the extension before the next fixed, locked or frozen block; no room means move.
        const end = Math.min(result.frozen.end, this.nextObstacle(block, kept))
        if (end <= Math.max(block.end, now)) return moved()
        return [...kept, { ...result.frozen, end }]
      }
      return [...kept, result.frozen]
    })
  }

  confirmCall(id: string, start: Minutes): ViewState {
    this.begin()
    const item = this.find(id)
    if (!item || start < this.nowMin()) return this.buildView()
    item.fixedStart = start
    item.suggestedSlots = []
    return this.replanAndSave()
  }

  /** Forgets today's "keep unscheduled" answer for the item and plans it again. */
  planNow(id: string): ViewState {
    this.begin()
    this.answers = this.answers.filter((a) => a.itemId !== id)
    return this.replanAndSave()
  }

  /** Lock in place, or (drag and drop) lock at `start`; an invalid start throws its reason. */
  setLock(id: string, locked: boolean, start?: Minutes): ViewState {
    this.begin()
    const item = this.find(id)
    if (!item) return this.buildView()
    if (locked && typeof start === 'number') {
      const error = slotError(
        start,
        item.durationMin,
        this.todayPlan().blocks,
        itemsForDate(this.state.items, this.today()),
        this.state.settings,
        this.nowMin(),
        id
      )
      if (error) throw new Error(error)
      item.lockedStart = start
      return this.replanAndSave()
    }
    if (locked) {
      // Only a single, unchunked block can be locked: a lock stores one start for the whole item.
      const own = this.todayPlan().blocks.filter((b) => b.itemId === id)
      if (own.length !== 1 || own[0].chunk !== null) return this.buildView()
      item.lockedStart = own[0].start
    } else {
      item.lockedStart = null
    }
    this.save()
    return this.buildView()
  }

  /** Starts a focus session on an item: busy mode holds breaks and nudges until it ends. */
  startFocus(itemId: string, minutes: number): ViewState {
    this.begin()
    const s = this.state
    const item = this.find(itemId)
    const len = Math.min(180, Math.max(1, Math.round(Number(minutes) || 25)))
    if (!item) return this.buildView()
    const prev = s.focus ? s.focus.prevManualBusy : s.manualBusy
    s.focus = {
      itemId,
      endsAt: this.at.getTime() + len * 60_000,
      minutes: len,
      prevManualBusy: prev
    }
    s.manualBusy = true
    this.save()
    return this.buildView()
  }

  /** Ends a focus session early; busy mode goes back to what it was. */
  stopFocus(): ViewState {
    this.begin()
    const s = this.state
    if (s.focus) {
      s.manualBusy = s.focus.prevManualBusy
      s.focus = null
      this.save()
    }
    return this.buildView()
  }

  /** Tomorrow's plan from the start of work, for the evening preview; nothing is saved. */
  previewTomorrow(): { date: DateStr; blocks: Block[]; items: Item[] } {
    this.begin()
    const s = this.state
    const date = addDays(this.today(), 1)
    const items = itemsForDate(s.items, date)
    const plan = planDay({
      date,
      now: s.settings.workStart,
      items,
      settings: s.settings,
      frozen: [],
      answers: [],
      lunch: null
    })
    return { date, blocks: plan.blocks, items }
  }

  /** Notification Snooze: the last break comes back after `breaks.snoozeMin` minutes. */
  /** `parts`: the snoozed notification's parts; the popover banner passes none (last break). */
  snoozeBreak(parts?: BreakPart[]): ViewState {
    this.begin()
    const s = this.state
    const given = Array.isArray(parts) ? parts : []
    // An older notification's snooze only clears break banners it covers.
    this.clearAlerts(
      (a) => a.kind === 'break' && (given.length === 0 || a.parts.every((p) => given.includes(p)))
    )
    s.reminder = {
      ...s.reminder,
      breaks: snoozeBreak(s.reminder.breaks, this.nowMin(), s.settings.breaks.snoozeMin, given)
    }
    this.save()
    return this.buildView()
  }

  /** Drops alerts the user has acted on; true when anything changed. */
  private clearAlerts(gone: (a: Alert) => boolean): boolean {
    const s = this.state
    const r = clearAlerts(s.alerts, s.unseen, gone, s.settings)
    const changed = r.alerts.length !== s.alerts.length || r.unseen !== s.unseen
    s.alerts = r.alerts
    s.unseen = r.unseen
    return changed
  }

  /** The popover was opened: the menu-bar label has been seen. */
  markSeen(): ViewState {
    this.begin()
    if (this.state.unseen !== null) {
      this.state.unseen = null
      this.save()
    }
    return this.buildView()
  }

  /** Closes one reminder banner; an id that is already gone is ignored. */
  dismissAlert(id: string): ViewState {
    this.begin()
    if (this.clearAlerts((a) => a.id === id)) this.save()
    return this.buildView()
  }

  /** Attendance "Punched": stops that day's reminder for check-in or check-out. */
  markPunched(kind: AttendanceKind): ViewState {
    this.begin()
    this.state.endOfDay = markPunched(this.state.endOfDay, kind)
    this.save()
    return this.buildView()
  }

  /** "Done for today": applies each unfinished item's choice, then starts the check-out punch. */
  checkOut(choices: { itemId: string; choice: 'tomorrow' | 'unscheduled' | 'drop' }[]): ViewState {
    this.begin()
    const tomorrow = addDays(this.today(), 1)
    const unscheduled = new Set<string>()
    for (const { itemId, choice } of choices) {
      const item = this.find(itemId)
      // Items finished or removed since the screen opened are left alone.
      if (!item || item.status !== 'open') continue
      if (choice === 'tomorrow') {
        item.date = tomorrow
        item.lockedStart = null
        item.suggestedSlots = []
      } else if (choice === 'drop') item.status = 'dropped'
      else {
        this.answers = [...this.answers.filter((a) => a.itemId !== itemId), { itemId, choice }]
        // "No time" means no block, no overdue flag and no more time's-up nudges today.
        unscheduled.add(itemId)
        const s = this.state
        s.overdue = s.overdue.filter((id) => id !== itemId)
        s.nudges[itemId] = { count: NUDGES_EXHAUSTED, lastAt: this.nowMin() }
      }
    }
    this.state.endOfDay = startCheckout(this.state.endOfDay)
    // Checked out: the wrap-up and past-hours banners are done with.
    this.clearAlerts((a) => a.kind === 'heads-up' || a.kind === 'overtime')
    return this.replanAndSave((frozen) =>
      frozen.filter((b) => b.itemId === null || !unscheduled.has(b.itemId))
    )
  }

  logCoffee(): ViewState {
    this.begin()
    const today = this.today()
    this.state.coffee[today] = (this.state.coffee[today] ?? 0) + 1
    this.save()
    return this.buildView()
  }

  logWater(): ViewState {
    this.begin()
    const today = this.today()
    this.state.waterMl[today] = (this.state.waterMl[today] ?? 0) + this.state.settings.water.glassMl
    // A glass logged anywhere answers a pending water break.
    this.clearAlerts((a) => a.kind === 'break' && a.parts.includes('water'))
    this.save()
    return this.buildView()
  }

  setManualBusy(v: boolean | null): ViewState {
    this.begin()
    this.state.manualBusy = v
    this.save()
    return this.buildView()
  }

  /** Called by the shell after (re)registering the quick-add shortcut; not persisted. */
  setHotkeyOk(ok: boolean): void {
    this.hotkeyOk = ok
  }

  updateSettings(p: Partial<Settings>): ViewState {
    this.begin()
    const old = this.state.settings
    // A new lunch time or length overrides today's clash answer.
    if (
      (p.lunch !== undefined && p.lunch !== old.lunch) ||
      (p.endOfDay !== undefined && p.endOfDay.lunchMin !== old.endOfDay.lunchMin)
    )
      this.state.lunchAnswer = null
    this.state.settings = { ...this.state.settings, ...p }
    return this.replanAndSave()
  }

  tick(idleSec: number): { events: ReminderEvent[]; nudges: string[]; view: ViewState } {
    this.begin()
    const at = this.at.getTime()
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
    const before = JSON.stringify([s.reminder, s.endOfDay, s.alerts, s.unseen, s.focus])

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
    const eod = stepEndOfDay({
      now,
      idleSec,
      blocks,
      items,
      settings: s.settings,
      manualBusy: s.manualBusy,
      coffeeToday: s.coffee[today] ?? 0,
      state: s.endOfDay
    })
    s.endOfDay = eod.state
    const events: ReminderEvent[] = [
      ...r.events,
      ...eod.events.map((e) => ({ ...e, itemId: null, silent: false, parts: [] }))
    ]

    // While busy, nudge notifications wait (uncounted) for the first non-busy tick;
    // the item still shows as overdue in the app.
    const due = dueNudges(blocks, items, now, s.nudges)
    // Nudges wait only inside a running DND / high-priority block (no gap rule): the moment
    // between two focus tasks is exactly when "time's up" is useful.
    const busy = isHeld(blocks, items, now, s.manualBusy, 0)
    const overdueBefore = s.overdue.length
    for (const id of due) if (!s.overdue.includes(id)) s.overdue.push(id)
    const nudges = busy ? [] : due
    for (const id of nudges) s.nudges[id] = { count: (s.nudges[id]?.count ?? 0) + 1, lastAt: now }

    // A focus session past its end finishes once: busy goes back, and a short break is queued.
    if (s.focus && at >= s.focus.endsAt) {
      s.manualBusy = s.focus.prevManualBusy
      s.focus = null
      const pending = new Set([...s.reminder.breaks.pending, 'eye', 'stretch'])
      s.reminder = {
        ...s.reminder,
        breaks: { ...s.reminder.breaks, pending: PART_ORDER.filter((p) => pending.has(p)) }
      }
      events.push({
        kind: 'focus-done',
        itemId: null,
        title: 'Focus done',
        body: 'Take 5 — stretch and rest your eyes.',
        silent: false,
        parts: []
      })
    }

    const rec = recordAlerts(s.alerts, s.unseen, events, nudges.length, now, s.settings)
    s.alerts = rec.alerts
    s.unseen = rec.unseen

    if (
      nudges.length > 0 ||
      s.overdue.length !== overdueBefore ||
      JSON.stringify([s.reminder, s.endOfDay, s.alerts, s.unseen, s.focus]) !== before
    )
      this.save()
    return { events, nudges, view: this.buildView() }
  }

  // --- internals ---

  private begin(): void {
    this.at = this.clock.now()
    this.ensureDay()
  }

  private today(): DateStr {
    return toDateStr(this.at)
  }

  private nowMin(): Minutes {
    return minutesOf(this.at)
  }

  private find(id: string): Item | undefined {
    return this.state.items.find((i) => i.id === id)
  }

  private todayPlan(): DayPlan {
    return this.state.plans[this.today()] ?? emptyPlan()
  }

  /** Latest end allowed after `block`: buffer before the next fixed, locked or frozen block. */
  private nextObstacle(block: Block, frozen: Block[]): Minutes {
    const starts = [
      ...frozen.map((b) => b.start),
      // Lunch is planned ahead of tasks; an extension must not push it.
      ...this.todayPlan()
        .blocks.filter((b) => b.kind === 'lunch')
        .map((b) => b.start),
      ...itemsForDate(this.state.items, this.today()).flatMap((i) =>
        i.id === block.itemId ? [] : (i.fixedStart ?? i.lockedStart ?? [])
      )
    ].filter((start) => start > block.start)
    return Math.min(...starts) - this.state.settings.bufferMin
  }

  /** The item's latest-ending block in today's plan. */
  private latestBlock(id: string): Block | undefined {
    return this.todayPlan()
      .blocks.filter((b) => b.itemId === id)
      .reduce<Block | undefined>((best, b) => (!best || b.end > best.end ? b : best), undefined)
  }

  private save(): void {
    saveState(this.db, this.state)
  }

  /** Day rollover, run lazily whenever the local date has changed since the last run. */
  private ensureDay(): void {
    const today = this.today()
    if (this.state.lastDate === today) return
    const s = this.state
    s.items = rolloverItems(s.items, today)
    s.reminder = structuredClone(EMPTY_REMINDER_STATE)
    s.endOfDay = structuredClone(EMPTY_END_OF_DAY_STATE)
    s.lunchAnswer = null
    s.alerts = []
    s.unseen = null
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
    const hadPlan = today in s.plans
    const prev = this.todayPlan().blocks
    let items = itemsForDate(s.items, today)
    const ids = new Set(items.map((i) => i.id))
    const done = new Set(items.filter((i) => i.status === 'done').map((i) => i.id))
    const open = new Set(items.filter((i) => i.status === 'open').map((i) => i.id))
    s.overdue = s.overdue.filter((id) => open.has(id))
    for (const id of Object.keys(s.nudges)) if (!open.has(id)) delete s.nudges[id]

    let frozen = frozenBlocks(prev, items, now, new Set(s.overdue))
      .filter((b) => b.itemId === null || ids.has(b.itemId))
      .filter((b) => !(b.itemId !== null && done.has(b.itemId) && b.start >= now))
      .map((b) =>
        b.itemId !== null && done.has(b.itemId) ? { ...b, end: Math.min(b.end, now) } : b
      )
    if (adjustFrozen) frozen = adjustFrozen(frozen)

    const lunch = s.lunchAnswer?.date === today ? s.lunchAnswer.answer : null
    const input = { date: today, now, settings: s.settings, frozen, answers: this.answers, lunch }
    const first = planDay({ ...input, items })
    for (const item of items.filter(isAwaitingCall))
      (this.find(item.id) as Item).suggestedSlots = this.callSlots(item, first.blocks, now)
    items = itemsForDate(s.items, today)
    const next = planDay({ ...input, items })

    // A saved lunch answer that a new fixed item now covers is dropped; the clash is asked again.
    if (next.lunchAnswerRejected) s.lunchAnswer = null
    s.plans[today] = { ...next, moves: hadPlan ? diffMoves(prev, next.blocks) : [] }
    this.save()
    return this.buildView()
  }

  /**
   * Shorten / move are offers computed at the last replan; re-plan now (without a saved answer)
   * and take the current offer, so a stale view never books a time that has already passed.
   */
  private resolveLunch(choice: LunchChoice): LunchAnswer {
    if (choice.kind === 'skip' || choice.kind === 'at') return choice
    this.state.lunchAnswer = null
    this.replanAndSave()
    const clash = this.todayPlan().lunchClash ?? null
    const len = this.state.settings.endOfDay.lunchMin
    if (choice.kind === 'shorten' && clash?.shorten) return { kind: 'at', ...clash.shorten }
    if (choice.kind === 'move' && clash && clash.move !== null)
      return { kind: 'at', start: clash.move, len }
    throw new Error('That option is no longer available')
  }

  /** Keeps earlier suggestions that are still ahead and free, then fills up to CALL_SLOTS. */
  private callSlots(item: Item, blocks: Block[], now: Minutes): Minutes[] {
    const st = this.state.settings
    const free = (start: Minutes): boolean =>
      start >= Math.max(now, st.workStart) &&
      start + item.durationMin <= st.workEnd &&
      blocks.every(
        (b) => start + item.durationMin + st.bufferMin <= b.start || start >= b.end + st.bufferMin
      )
    const kept = item.suggestedSlots.filter(free).slice(0, CALL_SLOTS)
    const held: Block[] = kept.map((start) => ({
      itemId: item.id,
      kind: 'task',
      start,
      end: start + item.durationMin,
      chunk: null,
      reason: 'Suggested call slot'
    }))
    const extra = suggestCallSlots(
      [...blocks, ...held],
      item.durationMin,
      now,
      st,
      CALL_SLOTS - kept.length
    )
    return [...kept, ...extra].sort((a, b) => a - b)
  }

  private buildView(): ViewState {
    const focus = this.state.focus
      ? {
          itemId: this.state.focus.itemId,
          title: this.find(this.state.focus.itemId)?.title ?? 'Focus',
          endsAt: this.state.focus.endsAt,
          minutesLeft: Math.max(
            0,
            Math.ceil((this.state.focus.endsAt - this.at.getTime()) / 60_000)
          )
        }
      : null
    const s = this.state
    const today = this.today()
    const now = this.nowMin()
    const plan = this.todayPlan()
    // Call slots already in the past are stale until the next replan; never offer them.
    const items = itemsForDate(s.items, today).map((i) =>
      i.suggestedSlots.some((x) => x < now)
        ? { ...i, suggestedSlots: i.suggestedSlots.filter((x) => x >= now) }
        : i
    )
    return structuredClone({
      today,
      now,
      settings: s.settings,
      plan: { ...plan, lunchClash: plan.lunchClash ?? null },
      items,
      upcoming: s.items
        .filter((i) => i.status === 'open' && i.date > today)
        .sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : byCreated(a, b))),
      tomorrow: itemsForDate(s.items, addDays(today, 1))
        .filter((i) => i.status === 'open')
        .sort(byFixedThenCreated),
      week: weekOf(today).map((date) => ({
        date,
        count: itemsForDate(s.items, date).length
      })),
      awaitingCalls: items.filter(isAwaitingCall).sort(byCreated),
      nudges: [...s.overdue],
      busy: isHeld(
        plan.blocks,
        itemsForDate(s.items, today),
        now,
        s.manualBusy,
        s.settings.bufferMin
      ),
      manualBusy: s.manualBusy,
      waterMl: s.waterMl[today] ?? 0,
      coffee: s.coffee[today] ?? 0,
      attendance: attendanceDue(s.endOfDay, now, s.settings),
      checkedOut: s.endOfDay.checkedOut,
      alerts: s.alerts,
      trayLabel: s.unseen ?? (focus ? `Focus ${focus.minutesLeft}m` : null),
      focus,
      hotkeyOk: this.hotkeyOk
    })
  }
}
