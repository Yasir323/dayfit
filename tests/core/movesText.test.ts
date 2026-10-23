import { describe, expect, it } from 'vitest'
import { movesText } from '../../src/core/movesText'
import type { Item } from '../../src/core/types'

const items = [
  { id: 'a', title: 'Review PR' },
  { id: 'b', title: 'Taxes' }
] as Item[]

describe('movesText: lunch', () => {
  it('names lunch; a newly placed lunch is not a move', () => {
    expect(movesText([{ itemId: 'lunch', from: 780, to: 865 }], items)).toBe(
      'Moved: Lunch 13:00 → 14:25'
    )
    expect(movesText([{ itemId: 'lunch', from: null, to: 780 }], items)).toBeNull()
    expect(movesText([{ itemId: 'lunch', from: 780, to: null }], items)).toBe(
      'Moved: Lunch 13:00 → unplanned'
    )
  })
})

describe('movesText', () => {
  it('lists moved items with old and new times', () => {
    expect(
      movesText(
        [
          { itemId: 'a', from: 685, to: 755 },
          { itemId: 'b', from: 600, to: null }
        ],
        items
      )
    ).toBe('Moved: Review PR 11:25 → 12:35, Taxes 10:00 → unplanned')
  })

  it('ignores newly placed items and returns null when nothing moved', () => {
    expect(movesText([{ itemId: 'a', from: null, to: 600 }], items)).toBeNull()
    expect(movesText([], items)).toBeNull()
  })
})
