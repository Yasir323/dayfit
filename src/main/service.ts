import { randomUUID } from 'node:crypto'
import { suggestCallSlots } from '../core/callSlots'
import { applyNudgeAnswer, dueNudges, type NudgeAnswer } from '../core/nudge'
import { itemsForDate, rolloverItems } from '../core/recurrence'
import { dueReminders, EMPTY_REMINDER_STATE, isBusy, type ReminderEvent } from '../core/reminders'
import { diffMoves, frozenBlocks } from '../core/replan'
import { recordAlerts, type Alert } from '../core/alerts'
import { snoozeBreak } from '../core/breaks'
import {
  attendanceDue,
  markPunched,
  startCheckout,
  stepEndOfDay,
  EMPTY_END_OF_DAY_STATE,
  type AttendanceKind
} from '../core/endOfDay'
import { lunchPickError, planDay } from '../core/scheduler'
import { addDays, minutesOf, toDateStr, weekday } from '../core/time'
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
  tomorrow: Item[] // open, itemsForDate(tomorrow), repeating included
  week: { date: DateStr; count: number }[] // Monday–Sunday of today's week
  awaitingCalls: Item[] // type call, not fixed, open, today
  nudges: string[]
  busy: boolean
  manualBusy: boolean | null
  waterMl: number
  /** Attendance punches owed right now (banner). */
  attendance: { in: boolean; out: boolean }
  /** "Done for today" pressed on the check-out screen. */
  checkedOut: boolean
  /** Reminder banners not yet acted on. */
  alerts: Alert[]
  /** Short label for the menu bar, or null once seen. */
  trayLabel: string | null
  /** False when the quick-add shortcut could not be registered (set by the shell). */
  hotkeyOk: boolean
}

const MAX_ELAPSED_MIN = 5
const CALL_SLOTS = 3
/** Matches nudge.ts MAX_NUDGES: a nudge state at this count is never repeated. */
const NUDGES_EXHAUSTED = 2

/** Monday–Sunday of the week containing `today`; mirrors weekOf in src/renderer/src/lib/dates.ts. */
const weekDates = (today: DateStr): DateStr[] => {
  const monday = addDays(today, -((weekday(today) + 6) % 7))
  return Array.from({ length: 7 }, (_, i) => addDays(monday, i))
}
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
  /** Decision answers kept for the current day only (not persisted): everything except
   *  tomorrow/drop on non-repeating items, which are applied to the item instead. */
  private answers: DecisionAnswer[] = []
  private lastTickAt: number | null = null
  private hotkeyOk = true
  /** Clock snapshot taken once per public call, so date and minutes always agree. */
  private at: Date

  constructor(
    private readonly file: string,
    private readonly clock: Clock,
    private readonly idGen: () => string = randomUUID
  ) {
    this.state = loadState(file)
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
    // Repeating items carry one status for every day, so they cannot be marked done.
    if (status !== undefined && !(status === 'done' && item.repeat.kind !== 'none'))
      item.status = status
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

  setLock(id: string, locked: boolean): ViewState {
    this.begin()
    const item = this.find(id)
    if (!item) return this.buildView()
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

  /** Notification Snooze: the last break comes back after `breaks.snoozeMin` minutes. */
  snoozeBreak(): ViewState {
    this.begin()
    const s = this.state
    s.alerts = s.alerts.filter((a) => a.kind !== 'break')
    s.reminder = {
      ...s.reminder,
      breaks: snoozeBreak(s.reminder.breaks, this.nowMin(), s.settings.breaks.snoozeMin)
    }
    this.save()
    return this.buildView()
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
    const before = this.state.alerts.length
    this.state.alerts = this.state.alerts.filter((a) => a.id !== id)
    if (this.state.alerts.length !== before) this.save()
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
    return this.replanAndSave((frozen) =>
      frozen.filter((b) => b.itemId === null || !unscheduled.has(b.itemId))
    )
  }

  logWater(): ViewState {
    this.begin()
    const today = this.today()
    this.state.waterMl[today] = (this.state.waterMl[today] ?? 0) + this.state.settings.water.glassMl
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
    const before = JSON.stringify([s.reminder, s.endOfDay, s.alerts, s.unseen])

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
    const busy = isBusy(blocks, now, s.manualBusy)
    const overdueBefore = s.overdue.length
    for (const id of due) if (!s.overdue.includes(id)) s.overdue.push(id)
    const nudges = busy ? [] : due
    for (const id of nudges) s.nudges[id] = { count: (s.nudges[id]?.count ?? 0) + 1, lastAt: now }

    const rec = recordAlerts(s.alerts, s.unseen, events, nudges.length, now, s.settings)
    s.alerts = rec.alerts
    s.unseen = rec.unseen

    if (
      nudges.length > 0 ||
      s.overdue.length !== overdueBefore ||
      JSON.stringify([s.reminder, s.endOfDay, s.alerts, s.unseen]) !== before
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
    saveState(this.file, this.state)
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
      week: weekDates(today).map((date) => ({
        date,
        count: itemsForDate(s.items, date).length
      })),
      awaitingCalls: items.filter(isAwaitingCall).sort(byCreated),
      nudges: [...s.overdue],
      busy: isBusy(plan.blocks, now, s.manualBusy),
      manualBusy: s.manualBusy,
      waterMl: s.waterMl[today] ?? 0,
      attendance: attendanceDue(s.endOfDay, now, s.settings),
      checkedOut: s.endOfDay.checkedOut,
      alerts: s.alerts,
      trayLabel: s.unseen,
      hotkeyOk: this.hotkeyOk
    })
  }
}
