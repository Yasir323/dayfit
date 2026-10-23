import { describe, expect, it } from 'vitest'
import { buildSections, type Section } from '../../src/renderer/src/lib/listSections'
import { block, item, makeView } from './fixtures'

const keys = (v: ReturnType<typeof makeView>): string[] => buildSections(v).map((s) => s.key)
const section = (v: ReturnType<typeof makeView>, key: string): Section | undefined =>
  buildSections(v).find((s) => s.key === key)

describe('buildSections', () => {
  it('puts overdue items only in overdue', () => {
    const v = makeView({ nudges: ['deep'] })
    expect(section(v, 'overdue')?.rows.map((r) => r.item.id)).toEqual(['deep'])
    expect(section(v, 'today')?.rows.map((r) => r.item.id)).toEqual(['standup'])
  })

  it('summarises today as count and planned time', () => {
    const v = makeView({
      plan: {
        ...makeView().plan,
        blocks: [
          block('a', 'fixed', 540, 555),
          block('b', 'deep', 560, 680),
          block('c', 'task', 690, 710)
        ]
      },
      items: [
        item('a', 'A', { type: 'fixed', fixedStart: 540, durationMin: 15 }),
        item('b', 'B', { type: 'deep', durationMin: 120 }),
        item('c', 'C', { durationMin: 20 })
      ]
    })
    expect(section(v, 'today')?.summary).toBe('3 · 2h 35m')
  })

  it('the today summary leaves out done items', () => {
    const base = makeView()
    const v = makeView({
      plan: { ...base.plan, blocks: [block('a', 'task', 600, 630), block('b', 'task', 640, 670)] },
      items: [item('a', 'A'), item('b', 'B', { status: 'done' })]
    })
    expect(section(v, 'today')?.summary).toBe('1 · 30m')
  })

  it('a household item with a fixed start keeps its label and deadline', () => {
    const base = makeView()
    const h = item('h', 'Pay bill', {
      type: 'household',
      fixedStart: 840,
      durationMin: 15,
      label: 'home',
      deadline: { date: base.today, time: 1080 }
    })
    const v = makeView({
      plan: { ...base.plan, blocks: [block('h', 'fixed', 840, 855)] },
      items: [h]
    })
    expect(section(v, 'today')?.rows[0].detail).toBe('14:00 · 15m · #home · by 18:00')
  })

  it('later shows the date and the due day', () => {
    const later = item('l', 'Taxes', {
      date: '2026-10-26',
      deadline: { date: '2026-10-30', time: null }
    })
    const v = makeView({ upcoming: [later] })
    expect(section(v, 'later')?.rows[0].detail).toBe('Mon 26 Oct · due Fri')
  })

  it('shows a split deep item as one row listing every chunk', () => {
    const row = section(makeView(), 'today')?.rows.find((r) => r.item.id === 'deep')
    expect(row?.blocks).toHaveLength(2)
    expect(row?.detail).toBe('09:20–10:20 · 10:25–11:25 · deep work')
  })

  it('details fixed and task rows', () => {
    const v = makeView({
      plan: {
        ...makeView().plan,
        blocks: [block('standup', 'fixed', 540, 555), block('t', 'task', 755, 775)]
      },
      items: [
        makeView().items[0],
        item('t', 'Review', {
          durationMin: 20,
          label: 'review',
          deadline: { date: '2026-10-23', time: 1080 }
        })
      ]
    })
    const rows = section(v, 'today')!.rows
    expect(rows.map((r) => r.detail)).toEqual(['09:00 · 15m', '12:35 · 20m · #review · by 18:00'])
  })

  it('puts awaiting calls last in today with suggested slots', () => {
    const call = item('c1', 'Call John', { type: 'call', suggestedSlots: [855, 920] })
    const v = makeView({ items: [...makeView().items, call], awaitingCalls: [call] })
    const rows = section(v, 'today')!.rows
    expect(rows.at(-1)?.item.id).toBe('c1')
    expect(rows.at(-1)?.detail).toBe('Suggest 14:15 · 15:20')
  })

  it('lists unscheduled items in their own section', () => {
    const u = item('u1', 'Later maybe')
    const v = makeView({
      items: [...makeView().items, u],
      plan: { ...makeView().plan, unscheduled: ['u1'] }
    })
    expect(section(v, 'unscheduled')?.rows.map((r) => r.item.id)).toEqual(['u1'])
    expect(section(v, 'today')?.rows.map((r) => r.item.id)).not.toContain('u1')
  })

  it('tomorrow shows fixed times and lengths, collapsed by default', () => {
    const run = item('run', 'Run', {
      type: 'fixed',
      fixedStart: 1110,
      durationMin: 45,
      repeat: { kind: 'daily' }
    })
    const t = item('t', 'Write', { date: '2026-10-24', durationMin: 20 })
    const s = section(makeView({ tomorrow: [run, t] }), 'tomorrow')!
    expect(s.collapsedByDefault).toBe(true)
    expect(s.rows.map((r) => r.detail)).toEqual(['18:30 · 45m', '20m'])
  })

  it('later holds items after tomorrow with their day or deadline', () => {
    const a = item('a', 'A', { date: '2026-10-26' })
    const b = item('b', 'B', {
      date: '2026-10-24',
      deadline: { date: '2026-10-26', time: null }
    })
    const s = section(makeView({ upcoming: [a, b] }), 'later')!
    expect(s.rows.map((r) => r.item.id)).toEqual(['a'])
    expect(s.rows[0].detail).toBe('Mon 26 Oct')
    const d = item('d', 'D', { date: '2026-10-27', deadline: { date: '2026-10-26', time: null } })
    expect(section(makeView({ upcoming: [d] }), 'later')!.rows[0].detail).toBe(
      'Tue 27 Oct · due Mon'
    )
  })

  it('empty sections are hidden', () => {
    const v = makeView({
      items: [],
      plan: { blocks: [], decisions: [], unscheduled: [], moves: [] },
      tomorrow: [item('t', 'T', { date: '2026-10-24' })]
    })
    expect(keys(v)).toEqual(['tomorrow'])
  })
})
