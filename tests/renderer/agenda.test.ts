import { describe, expect, it } from 'vitest'
import { agendaRows, looseCounts, nextUp } from '../../src/renderer/src/lib/agenda'
import { block, item, makeView } from './fixtures'

describe('agendaRows', () => {
  it('lists every block in time order with a kind detail', () => {
    const base = makeView()
    const v = makeView({
      items: [...base.items, item('t', 'Review', { durationMin: 20, label: 'review' })],
      plan: { ...base.plan, blocks: [...base.plan.blocks, block('t', 'task', 755, 775)] }
    })
    expect(agendaRows(v).map((r) => [r.start, r.kind, r.title, r.detail])).toEqual([
      [540, 'fixed', 'Standup', '15m · fixed'],
      [560, 'deep', 'Payments refactor', '1h · deep work · 1/2'],
      [625, 'deep', 'Payments refactor', '1h · deep work · 2/2'],
      [690, 'walk', 'Walk', '10m'],
      [755, 'task', 'Review', '20m · #review']
    ])
  })
})

describe('nextUp', () => {
  it('names the next walk or fixed item after now', () => {
    const base = makeView()
    const v = makeView({
      now: 600,
      plan: {
        ...base.plan,
        blocks: [block(null, 'walk', 660, 670), block('standup', 'fixed', 700, 715)]
      }
    })
    expect(nextUp(v)).toBe('Next: walk 11:00')
    expect(nextUp({ ...v, now: 665 })).toBe('Next: Standup 11:40')
    expect(nextUp({ ...v, now: 720 })).toBeNull()
  })
})

describe('looseCounts', () => {
  it('counts unscheduled items and calls awaiting a time', () => {
    const call = item('c', 'Call', { type: 'call', suggestedSlots: [800] })
    const base = makeView()
    const v = makeView({
      awaitingCalls: [call],
      plan: { ...base.plan, unscheduled: ['a', 'b'] }
    })
    expect(looseCounts(v)).toEqual({ unscheduled: 2, awaiting: 1 })
  })
})
