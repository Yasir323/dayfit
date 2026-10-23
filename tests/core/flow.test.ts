import { describe, expect, it } from 'vitest'
import { suggestCallSlots } from '../../src/core/callSlots'
import { diffMoves, frozenBlocks } from '../../src/core/replan'
import { applyNudgeAnswer, dueNudges } from '../../src/core/nudge'
import { DEFAULT_SETTINGS as S, type Block, type Item } from '../../src/core/types'

const blk = (
  itemId: string | null,
  start: number,
  end: number,
  kind: Block['kind'] = 'task'
): Block => ({
  itemId,
  kind,
  start,
  end,
  chunk: null,
  reason: ''
})
const item = (id: string, status: Item['status'] = 'open'): Item => ({
  id,
  title: id,
  type: 'task',
  durationMin: 30,
  label: null,
  priority: 'med',
  half: null,
  date: '2026-10-23',
  fixedStart: null,
  deadline: null,
  repeat: { kind: 'none' },
  status,
  lockedStart: null,
  suggestedSlots: [],
  dnd: false,
  createdAt: 0
})

describe('suggestCallSlots', () => {
  it('spreads earliest fits at least 60 min apart around a standup', () => {
    const blocks = [blk('s', 540, 555, 'fixed')]
    expect(suggestCallSlots(blocks, 15, 0, S)).toEqual([560, 620, 680])
  })
  it('starts no earlier than now and stays inside work hours', () => {
    expect(suggestCallSlots([], 15, 1060, S)).toEqual([1060])
    expect(suggestCallSlots([], 15, 1070, S)).toEqual([])
  })
  it('treats walks as busy', () => {
    expect(suggestCallSlots([blk(null, 540, 550, 'walk')], 15, 0, S, 1)).toEqual([555])
  })
})

describe('diffMoves', () => {
  it('reports moved and dropped items, ignoring walks', () => {
    const before = [blk('a', 600, 630), blk('b', 700, 730), blk(null, 800, 810, 'walk')]
    const after = [blk('a', 660, 690), blk(null, 900, 910, 'walk')]
    expect(diffMoves(before, after)).toEqual([
      { itemId: 'a', from: 600, to: 660 },
      { itemId: 'b', from: 700, to: null }
    ])
  })
  it('uses earliest chunk and reports newly placed items', () => {
    const before = [blk('d', 700, 760), blk('d', 600, 660)]
    const after = [blk('d', 600, 660), blk('n', 900, 930)]
    expect(diffMoves(before, after)).toEqual([{ itemId: 'n', from: null, to: 900 }])
  })
})

describe('dueNudges', () => {
  const items = [item('x')]
  it('nudges when block ended', () => {
    expect(dueNudges([blk('x', 570, 600)], items, 600, {})).toEqual(['x'])
    expect(dueNudges([blk('x', 570, 600)], items, 599, {})).toEqual([])
  })
  it('respects spacing and count', () => {
    const b = [blk('x', 570, 600)]
    expect(dueNudges(b, items, 610, { x: { count: 1, lastAt: 600 } })).toEqual([])
    expect(dueNudges(b, items, 615, { x: { count: 1, lastAt: 600 } })).toEqual(['x'])
    expect(dueNudges(b, items, 700, { x: { count: 2, lastAt: 600 } })).toEqual([])
  })
  it('waits for the last chunk of a split item', () => {
    const b = [blk('x', 540, 600), blk('x', 740, 800)]
    expect(dueNudges(b, items, 610, {})).toEqual([])
    expect(dueNudges(b, items, 800, {})).toEqual(['x'])
  })
  it('skips done items, fixed and walk blocks', () => {
    expect(dueNudges([blk('x', 570, 600)], [item('x', 'done')], 700, {})).toEqual([])
    expect(dueNudges([blk('x', 570, 600, 'fixed')], items, 700, {})).toEqual([])
    expect(dueNudges([blk('x', 570, 600, 'walk')], items, 700, {})).toEqual([])
  })
})

describe('applyNudgeAnswer', () => {
  const b = blk('x', 570, 600)
  it('done', () => {
    const r = applyNudgeAnswer(item('x'), b, 'done', 600)
    expect(r.item.status).toBe('done')
    expect(r.frozen).toBe(b)
  })
  it('extend', () => {
    expect(applyNudgeAnswer(item('x'), b, 'extend', 600).frozen?.end).toBe(615)
    expect(applyNudgeAnswer(item('x'), b, 'extend', 620).frozen?.end).toBe(635)
  })
  it('move', () => {
    const r = applyNudgeAnswer(item('x'), b, 'move', 600)
    expect(r.frozen).toBeNull()
    expect(r.item.status).toBe('open')
  })
})

describe('frozenBlocks', () => {
  it('keeps in-progress, done and overdue; drops future open', () => {
    const blocks = [blk('p', 500, 560), blk('d', 700, 730), blk('o', 800, 830), blk('f', 900, 930)]
    const items = [item('p'), item('d', 'done'), item('o'), item('f')]
    const out = frozenBlocks(blocks, items, 550, new Set(['o'])).map((b) => b.itemId)
    expect(out).toEqual(['p', 'd', 'o'])
    expect(frozenBlocks([blk(null, 900, 910, 'walk')], items, 550, new Set())).toEqual([])
  })
})
