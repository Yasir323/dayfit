import { describe, expect, it } from 'vitest'
import { parseBackup, toBackup } from '../../src/main/backup'
import { defaultState } from '../../src/main/store'

const days = [{ date: '2026-10-22', summary: { date: '2026-10-22', done: 3 } }]

describe('backup', () => {
  it('round-trips state and days', () => {
    const state = defaultState()
    state.waterMl['2026-10-22'] = 500
    const b = toBackup(state, days, '2026-10-23T10:00:00.000Z')
    expect(b).toMatchObject({ app: 'dayfit', version: 1, exportedAt: '2026-10-23T10:00:00.000Z' })
    const back = parseBackup(JSON.stringify(b))
    if (back instanceof Error) throw back
    expect(back.state).toEqual(state)
    expect(back.days).toEqual(days)
  })

  const wrap = (o: Record<string, unknown>): string =>
    JSON.stringify({
      app: 'dayfit',
      version: 1,
      exportedAt: 'x',
      state: defaultState(),
      days,
      ...o
    })
  const message = (json: string): string => {
    const r = parseBackup(json)
    return r instanceof Error ? r.message : 'accepted'
  }

  it('rejects files that are not Dayfit backups', () => {
    expect(message('not json')).toBe('Not a Dayfit backup')
    expect(message('[]')).toBe('Not a Dayfit backup')
    expect(message(wrap({ app: 'other' }))).toBe('Not a Dayfit backup')
  })

  it('rejects an unknown version', () => {
    expect(message(wrap({ version: 2 }))).toBe('This backup is from a newer Dayfit')
  })

  it('rejects a state that is not Dayfit data', () => {
    expect(message(wrap({ state: 'x' }))).toBe('The backup has no Dayfit data')
    expect(message(wrap({ state: { version: 9 } }))).toBe('The backup has no Dayfit data')
  })

  it('rejects damaged history', () => {
    expect(message(wrap({ days: 'x' }))).toBe('The backup history is damaged')
    expect(message(wrap({ days: [{ date: 3, summary: {} }] }))).toBe(
      'The backup history is damaged'
    )
  })

  it('a backup without days is fine', () => {
    const r = parseBackup(wrap({ days: undefined }))
    expect(r instanceof Error ? r.message : r.days).toEqual([])
  })
})
