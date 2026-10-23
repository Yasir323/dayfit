import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  Notification: class {
    static isSupported = (): boolean => true
  }
}))

import { buildNotificationOptions, planUpdatedNotice } from '../../src/main/notify'
import type { ViewState } from '../../src/main/service'
import type { ReminderEvent } from '../../src/core/reminders'

const water: ReminderEvent = {
  kind: 'water',
  itemId: null,
  title: 'Water',
  body: 'Drink a glass',
  silent: false
}

describe('buildNotificationOptions', () => {
  it('adds a Drank action for water on darwin', () => {
    const o = buildNotificationOptions({ type: 'event', event: water }, 'darwin')
    expect(o.actions).toEqual([{ type: 'button', text: 'Drank' }])
  })

  it('has no actions on win32', () => {
    expect(
      buildNotificationOptions({ type: 'event', event: water }, 'win32').actions
    ).toBeUndefined()
  })

  it('passes silent through', () => {
    const o = buildNotificationOptions(
      { type: 'event', event: { ...water, silent: true } },
      'darwin'
    )
    expect(o.silent).toBe(true)
  })

  it('titles a nudge "<title> — time\'s up" with three darwin actions', () => {
    const o = buildNotificationOptions(
      { type: 'nudge', itemId: 'a', title: 'Write report' },
      'darwin'
    )
    expect(o.title).toBe("Write report — time's up")
    expect(o.title.endsWith("— time's up")).toBe(true)
    expect(o.body).toBe('Done, need 15 more min, or move it?')
    expect(o.actions?.map((a) => a.text)).toEqual(['Done', '+15 min', 'Move it'])
  })
})

describe('planUpdatedNotice', () => {
  const view = (moves: { itemId: string; from: number | null; to: number | null }[]): ViewState =>
    ({
      plan: { blocks: [], decisions: [], unscheduled: [], moves },
      items: [{ id: 'a', title: 'Write report' }],
      upcoming: []
    }) as unknown as ViewState

  it('is a "Plan updated" notice listing the moves', () => {
    const n = planUpdatedNotice(view([{ itemId: 'a', from: 600, to: 660 }]))
    expect(n).toEqual({
      type: 'info',
      title: 'Plan updated',
      body: 'Moved: Write report 10:00 → 11:00'
    })
    const o = buildNotificationOptions(n!, 'darwin')
    expect(o).toMatchObject({ title: 'Plan updated', body: 'Moved: Write report 10:00 → 11:00' })
    expect(o.actions).toBeUndefined()
  })

  it('is null when nothing moved', () => {
    expect(planUpdatedNotice(view([{ itemId: 'a', from: null, to: 660 }]))).toBeNull()
  })
})
