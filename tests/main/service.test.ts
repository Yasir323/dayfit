import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Block, NewItem } from '../../src/core/types'
import { DayfitService, type Clock, type ViewState } from '../../src/main/service'
import { loadState } from '../../src/main/store'
import { openDb } from '../../src/main/db'
import { EMPTY_BREAK_STATE } from '../../src/core/breaks'
import { EMPTY_END_OF_DAY_STATE } from '../../src/core/endOfDay'

const D = '2026-10-26' // Monday
const D1 = '2026-10-27'

class FakeClock implements Clock {
  private t = new Date(2026, 9, 26, 9, 0)
  now(): Date {
    return new Date(this.t.getTime())
  }
  set(day: number, h: number, m = 0): void {
    this.t = new Date(2026, 9, day, h, m)
  }
}

const newItem = (p: Partial<NewItem> = {}): NewItem => ({
  title: 'T',
  type: 'task',
  durationMin: 30,
  label: null,
  priority: 'med',
  half: null,
  date: D,
  fixedStart: null,
  deadline: null,
  repeat: { kind: 'none' },
  dnd: false,
  ...p
})

const blockOf = (v: ViewState, id: string): Block | undefined =>
  v.plan.blocks.find((b) => b.itemId === id)

let dir: string
let file: string
let clock: FakeClock
let svc: DayfitService
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfit-svc-'))
  file = path.join(dir, 'dayfit.json')
  clock = new FakeClock()
  let n = 0
  svc = new DayfitService(file, clock, () => `id${++n}`)
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('DayfitService', () => {
  it('addItems places a task and the view shows its block', () => {
    const v = svc.addItems([newItem({ title: 'Write report' })])
    expect(v.today).toBe(D)
    expect(v.now).toBe(540)
    expect(v.items.map((i) => i.id)).toEqual(['id1'])
    expect(blockOf(v, 'id1')).toMatchObject({ kind: 'task', start: 540, end: 570 })
    expect(loadState(file).items).toHaveLength(1)
  })

  it('a fixed item landing on a planned task moves the task and reports the move', () => {
    clock.set(26, 8, 0) // before work, so the task is not yet in progress
    svc.addItems([newItem()])
    const v = svc.addItems([newItem({ type: 'fixed', fixedStart: 540 })])
    expect(blockOf(v, 'id2')).toMatchObject({ kind: 'fixed', start: 540, end: 570 })
    expect(blockOf(v, 'id1')).toMatchObject({ start: 575, end: 605 })
    expect(v.plan.moves).toContainEqual({ itemId: 'id1', from: 540, to: 575 })
  })

  it("answering tomorrow moves the item to upcoming with tomorrow's date", () => {
    let v = svc.addItems([newItem({ durationMin: 600 })])
    expect(v.plan.decisions).toEqual([{ kind: 'no-fit', itemId: 'id1' }])
    v = svc.answerDecisions([{ itemId: 'id1', choice: 'tomorrow' }])
    expect(v.items).toEqual([])
    expect(v.upcoming.map((i) => [i.id, i.date])).toEqual([['id1', D1]])
    expect(v.plan.decisions).toEqual([])
  })

  it('a call gets 3 suggested slots; confirming makes it fixed and clears them', () => {
    let v = svc.addItems([newItem({ type: 'call', durationMin: 15 })])
    const call = v.awaitingCalls.find((i) => i.id === 'id1')
    expect(call?.suggestedSlots).toHaveLength(3)
    const start = call!.suggestedSlots[1]
    v = svc.confirmCall('id1', start)
    const item = v.items.find((i) => i.id === 'id1')!
    expect(item.fixedStart).toBe(start)
    expect(item.suggestedSlots).toEqual([])
    expect(v.awaitingCalls).toEqual([])
    expect(blockOf(v, 'id1')).toMatchObject({ kind: 'fixed', start, end: start + 15 })
  })

  it('nudges at block end, leaves the overdue block put, and extend adds 15 min', () => {
    svc.addItems([newItem()])
    clock.set(26, 9, 30)
    let t = svc.tick(0)
    expect(t.nudges).toEqual(['id1'])
    expect(t.view.nudges).toEqual(['id1'])

    clock.set(26, 9, 31)
    t = svc.tick(0)
    expect(t.nudges).toEqual([])
    expect(blockOf(t.view, 'id1')).toMatchObject({ start: 540, end: 570 })
    expect(blockOf(svc.replan(), 'id1')).toMatchObject({ start: 540, end: 570 })

    const v = svc.answerNudge('id1', 'extend')
    expect(v.nudges).toEqual([])
    expect(blockOf(v, 'id1')).toMatchObject({ start: 540, end: 586 })
  })

  it('answering move replans the overdue item from now', () => {
    svc.addItems([newItem()])
    clock.set(26, 9, 30)
    svc.tick(0)
    const v = svc.answerNudge('id1', 'move')
    const b = blockOf(v, 'id1')!
    expect(b.start).toBeGreaterThanOrEqual(570)
    expect(b.end - b.start).toBe(30)
    expect(v.nudges).toEqual([])
  })

  it('answering done marks the item done and keeps its block', () => {
    svc.addItems([newItem()])
    clock.set(26, 9, 30)
    svc.tick(0)
    const v = svc.answerNudge('id1', 'done')
    expect(v.items[0].status).toBe('done')
    expect(blockOf(v, 'id1')).toMatchObject({ start: 540, end: 570 })
  })

  it('answering done on a repeating item marks it done for today only', () => {
    svc.addItems([newItem({ repeat: { kind: 'daily' } })])
    clock.set(26, 9, 30)
    svc.tick(0)
    const v = svc.answerNudge('id1', 'done')
    expect(v.items[0].status).toBe('done')
    expect(loadState(file).items[0]).toMatchObject({ status: 'open', doneDates: [D] })
    clock.set(27, 9, 0)
    expect(svc.view().items[0].status).toBe('open')
  })

  it('a done item keeps only the part of its block before now', () => {
    svc.addItems([newItem({ durationMin: 60 })])
    clock.set(26, 9, 20)
    const v = svc.updateItem('id1', { status: 'done' })
    expect(blockOf(v, 'id1')).toMatchObject({ start: 540, end: 560 })
  })

  it('marking a repeating item done marks today only; the series stays open', () => {
    svc.addItems([newItem({ repeat: { kind: 'daily' } })])
    const v = svc.updateItem('id1', { status: 'done' })
    expect(v.items[0].status).toBe('done')
    expect(loadState(file).items[0].status).toBe('open')
    expect(loadState(file).items[0].doneDates).toEqual([D])
  })

  it('tick across midnight rolls over and replans', () => {
    svc.addItems([newItem(), newItem({ type: 'fixed', fixedStart: 600 })])
    clock.set(26, 9, 56)
    const t = svc.tick(0)
    expect(t.events.map((e) => e.kind)).toContain('meeting-soon')
    expect(loadState(file).reminder.fired).not.toEqual([])

    clock.set(27, 9, 0)
    const { view } = svc.tick(0)
    const s = loadState(file)
    expect(s.items.find((i) => i.id === 'id1')?.date).toBe(D1)
    expect(s.reminder.fired).toEqual([])
    expect(s.lastDate).toBe(D1)
    expect(s.plans[D1]).toBeDefined()
    expect(view.today).toBe(D1)
    expect(blockOf(view, 'id1')).toMatchObject({ start: 540, end: 570 })
  })

  it('extend is clipped before the next fixed item', () => {
    svc.addItems([newItem(), newItem({ type: 'fixed', fixedStart: 585 })])
    clock.set(26, 9, 30)
    svc.tick(0)
    const v = svc.answerNudge('id1', 'extend')
    expect(blockOf(v, 'id1')).toMatchObject({ start: 540, end: 580 })
  })

  it('extend with no room before the next fixed item behaves like move', () => {
    svc.addItems([newItem(), newItem({ type: 'fixed', fixedStart: 575 })])
    clock.set(26, 9, 30)
    svc.tick(0)
    const v = svc.answerNudge('id1', 'extend')
    expect(blockOf(v, 'id1')).toMatchObject({ start: 610, end: 640 })
    expect(v.plan.moves).toContainEqual({ itemId: 'id1', from: 540, to: 610 })
    expect(v.nudges).toEqual([])
  })

  it('answerNudge does nothing for an item that is not overdue', () => {
    svc.addItems([newItem()])
    const v = svc.answerNudge('id1', 'done')
    expect(v.items[0].status).toBe('open')
  })

  it('drop on a repeating item skips it today only', () => {
    svc.addItems([newItem({ durationMin: 600, repeat: { kind: 'daily' } })])
    const v = svc.answerDecisions([{ itemId: 'id1', choice: 'drop' }])
    expect(v.items[0]).toMatchObject({ status: 'open', date: D })
    expect(v.plan.decisions).toEqual([])
    expect(blockOf(v, 'id1')).toBeUndefined()
  })

  it('tomorrow on a repeating item skips it today only', () => {
    svc.addItems([newItem({ durationMin: 600, repeat: { kind: 'daily' } })])
    let v = svc.answerDecisions([{ itemId: 'id1', choice: 'tomorrow' }])
    expect(v.items[0]).toMatchObject({ status: 'open', date: D })
    expect(v.upcoming).toEqual([])
    expect(v.plan.decisions).toEqual([])
    clock.set(27, 9, 0)
    v = svc.view()
    expect(v.plan.decisions).toEqual([{ kind: 'no-fit', itemId: 'id1' }])
  })

  it('an unscheduled answer lasts the day, across restarts, and clears at rollover', () => {
    svc.addItems([newItem({ durationMin: 600 })])
    let v = svc.answerDecisions([{ itemId: 'id1', choice: 'unscheduled' }])
    expect(v.plan.unscheduled).toEqual(['id1'])
    expect(v.plan.decisions).toEqual([])
    v = new DayfitService(file, clock).replan()
    expect(v.plan.unscheduled).toEqual(['id1'])
    clock.set(27, 9, 0)
    expect(new DayfitService(file, clock).view().plan.unscheduled).toEqual([])
  })

  it('a non-tick call rolls the day over lazily and resets nudges', () => {
    svc.addItems([newItem()])
    clock.set(26, 9, 30)
    expect(svc.tick(0).nudges).toEqual(['id1'])
    clock.set(27, 9, 0)
    const v = svc.view()
    expect(v.today).toBe(D1)
    expect(v.nudges).toEqual([])
    expect(v.items.map((i) => [i.id, i.date])).toEqual([['id1', D1]])
    const s = loadState(file)
    expect(s.lastDate).toBe(D1)
    expect(s.nudges).toEqual({})
    expect(s.overdue).toEqual([])
  })

  it('snoozeBreak re-queues the last break', () => {
    svc.markPunched('in')
    svc.tick(0)
    let fired: string[] = []
    for (let m = 1; m <= 20 && fired.length === 0; m++) {
      clock.set(26, 9, m)
      fired = svc.tick(0).events.map((e) => e.kind)
    }
    expect(fired).toEqual(['break'])
    svc.snoozeBreak()
    clock.set(26, 9, 25)
    expect(svc.tick(0).events).toEqual([])
    clock.set(26, 9, 30)
    expect(svc.tick(0).events.map((e) => [e.kind, e.parts])).toEqual([['break', ['eye']]])
  })

  it('day rollover clears pending and snooze', () => {
    svc.tick(0)
    for (let m = 1; m <= 20; m++) {
      clock.set(26, 9, m)
      svc.tick(0)
    }
    svc.snoozeBreak()
    expect(loadState(file).reminder.breaks.snoozeUntil).not.toBeNull()
    clock.set(27, 8, 0)
    svc.view()
    expect(loadState(file).reminder.breaks).toEqual(EMPTY_BREAK_STATE)
  })

  it('check-in fires on the first tick at 09:00 and markPunched stops it', () => {
    expect(svc.tick(0).events.map((e) => e.kind)).toContain('attendance-in')
    expect(svc.view().attendance.in).toBe(true)
    expect(svc.markPunched('in').attendance.in).toBe(false)
    clock.set(26, 9, 10)
    expect(svc.tick(0).events.map((e) => e.kind)).not.toContain('attendance-in')
  })

  it('checkOut applies choices and starts check-out', () => {
    svc.addItems([newItem({ title: 'A' }), newItem({ title: 'B' }), newItem({ title: 'C' })])
    svc.markPunched('in')
    const v = svc.checkOut([
      { itemId: 'id1', choice: 'tomorrow' },
      { itemId: 'id2', choice: 'unscheduled' },
      { itemId: 'id3', choice: 'drop' }
    ])
    const s = loadState(file)
    expect(s.items.find((i) => i.id === 'id1')?.date).toBe(D1)
    expect(v.plan.blocks.some((b) => b.itemId === 'id1')).toBe(false)
    expect(v.plan.unscheduled).toContain('id2')
    expect(s.items.find((i) => i.id === 'id3')?.status).toBe('dropped')
    expect(v.checkedOut).toBe(true)
    clock.set(26, 9, 1)
    expect(svc.tick(0).events.map((e) => e.kind)).toContain('attendance-out')
  })

  it('an item unscheduled at check-out loses its time and is never nudged', () => {
    svc.markPunched('in')
    svc.addItems([newItem({ title: 'A' })]) // planned 09:00–09:30
    clock.set(26, 9, 10)
    const v = svc.checkOut([{ itemId: 'id1', choice: 'unscheduled' }])
    expect(v.plan.blocks.some((b) => b.itemId === 'id1')).toBe(false)
    expect(v.plan.unscheduled).toContain('id1')
    clock.set(26, 9, 31)
    expect(svc.tick(0).nudges).toEqual([])
    clock.set(26, 9, 50)
    const t = svc.tick(0)
    expect(t.nudges).toEqual([])
    expect(t.view.nudges).toEqual([])
  })

  it('checkOut skips items that are no longer open', () => {
    svc.addItems([newItem()])
    svc.updateItem('id1', { status: 'done' })
    expect(() => svc.checkOut([{ itemId: 'id1', choice: 'drop' }])).not.toThrow()
    expect(loadState(file).items[0].status).toBe('done')
    expect(() => svc.checkOut([{ itemId: 'gone', choice: 'drop' }])).not.toThrow()
  })

  it('rollover resets end-of-day state', () => {
    svc.markPunched('in')
    svc.checkOut([])
    clock.set(27, 8, 0)
    svc.view()
    expect(loadState(file).endOfDay).toEqual(EMPTY_END_OF_DAY_STATE)
  })

  it('caps the minutes counted between ticks at 5', () => {
    svc.tick(0)
    expect(loadState(file).reminder.breaks.eyeActiveMin).toBe(0)
    clock.set(26, 9, 30)
    svc.tick(0)
    expect(loadState(file).reminder.breaks.eyeActiveMin).toBe(5)
  })

  it('the first plan of the day reports no moves', () => {
    svc.addItems([newItem()])
    clock.set(27, 9, 0)
    const v = svc.view()
    expect(blockOf(v, 'id1')).toBeDefined()
    expect(v.plan.moves).toEqual([])
  })

  it('keeps still-valid call slots on replan and tops them up to 3', () => {
    const before = svc.addItems([newItem({ type: 'call', durationMin: 15 })]).awaitingCalls[0]
      .suggestedSlots
    clock.set(26, 9, 10)
    const after = svc.replan().awaitingCalls[0].suggestedSlots
    expect(after).toHaveLength(3)
    expect(after).toEqual([...after].sort((a, b) => a - b))
    for (const slot of before.filter((x) => x >= 550)) expect(after).toContain(slot)
    expect(after.every((x) => x >= 550)).toBe(true)
  })

  it('a done patch on a repeating item still applies the rest of the patch', () => {
    svc.addItems([newItem({ repeat: { kind: 'daily' } })])
    const v = svc.updateItem('id1', { status: 'done', title: 'Renamed' })
    expect(v.items[0]).toMatchObject({ status: 'done', title: 'Renamed' })
    expect(loadState(file).items[0].status).toBe('open')
  })

  it('logWater adds a 250 ml glass', () => {
    expect(svc.view().waterMl).toBe(0)
    expect(svc.logWater().waterMl).toBe(250)
    expect(svc.logWater().waterMl).toBe(500)
    expect(loadState(file).waterMl[D]).toBe(500)
  })

  it('locking a split deep item is a no-op', () => {
    clock.set(26, 8, 0)
    svc.addItems([
      newItem({ type: 'fixed', fixedStart: 605, durationMin: 35 }),
      newItem({ type: 'fixed', fixedStart: 745, durationMin: 335 }),
      newItem({ type: 'deep', durationMin: 120 })
    ])
    const before = svc.view().plan.blocks.filter((b) => b.itemId === 'id3')
    expect(before.length).toBe(2)
    const v = svc.setLock('id3', true)
    expect(v.items.find((i) => i.id === 'id3')?.lockedStart).toBeNull()
    expect(loadState(file).items.find((i) => i.id === 'id3')?.lockedStart).toBeNull()
  })

  it('a locked task is re-placed, not overlapped, when a fixed item lands on it', () => {
    clock.set(26, 8, 0)
    svc.addItems([newItem()])
    expect(svc.setLock('id1', true).items[0].lockedStart).toBe(540)
    const v = svc.addItems([newItem({ type: 'fixed', fixedStart: 550 })])
    const t = blockOf(v, 'id1')!
    const f = blockOf(v, 'id2')!
    expect(t.start < f.end && f.start < t.end).toBe(false)
  })

  it('defers nudge notifications while busy; the banner still shows', () => {
    svc.addItems([newItem()])
    svc.setManualBusy(true)
    clock.set(26, 9, 30)
    let t = svc.tick(0)
    expect(t.nudges).toEqual([])
    expect(t.view.nudges).toEqual(['id1'])
    expect(loadState(file).nudges['id1']).toBeUndefined()
    clock.set(26, 9, 31)
    svc.setManualBusy(null)
    t = svc.tick(0)
    expect(t.nudges).toEqual(['id1'])
    expect(loadState(file).nudges['id1']).toEqual({ count: 1, lastAt: 571 })
  })

  it('the view drops call slots that are already past', () => {
    svc.addItems([newItem({ type: 'call', durationMin: 15 })])
    expect(svc.view().awaitingCalls[0].suggestedSlots).toContain(540)
    clock.set(26, 9, 10)
    const v = svc.view()
    expect(v.awaitingCalls[0].suggestedSlots.every((x) => x >= 550)).toBe(true)
    expect(v.items[0].suggestedSlots.every((x) => x >= 550)).toBe(true)
  })

  it('confirmCall ignores a slot that is already past', () => {
    svc.addItems([newItem({ type: 'call', durationMin: 15 })])
    clock.set(26, 9, 10)
    const v = svc.confirmCall('id1', 540)
    expect(v.items[0].fixedStart).toBeNull()
    expect(loadState(file).items[0].fixedStart).toBeNull()
  })

  it('addItems moves a past-dated one-off item to today; repeating items keep their date', () => {
    const v = svc.addItems([
      newItem({ date: '2026-10-25' }),
      newItem({ date: '2026-10-25', repeat: { kind: 'daily' } })
    ])
    expect(v.items.map((i) => [i.id, i.date])).toEqual([
      ['id1', D],
      ['id2', '2026-10-25']
    ])
  })

  it('planNow forgets an unscheduled answer and plans the item', () => {
    clock.set(26, 8, 0)
    svc.addItems([newItem()])
    let v = svc.answerDecisions([{ itemId: 'id1', choice: 'unscheduled' }])
    expect(v.plan.unscheduled).toEqual(['id1'])
    expect(blockOf(v, 'id1')).toBeUndefined()
    v = svc.planNow('id1')
    expect(v.plan.unscheduled).toEqual([])
    expect(blockOf(v, 'id1')).toBeDefined()
  })

  it('reports the hotkey status the shell sets', () => {
    expect(svc.view().hotkeyOk).toBe(true)
    svc.setHotkeyOk(false)
    expect(svc.view().hotkeyOk).toBe(false)
  })
})

describe('DayfitService in-app alerts', () => {
  const firstBreak = (): void => {
    svc.markPunched('in')
    svc.tick(0)
    for (let m = 1; m <= 20; m++) {
      clock.set(26, 9, m)
      if (svc.tick(0).events.some((e) => e.kind === 'break')) return
    }
    throw new Error('no break fired')
  }

  it('a break tick records a label and a banner; markSeen clears only the label', () => {
    firstBreak()
    expect(svc.view().trayLabel).toBe('Break')
    expect(svc.view().alerts.map((a) => a.kind)).toEqual(['break'])
    const v = svc.markSeen()
    expect(v.trayLabel).toBeNull()
    expect(v.alerts).toHaveLength(1)
  })

  it('dismissAlert removes one alert; unknown id is a no-op', () => {
    firstBreak()
    const id = svc.view().alerts[0].id
    expect(() => svc.dismissAlert('nope')).not.toThrow()
    expect(svc.view().alerts).toHaveLength(1)
    expect(svc.dismissAlert(id).alerts).toEqual([])
  })

  it('snoozeBreak removes the break banner', () => {
    firstBreak()
    expect(svc.snoozeBreak().alerts).toEqual([])
  })

  it('logWater after a water break removes the banner and the Break label', () => {
    svc.updateSettings({ water: { ...svc.view().settings.water, intervalMin: 1 } })
    firstBreak()
    expect(svc.view().alerts[0].parts).toContain('water')
    const v = svc.logWater()
    expect(v.alerts).toEqual([])
    expect(v.trayLabel).toBeNull()
  })

  it('snoozeBreak and dismissing the break clear the Break label', () => {
    firstBreak()
    expect(svc.snoozeBreak().trayLabel).toBeNull()
    clock.set(26, 10, 0)
    svc.tick(0)
    for (let m = 1; m <= 25 && svc.view().alerts.length === 0; m++) {
      clock.set(26, 10, m)
      svc.tick(0)
    }
    expect(svc.view().trayLabel).toBe('Break')
    expect(svc.dismissAlert(svc.view().alerts[0].id).trayLabel).toBeNull()
  })

  it('checkOut drops the wrap-up and past-hours banners', () => {
    svc.markPunched('in')
    clock.set(26, 17, 45)
    svc.tick(0)
    expect(svc.view().alerts.map((a) => a.kind)).toContain('heads-up')
    const v = svc.checkOut([])
    expect(v.alerts.map((a) => a.kind)).not.toContain('heads-up')
    expect(v.trayLabel).not.toBe('Wrap up')
  })

  it('rollover clears alerts and label', () => {
    firstBreak()
    clock.set(27, 8, 0)
    const v = svc.view()
    expect(v.alerts).toEqual([])
    expect(v.trayLabel).toBeNull()
  })
})

describe('DayfitService coffee', () => {
  it('logCoffee counts cups for today', () => {
    expect(svc.view().coffee).toBe(0)
    svc.logCoffee()
    expect(svc.logCoffee().coffee).toBe(2)
    expect(loadState(file).coffee[D]).toBe(2)
  })
})

describe('DayfitService focus timer', () => {
  it('a session sets busy, ends once after its time, restores busy and queues a break', () => {
    svc.addItems([newItem({ title: 'Write' })])
    const v = svc.startFocus('id1', 25)
    expect(v.focus).toMatchObject({ itemId: 'id1', title: 'Write', minutesLeft: 25 })
    expect(v.manualBusy).toBe(true)
    expect(v.trayLabel).toBe('Focus 25m')
    clock.set(26, 9, 10)
    expect(svc.tick(0).events.map((e) => e.kind)).not.toContain('focus-done')
    clock.set(26, 9, 26)
    const t = svc.tick(0)
    expect(t.events.filter((e) => e.kind === 'focus-done')).toHaveLength(1)
    expect(t.view.focus).toBeNull()
    expect(t.view.manualBusy).toBeNull()
    expect(loadState(file).reminder.breaks.pending).toEqual(['eye', 'stretch'])
    clock.set(26, 9, 27)
    expect(svc.tick(0).events.map((e) => e.kind)).not.toContain('focus-done')
  })

  it('a session survives a restart and stop restores busy', () => {
    svc.addItems([newItem()])
    svc.setManualBusy(false)
    svc.startFocus('id1', 50)
    const again = new DayfitService(file, clock)
    expect(again.view().focus?.minutesLeft).toBe(50)
    const v = again.stopFocus()
    expect(v.focus).toBeNull()
    expect(v.manualBusy).toBe(false)
  })
})

describe('DayfitService evening preview', () => {
  it("previews tomorrow's plan without saving anything", () => {
    svc.addItems([
      newItem({ title: 'Standup', type: 'fixed', fixedStart: 570, repeat: { kind: 'daily' } }),
      newItem({ title: 'Taxes', date: D1 })
    ])
    clock.set(26, 17, 30)
    const before = JSON.stringify(loadState(file))
    const p = svc.previewTomorrow()
    expect(p.date).toBe(D1)
    expect(p.items.map((i) => i.title).sort()).toEqual(['Standup', 'Taxes'])
    expect(p.blocks.find((b) => b.kind === 'fixed')?.start).toBe(570)
    expect(p.blocks.some((b) => b.itemId === 'id2')).toBe(true)
    expect(JSON.stringify(loadState(file))).toBe(before)
  })
})

describe('DayfitService lock at a start', () => {
  it('setLock with a start moves the task there', () => {
    clock.set(26, 8, 0) // before work, so the 09:00 block hasn't started
    svc.addItems([newItem({ title: 'A' })])
    const v = svc.setLock('id1', true, 700)
    expect(v.plan.blocks.find((b) => b.itemId === 'id1')).toMatchObject({ start: 700, end: 730 })
    expect(loadState(file).items[0].lockedStart).toBe(700)
  })

  it('an invalid start is refused with a message', () => {
    svc.addItems([
      newItem({ title: 'A' }),
      newItem({ title: 'Call', type: 'fixed', fixedStart: 700 })
    ])
    expect(() => svc.setLock('id1', true, 690)).toThrow('Clashes with Call')
    expect(loadState(file).items[0].lockedStart).toBeNull()
  })
})

describe('DayfitService repeating tasks', () => {
  it('a daily task is planned each day and done counts for one day only', () => {
    svc.addItems([newItem({ title: 'Water plants', repeat: { kind: 'daily' } })])
    expect(svc.view().plan.blocks.some((b) => b.itemId === 'id1')).toBe(true)
    const v = svc.updateItem('id1', { status: 'done' })
    expect(v.items.find((i) => i.id === 'id1')?.status).toBe('done')
    expect(loadState(file).items[0].doneDates).toEqual([D])
    clock.set(27, 9, 0)
    const next = svc.view()
    expect(next.items.find((i) => i.id === 'id1')?.status).toBe('open')
    expect(next.plan.blocks.some((b) => b.itemId === 'id1')).toBe(true)
    expect(loadState(file).items).toHaveLength(1)
  })
})

describe('DayfitService polish', () => {
  it("a task's own nudge fires in the gap before the next DND task", () => {
    svc.addItems([
      newItem({ title: 'A', dnd: true }),
      newItem({ title: 'B', durationMin: 60, dnd: true })
    ])
    clock.set(26, 9, 31)
    expect(svc.tick(0).nudges).toEqual(['id1'])
  })

  it('a repeat nudge waits while a DND task runs, then fires', () => {
    svc.addItems([newItem({ title: 'A' }), newItem({ title: 'B', durationMin: 60, dnd: true })])
    const b = svc.view().plan.blocks.find((x) => x.itemId === 'id2')!
    clock.set(26, 9, 31)
    expect(svc.tick(0).nudges).toEqual(['id1'])
    clock.set(26, 9, 47)
    expect(svc.tick(0).nudges).toEqual([])
    clock.set(26, Math.floor((b.end + 1) / 60), (b.end + 1) % 60)
    expect(svc.tick(0).nudges).toContain('id1')
  })

  it('snoozing an older notification keeps the newer break', () => {
    svc.updateSettings({ water: { ...svc.view().settings.water, intervalMin: 1 } })
    svc.markPunched('in')
    svc.tick(0)
    let alertParts: string[] = []
    for (let m = 1; m <= 20 && alertParts.length === 0; m++) {
      clock.set(26, 9, m)
      svc.tick(0)
      alertParts = svc.view().alerts.flatMap((a) => a.parts)
    }
    expect(alertParts).toContain('water')
    const v = svc.snoozeBreak(['eye'])
    expect(v.alerts.flatMap((a) => a.parts)).toContain('water')
  })

  it('+15 min stops before a planned lunch', () => {
    svc.updateSettings({ lunch: 780 })
    clock.set(26, 12, 30)
    svc.addItems([newItem({ title: 'T', durationMin: 25 })])
    clock.set(26, 12, 56)
    svc.tick(0)
    const v = svc.answerNudge('id1', 'extend')
    const lunch = v.plan.blocks.filter((x) => x.kind === 'lunch')
    expect(lunch.map((x) => x.start)).toEqual([780])
    expect(v.plan.lunchClash).toBeNull()
  })

  it('checkOut Tomorrow clears suggested call slots', () => {
    svc.addItems([newItem({ title: 'Call John', type: 'call', durationMin: 15 })])
    expect(loadState(file).items[0].suggestedSlots.length).toBeGreaterThan(0)
    svc.checkOut([{ itemId: 'id1', choice: 'tomorrow' }])
    expect(loadState(file).items[0].suggestedSlots).toEqual([])
  })

  it('review answers survive a restart', () => {
    svc.addItems([newItem()])
    svc.answerDecisions([{ itemId: 'id1', choice: 'unscheduled' }])
    const again = new DayfitService(file, clock)
    expect(again.replan().plan.unscheduled).toContain('id1')
  })
})

describe('DayfitService lunch clash', () => {
  const lunchStarts = (v: ViewState): number[] =>
    v.plan.blocks.filter((b) => b.kind === 'lunch').map((b) => b.start)
  const meeting = (start: number, durationMin: number): NewItem =>
    newItem({ title: 'Client call', type: 'fixed', fixedStart: start, durationMin })
  beforeEach(() => {
    svc.updateSettings({ lunch: 780 })
    svc.addItems([meeting(800, 60)])
  })

  it('a clash shows in the view and an answer resolves it', () => {
    expect(svc.view().plan.lunchClash?.move).toBe(865)
    const v = svc.answerDecisions([], { kind: 'at', start: 865, len: 45 })
    expect(lunchStarts(v)).toEqual([865])
    expect(v.plan.lunchClash).toBeNull()
    expect(loadState(file).lunchAnswer).toEqual({
      date: D,
      answer: { kind: 'at', start: 865, len: 45 }
    })
  })

  it('skip today', () => {
    const v = svc.answerDecisions([], { kind: 'skip' })
    expect(lunchStarts(v)).toEqual([])
    expect(v.plan.lunchClash).toBeNull()
  })

  it('an invalid pick throws and changes nothing', () => {
    expect(() => svc.answerDecisions([], { kind: 'at', start: 830, len: 45 })).toThrow(
      'Clashes with Client call'
    )
    expect(svc.view().plan.lunchClash?.reason).toBe('clash')
    expect(loadState(file).lunchAnswer).toBeNull()
  })

  it('a new fixed item on the answered lunch clears the answer and asks again', () => {
    svc.answerDecisions([], { kind: 'at', start: 865, len: 45 })
    const v = svc.addItems([meeting(870, 30)])
    expect(loadState(file).lunchAnswer).toBeNull()
    expect(v.plan.lunchClash?.reason).toBe('clash')
  })

  it('a move answer is resolved against the current time, not a stale view', () => {
    // first plan at 15:00 → "passed", move 900; the user answers at 15:05
    clock.set(26, 15, 0)
    expect(svc.replan().plan.lunchClash).toMatchObject({ reason: 'passed', move: 900 })
    clock.set(26, 15, 5)
    const v = svc.answerDecisions([], { kind: 'move' })
    expect(lunchStarts(v)).toEqual([905])
    expect(v.plan.lunchClash).toBeNull()
  })

  it('a shorten answer that is no longer offered is refused', () => {
    clock.set(26, 13, 5)
    expect(() => svc.answerDecisions([], { kind: 'shorten' })).toThrow(
      'That option is no longer available'
    )
  })

  it('no lunch question after working hours', () => {
    clock.set(26, 18, 30)
    expect(svc.replan().plan.lunchClash).toBeNull()
  })

  it("changing the lunch time or length in Settings clears today's answer", () => {
    svc.answerDecisions([], { kind: 'at', start: 865, len: 45 })
    svc.updateSettings({ lunch: 720 })
    expect(loadState(file).lunchAnswer).toBeNull()
    expect(lunchStarts(svc.view())).toEqual([720])
    svc.answerDecisions([], { kind: 'skip' })
    const s = svc.view().settings
    svc.updateSettings({ endOfDay: { ...s.endOfDay, lunchMin: 30 } })
    expect(loadState(file).lunchAnswer).toBeNull()
  })

  it('answer survives a restart and clears at rollover', () => {
    svc.answerDecisions([], { kind: 'at', start: 865, len: 45 })
    const again = new DayfitService(file, clock)
    expect(lunchStarts(again.replan())).toEqual([865])
    clock.set(27, 9, 0)
    again.view()
    expect(loadState(file).lunchAnswer).toBeNull()
  })
})

describe('DayfitService view: tomorrow and week', () => {
  it('tomorrow includes repeating fixed items and dated tasks; upcoming excludes repeating', () => {
    const v = svc.addItems([
      newItem({
        title: 'Run',
        type: 'fixed',
        fixedStart: 1110,
        durationMin: 45,
        repeat: { kind: 'daily' }
      }),
      newItem({ title: 'Later task', date: D1 })
    ])
    expect(v.tomorrow.map((i) => i.title)).toEqual(['Run', 'Later task'])
    expect(v.upcoming.map((i) => i.title)).toEqual(['Later task'])
  })
  it('week has 7 entries starting Monday with today counting today’s items', () => {
    const v = svc.addItems([newItem({ title: 'A' }), newItem({ title: 'B' })])
    expect(v.week).toHaveLength(7)
    expect(v.week[0].date).toBe(D)
    expect(v.week[0].count).toBe(v.items.length)
    expect(v.week[1]).toEqual({ date: D1, count: 0 })
  })
})

describe('DayfitService daily summary', () => {
  const daysIn = (): { date: string; summary: unknown }[] => {
    const db = openDb(file)
    try {
      return db.days('2026-01-01', '2026-12-31')
    } finally {
      db.close()
    }
  }
  const fireBreak = (): void => {
    svc.markPunched('in')
    svc.tick(0)
    for (let m = 1; m <= 20; m++) {
      clock.set(26, 9, m)
      if (svc.tick(0).events.some((e) => e.kind === 'break')) return
    }
    throw new Error('no break fired')
  }

  it('checkOut writes today and the view shows it', () => {
    svc.addItems([newItem({ title: 'A' }), newItem({ title: 'B' }), newItem({ title: 'C' })])
    svc.updateItem('id1', { status: 'done' })
    svc.logWater()
    svc.logCoffee()
    const v = svc.checkOut([
      { itemId: 'id2', choice: 'tomorrow' },
      { itemId: 'id3', choice: 'drop' }
    ])
    const want = {
      date: D,
      done: 1,
      moved: 1,
      dropped: 1,
      waterMl: 250,
      waterTargetMl: 2000,
      coffeeCups: 1
    }
    expect(v.daySummary).toMatchObject(want)
    expect(daysIn()).toEqual([{ date: D, summary: expect.objectContaining(want) }])
  })

  it('no summary in the view before check-out', () => {
    expect(svc.view().daySummary).toBeNull()
  })

  it('a fired break counts as taken; a snoozed one does not', () => {
    fireBreak()
    expect(svc.checkOut([]).daySummary?.breaksTaken).toBe(1)
    svc.snoozeBreak()
    expect(svc.view().daySummary?.breaksTaken).toBe(0)
  })

  it('a focus session on deep work is not counted twice', () => {
    svc.addItems([newItem({ title: 'Deep', type: 'deep', durationMin: 60 })])
    svc.startFocus('id1', 25)
    clock.set(26, 9, 26)
    svc.tick(0)
    svc.updateItem('id1', { status: 'done' })
    // Done at 09:26: the deep block counts 09:00–09:26; the session adds nothing on top.
    expect(svc.checkOut([]).daySummary?.focusMin).toBe(26)
  })

  it('a finished focus session adds its minutes', () => {
    svc.addItems([newItem()])
    svc.startFocus('id1', 25)
    clock.set(26, 9, 26)
    svc.tick(0)
    expect(svc.checkOut([]).daySummary?.focusMin).toBe(25)
  })

  it('rollover writes the previous day when check-out was skipped, once', () => {
    svc.addItems([newItem()])
    svc.updateItem('id1', { status: 'done' })
    clock.set(27, 9, 0)
    svc.view()
    expect(daysIn()).toEqual([{ date: D, summary: expect.objectContaining({ done: 1 }) }])
    // A later rollover adds the next day and leaves this one as written.
    clock.set(28, 9, 0)
    svc.view()
    const rows = daysIn()
    expect(rows.map((d) => d.date)).toEqual([D, D1])
    expect(rows[0].summary).toMatchObject({ done: 1 })
  })

  it('rollover keeps the check-out summary, including what was logged after it', () => {
    svc.logWater()
    svc.checkOut([])
    svc.logWater()
    clock.set(27, 9, 0)
    svc.view()
    expect(daysIn()).toEqual([{ date: D, summary: expect.objectContaining({ waterMl: 500 }) }])
  })
})

describe('DayfitService week', () => {
  it('returns the last 7 days oldest first, null where there is no summary', () => {
    svc.checkOut([]) // 26th
    clock.set(28, 9, 0)
    svc.view() // the 27th never ran, so it has no summary
    const w = svc.week().days
    expect(w.map((d) => d.date)).toEqual([
      '2026-10-22',
      '2026-10-23',
      '2026-10-24',
      '2026-10-25',
      '2026-10-26',
      '2026-10-27',
      '2026-10-28'
    ])
    expect(w[4].summary).toMatchObject({ date: D })
    expect(w.filter((d) => d.summary !== null)).toHaveLength(1)
  })
})

describe('DayfitService backup', () => {
  it('export carries the state and every saved day', () => {
    svc.addItems([newItem({ title: 'Keep me' })])
    svc.checkOut([])
    const b = svc.exportData()
    expect(b.app).toBe('dayfit')
    expect(b.state.items.map((i) => i.title)).toEqual(['Keep me'])
    expect(b.days.map((d) => d.date)).toEqual([D])
  })

  it('a backup the planner cannot use changes nothing', () => {
    svc.addItems([newItem({ title: 'Keep me' })])
    svc.checkOut([])
    const b = svc.exportData()
    b.state.items = [{ title: 'broken' } as unknown as (typeof b.state.items)[number]]
    b.days = []
    expect(() => svc.importData(b)).toThrow('The backup could not be loaded')
    expect(svc.view().items.map((i) => i.title)).toEqual(['Keep me'])
    expect(loadState(file).items.map((i) => i.title)).toEqual(['Keep me'])
    expect(svc.week().days[6].summary).toMatchObject({ date: D })
  })

  it('import replaces the state and days, then replans', () => {
    svc.addItems([newItem({ title: 'Old' })])
    svc.checkOut([])
    const other = new DayfitService(path.join(dir, 'other.db'), clock, () => 'n1')
    other.addItems([newItem({ title: 'New' })])
    const b = other.exportData()
    b.days = [{ date: '2026-10-01', summary: { date: '2026-10-01' } }]
    const v = svc.importData(b)
    expect(v.items.map((i) => i.title)).toEqual(['New'])
    expect(v.plan.blocks.some((x) => x.itemId === 'n1')).toBe(true)
    expect(v.checkedOut).toBe(false)
    expect(loadState(file).items.map((i) => i.title)).toEqual(['New'])
    expect(svc.week().days.every((d) => d.summary === null)).toBe(true)
  })
})

describe('DayfitService review minors', () => {
  const daysIn = (): { date: string; summary: unknown }[] => {
    const db = openDb(file)
    try {
      return db.days('2026-01-01', '2026-12-31')
    } finally {
      db.close()
    }
  }

  it('after check-out, later logging keeps the saved summary current', () => {
    svc.checkOut([])
    svc.logWater()
    svc.logCoffee()
    expect(daysIn()).toEqual([
      { date: D, summary: expect.objectContaining({ waterMl: 250, coffeeCups: 1 }) }
    ])
  })

  it('a Busy choice made during focus stays after focus ends', () => {
    svc.addItems([newItem()])
    svc.startFocus('id1', 25)
    svc.setManualBusy(false)
    clock.set(26, 9, 26)
    expect(svc.tick(0).view.manualBusy).toBe(false)
  })

  it('a focus session still running at midnight ends quietly with no credit', () => {
    svc.addItems([newItem()])
    clock.set(26, 23, 50)
    svc.startFocus('id1', 25)
    clock.set(27, 0, 20)
    const t = svc.tick(0)
    expect(t.events.map((e) => e.kind)).not.toContain('focus-done')
    expect(t.view.focus).toBeNull()
    expect(t.view.manualBusy).toBeNull()
    expect(svc.checkOut([]).daySummary?.focusMin).toBe(0)
  })

  it('a focus session long past its end ends quietly (no late "Focus done")', () => {
    svc.addItems([newItem()])
    svc.startFocus('id1', 25)
    clock.set(26, 11, 0)
    const t = svc.tick(0)
    expect(t.events.map((e) => e.kind)).not.toContain('focus-done')
    expect(t.view.focus).toBeNull()
  })

  it('rollover keeps only recent doneDates on repeating items', () => {
    svc.addItems([newItem({ repeat: { kind: 'daily' } })])
    const s = loadState(file)
    s.items[0].doneDates = ['2026-09-01', '2026-10-10', '2026-10-20', D]
    const db = openDb(file)
    db.writeState(s)
    db.close()
    const again = new DayfitService(file, clock)
    clock.set(27, 9, 0)
    again.view()
    expect(loadState(file).items[0].doneDates).toEqual(['2026-10-20', D])
  })

  it('snoozing a notification for a break not fired today keeps the count', () => {
    svc.markPunched('in')
    svc.tick(0)
    let parts: string[] = []
    for (let m = 1; m <= 20 && parts.length === 0; m++) {
      clock.set(26, 9, m)
      parts = svc.tick(0).events.find((e) => e.kind === 'break')?.parts ?? []
    }
    expect(parts.length).toBeGreaterThan(0)
    // An old notification for parts this break didn't include.
    svc.snoozeBreak(['walk'])
    expect(svc.checkOut([]).daySummary?.breaksTaken).toBe(1)
  })

  it('call slots avoid where a clashing lunch would move to', () => {
    clock.set(26, 13, 30)
    svc.updateSettings({ lunch: 780 }) // lunch time already passed: Move is offered from now
    const v = svc.addItems([newItem({ title: 'Call Sam', type: 'call', durationMin: 15 })])
    const move = v.plan.lunchClash?.move ?? null
    expect(move).not.toBeNull()
    const lunchEnd = move! + 45
    const call = v.items.find((i) => i.title === 'Call Sam')!
    expect(call.suggestedSlots.length).toBeGreaterThan(0)
    for (const s of call.suggestedSlots) expect(s + 15 <= move! || s >= lunchEnd).toBe(true)
  })
})

describe('DayfitService mood', () => {
  it('logMood stores the answer and clears the check-in banner', () => {
    svc.markPunched('in')
    clock.set(26, 10, 30)
    expect(svc.tick(0).view.alerts.map((a) => a.kind)).toContain('checkin')
    const v = svc.logMood(4)
    expect(v.alerts.map((a) => a.kind)).not.toContain('checkin')
    expect(loadState(file).moods[D]).toEqual([{ at: 630, score: 4 }])
    expect(svc.checkOut([]).daySummary?.moodAvg).toBe(4)
  })

  it('ignores a score outside 1–5', () => {
    svc.logMood(9)
    svc.logMood(Number.NaN)
    expect(loadState(file).moods[D] ?? []).toEqual([])
  })
})

describe('DayfitService week trends', () => {
  it('week() carries risk, streaks and the energy low point', () => {
    svc.checkOut([])
    const w = svc.week()
    expect(w.days).toHaveLength(7)
    expect(w.risk.level).toBe('Low')
    expect(w.streaks).toEqual({ water: 0, breaks: 0, onTime: 1 })
    expect(w.energyLow).toBeNull()
  })

  it('the summary records overtime', () => {
    svc.markPunched('in')
    clock.set(26, 18, 20)
    svc.tick(0) // punch-out first; overtime waits a tick
    clock.set(26, 18, 21)
    expect(svc.tick(0).events.map((e) => e.kind)).toContain('overtime')
    expect(svc.checkOut([]).daySummary?.overtime).toBe(true)
  })
})

describe('DayfitService custom reminders', () => {
  const pill = {
    id: 'r1',
    title: 'Take vitamin D',
    kind: 'at' as const,
    times: [545],
    everyMin: 0,
    enabled: true
  }
  const withPill = (): void => {
    const f = svc.view().settings.features
    svc.updateSettings({ features: { ...f, reminders: [pill] } })
  }

  it('fires as a banner that snooze brings back later', () => {
    withPill()
    clock.set(26, 9, 5)
    const t = svc.tick(0)
    const alert = t.view.alerts.find((a) => a.kind === 'custom')!
    expect(alert).toMatchObject({ title: 'Take vitamin D', reminderId: 'r1' })
    const v = svc.snoozeCustom(alert.id)
    expect(v.alerts.some((a) => a.kind === 'custom')).toBe(false)
    clock.set(26, 9, 14)
    expect(svc.tick(0).events.map((e) => e.kind)).not.toContain('custom')
    clock.set(26, 9, 15)
    expect(svc.tick(0).events.map((e) => e.kind)).toContain('custom')
  })

  it('deleting a reminder drops its state', () => {
    withPill()
    clock.set(26, 9, 5)
    svc.tick(0)
    const f = svc.view().settings.features
    svc.updateSettings({ features: { ...f, reminders: [] } })
    expect(loadState(file).wellbeing.customFired).toEqual({})
  })
})
