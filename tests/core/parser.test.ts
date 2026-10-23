import { describe, expect, test } from 'vitest'
import { parseLine, toNewItem } from '../../src/core/parser'
import { DEFAULT_SETTINGS } from '../../src/core/types'

const D = '2026-10-23' // a Friday

describe('parseLine', () => {
  test('full example', () => {
    const p = parseLine('Call John 15m #work !high @am today ~call', D)
    expect(p.title).toBe('Call John')
    expect(p.fields).toMatchObject({
      durationMin: 15,
      label: 'work',
      priority: 'high',
      half: 'am',
      date: '2026-10-23',
      type: 'call'
    })
    expect(p.tokens.map((t) => t.kind)).toEqual([
      'duration',
      'label',
      'priority',
      'half',
      'day',
      'type'
    ])
  })
  test('token spans index into the original text', () => {
    const text = 'Call John 15m #work at 3pm'
    const p = parseLine(text, D)
    expect(p.tokens.map((t) => text.slice(t.start, t.end))).toEqual(['15m', '#work', 'at 3pm'])
  })
  test('at makes fixed; household stays household', () => {
    expect(parseLine('Standup at 9:30 15m', D).fields).toMatchObject({
      fixedStart: 570,
      type: 'fixed'
    })
    expect(parseLine('School pickup ~home at 3pm', D).fields).toMatchObject({
      fixedStart: 900,
      type: 'household'
    })
  })
  test('deadlines', () => {
    expect(parseLine('Pay bill by 18:00', D).fields.deadline).toEqual({ date: D, time: 1080 })
    expect(parseLine('Report by fri', '2026-10-21').fields.deadline).toEqual({
      date: '2026-10-23',
      time: null
    })
    expect(parseLine('Report by tomorrow', D).fields.deadline).toEqual({
      date: '2026-10-24',
      time: null
    })
  })
  test('weekday day tokens resolve on/after today', () => {
    expect(parseLine('x fri', D).fields.date).toBe(D)
    expect(parseLine('x Monday', D).fields.date).toBe('2026-10-26')
    expect(parseLine('x tomorrow', D).fields.date).toBe('2026-10-24')
  })
  test('durations', () => {
    expect(parseLine('x 1h30m', D).fields.durationMin).toBe(90)
    expect(parseLine('x 2h', D).fields.durationMin).toBe(120)
  })
  test('invalid tokens stay in title', () => {
    const p = parseLine('Review 3 PRs at 25:00 0m # !urgent', D)
    expect(p.title).toBe('Review 3 PRs at 25:00 0m # !urgent')
    expect(p.fields).toEqual({})
  })
  test('last duplicate wins', () => expect(parseLine('x 15m 30m', D).fields.durationMin).toBe(30))
  test('case-insensitive', () => {
    expect(parseLine('x !HIGH @PM TODAY', D).fields).toMatchObject({
      priority: 'high',
      half: 'pm',
      date: D
    })
  })
  test('object prototype keys are not tokens', () => {
    const p = parseLine('Fix constructor bug __proto__ toString by constructor', D)
    expect(p).toEqual({
      title: 'Fix constructor bug __proto__ toString by constructor',
      fields: {},
      tokens: []
    })
  })
  test('title only', () =>
    expect(parseLine('Write docs', D)).toEqual({ title: 'Write docs', fields: {}, tokens: [] }))
})

describe('repeat tokens', () => {
  test('every day, weekdays, every mon,wed', () => {
    expect(parseLine('Water plants every day', D)).toMatchObject({
      title: 'Water plants',
      fields: { repeat: { kind: 'daily' } }
    })
    expect(parseLine('Inbox zero weekdays 15m', D).fields.repeat).toEqual({ kind: 'weekdays' })
    const w = parseLine('Gym every mon,wed', D)
    expect(w.title).toBe('Gym')
    expect(w.fields.repeat).toEqual({ kind: 'weekly', days: [1, 3] })
    expect(w.tokens.map((t) => t.kind)).toEqual(['repeat'])
  })

  test('every alone or with junk stays in the title', () => {
    expect(parseLine('Call every person', D).title).toBe('Call every person')
  })
})

describe('dnd', () => {
  test('!dnd sets dnd and is a token', () => {
    const p = parseLine('Write report 1h !high !dnd', D)
    expect(p.title).toBe('Write report')
    expect(p.fields.dnd).toBe(true)
    expect(p.tokens.map((t) => t.kind)).toEqual(['duration', 'priority', 'dnd'])
  })

  test('toNewItem defaults dnd from type and fixed start', () => {
    expect(toNewItem(parseLine('Plan ~deep', D), D, DEFAULT_SETTINGS).dnd).toBe(true)
    expect(toNewItem(parseLine('Standup at 10:00', D), D, DEFAULT_SETTINGS).dnd).toBe(true)
    expect(toNewItem(parseLine('Email Sam', D), D, DEFAULT_SETTINGS).dnd).toBe(false)
    expect(toNewItem(parseLine('Email Sam !dnd', D), D, DEFAULT_SETTINGS).dnd).toBe(true)
  })
})

describe('toNewItem', () => {
  test('defaults', () =>
    expect(toNewItem(parseLine('Deep thing ~deep', D), D, DEFAULT_SETTINGS)).toMatchObject({
      type: 'deep',
      durationMin: 120,
      priority: 'med',
      date: D,
      half: null,
      fixedStart: null,
      repeat: { kind: 'none' }
    }))
})
