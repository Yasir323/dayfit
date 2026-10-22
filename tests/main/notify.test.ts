import { describe, expect, it, vi } from 'vitest'

vi.mock('electron', () => ({
  Notification: class {
    static isSupported = (): boolean => true
  }
}))

import { buildNotificationOptions } from '../../src/main/notify'
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
