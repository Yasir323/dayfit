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

  it('logWater adds a 250 ml glass', () => {
    expect(svc.view().waterMl).toBe(0)
    expect(svc.logWater().waterMl).toBe(250)
    expect(svc.logWater().waterMl).toBe(500)
    expect(loadState(file).waterMl[D]).toBe(500)
  })
})
