import { describe, expect, it } from 'vitest'
import { checkoutRows } from '../../src/renderer/src/lib/checkout'
import { item, makeView } from './fixtures'

describe('checkoutRows', () => {
  it('keeps open one-off items without a start time, oldest first', () => {
    const v = makeView({
      items: [
        item('b', 'Open task', { createdAt: 2 }),
        item('a', 'Call', { type: 'call', suggestedSlots: [800], createdAt: 1 }),
        item('d', 'Done', { status: 'done' }),
        item('x', 'Dropped', { status: 'dropped' }),
        item('r', 'Daily', { repeat: { kind: 'daily' } }),
        item('f', 'Meeting', { type: 'fixed', fixedStart: 600 })
      ]
    })
    expect(checkoutRows(v).map((i) => i.id)).toEqual(['a', 'b'])
  })
})
