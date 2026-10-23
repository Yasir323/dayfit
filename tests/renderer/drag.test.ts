import { describe, expect, it } from 'vitest'
import { PX_PER_MIN, dragMinutes, snapMinutes } from '../../src/renderer/src/lib/drag'

describe('drag helpers', () => {
  it('snaps to 5 minutes', () => {
    expect(snapMinutes(37)).toBe(35)
    expect(snapMinutes(38)).toBe(40)
    expect(snapMinutes(-7)).toBe(-5)
  })

  it('turns a pixel drag into snapped minutes', () => {
    expect(dragMinutes(30 * PX_PER_MIN)).toBe(30)
    expect(dragMinutes(31)).toBe(20)
  })
})
