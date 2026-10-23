import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import type { Block, NewItem } from '../../src/core/types'
import { DayfitService, type Clock, type ViewState } from '../../src/main/service'
import { loadState } from '../../src/main/store'

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

  it('a done item keeps only the part of its block before now', () => {
    svc.addItems([newItem({ durationMin: 60 })])
    clock.set(26, 9, 20)
    const v = svc.updateItem('id1', { status: 'done' })
    expect(blockOf(v, 'id1')).toMatchObject({ start: 540, end: 560 })
  })

  it('ignores marking a repeating item done', () => {
    svc.addItems([newItem({ repeat: { kind: 'daily' } })])
    const v = svc.updateItem('id1', { status: 'done' })
    expect(v.items[0].status).toBe('open')
    expect(loadState(file).items[0].status).toBe('open')
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

  it('an unscheduled answer lives in memory for the day only', () => {
    svc.addItems([newItem({ durationMin: 600 })])
    let v = svc.answerDecisions([{ itemId: 'id1', choice: 'unscheduled' }])
    expect(v.plan.unscheduled).toEqual(['id1'])
    expect(v.plan.decisions).toEqual([])
    v = new DayfitService(file, clock).replan()
    expect(v.plan.unscheduled).toEqual([])
    expect(v.plan.decisions).toEqual([{ kind: 'no-fit', itemId: 'id1' }])
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

  it('caps the minutes counted between ticks at 5', () => {
    svc.tick(0)
    expect(loadState(file).reminder.activeMin).toBe(0)
    clock.set(26, 9, 30)
    svc.tick(0)
    expect(loadState(file).reminder.activeMin).toBe(5)
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
    expect(v.items[0]).toMatchObject({ status: 'open', title: 'Renamed' })
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
