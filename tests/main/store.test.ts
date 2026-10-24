import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/core/types'
import { defaultState, loadState, saveState } from '../../src/main/store'
import { openDb } from '../../src/main/db'
import { EMPTY_BREAK_STATE } from '../../src/core/breaks'
import { EMPTY_END_OF_DAY_STATE } from '../../src/core/endOfDay'
import { EMPTY_WELLBEING_STATE } from '../../src/core/wellbeing'

let dir: string
let file: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfit-store-'))
  file = path.join(dir, 'dayfit.json')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

/** Puts a raw (possibly older-shaped) state document into the database, as an old app would. */
function writeRaw(raw: unknown): void {
  const db = openDb(file)
  db.writeState(raw)
  db.close()
}

describe('store', () => {
  it('round trips state', () => {
    const s = defaultState()
    s.waterMl['2026-10-23'] = 500
    s.lastDate = '2026-10-23'
    s.manualBusy = true
    saveState(file, s)
    expect(loadState(file)).toEqual(s)
  })

  it('fills missing dnd on load from type and fixed start', () => {
    const s = defaultState()
    const base = { title: 't', durationMin: 30, label: null, priority: 'med', half: null }
    const rest = { date: '2026-10-23', deadline: null, repeat: { kind: 'none' }, status: 'open' }
    const more = { lockedStart: null, suggestedSlots: [], createdAt: 1 }
    const raw = {
      ...s,
      items: [
        { ...base, ...rest, ...more, id: 'a', type: 'deep', fixedStart: null },
        { ...base, ...rest, ...more, id: 'b', type: 'task', fixedStart: null }
      ]
    }
    writeRaw(raw)
    expect(loadState(file).items.map((i) => i.dnd)).toEqual([true, false])
  })

  it('drops walk blocks from stored plans on load', () => {
    const s = defaultState()
    const task = { itemId: 'a', kind: 'task', start: 600, end: 630, chunk: null, reason: '' }
    const walk = { itemId: null, kind: 'walk', start: 690, end: 700, chunk: null, reason: '' }
    const plan = { blocks: [task, walk], decisions: [], unscheduled: [], moves: [] }
    writeRaw({ ...s, plans: { '2026-10-23': plan } })
    expect(loadState(file).plans['2026-10-23'].blocks).toEqual([task])
  })

  it('resets a v1-shaped reminder state on load', () => {
    const old = {
      activeMin: 7,
      lastEyeAt: 500,
      lastStretchAt: null,
      lastWaterAt: null,
      fired: ['x']
    }
    writeRaw({ ...defaultState(), reminder: old })
    expect(loadState(file).reminder).toEqual({ fired: ['x'], breaks: EMPTY_BREAK_STATE })
  })

  it('ignores the removed busy setting', () => {
    const s = defaultState()
    const settings = { ...s.settings, busy: { allowGentle: true }, water: { targetMl: 3000 } }
    writeRaw({ ...s, settings })
    const loaded = loadState(file).settings
    expect('busy' in loaded).toBe(false)
    expect(loaded.breaks.snoozeMin).toBe(10)
    expect(loaded.water.intervalMin).toBe(60)
  })

  it('fills endOfDay defaults for an older settings file', () => {
    const s = defaultState()
    const older: Record<string, unknown> = { ...s.settings }
    delete older.endOfDay
    writeRaw({ ...s, settings: older })
    expect(loadState(file).settings.endOfDay).toEqual(DEFAULT_SETTINGS.endOfDay)
  })

  it('older state without endOfDay loads with an empty end-of-day state', () => {
    const older: Record<string, unknown> = { ...defaultState() }
    delete older.endOfDay
    writeRaw(older)
    expect(loadState(file).endOfDay).toEqual(EMPTY_END_OF_DAY_STATE)
  })

  it('older state gets the backlog round 2 defaults', () => {
    const older: Record<string, unknown> = { ...defaultState() }
    for (const k of ['moods', 'wellbeing', 'ergonomics', 'fatigueBaseline']) delete older[k]
    const settings: Record<string, unknown> = { ...defaultState().settings }
    delete settings.features
    writeRaw({ ...older, settings })
    const s = loadState(file)
    expect(s.settings.features).toEqual(DEFAULT_SETTINGS.features)
    expect(s.moods).toEqual({})
    expect(s.wellbeing).toEqual(EMPTY_WELLBEING_STATE)
    expect(s.ergonomics).toEqual([])
    expect(s.fatigueBaseline).toBeNull()
  })

  it('older state without lunchAnswer loads with null', () => {
    const older: Record<string, unknown> = { ...defaultState() }
    delete older.lunchAnswer
    writeRaw(older)
    expect(loadState(file).lunchAnswer).toBeNull()
  })

  it('older state without alerts loads with [] and null', () => {
    const older: Record<string, unknown> = { ...defaultState() }
    delete older.alerts
    delete older.unseen
    writeRaw(older)
    const s = loadState(file)
    expect(s.alerts).toEqual([])
    expect(s.unseen).toBeNull()
  })

  it('older state without answers loads with []', () => {
    const older: Record<string, unknown> = { ...defaultState() }
    delete older.answers
    writeRaw(older)
    expect(loadState(file).answers).toEqual([])
  })

  it('older state without coffee loads with {}', () => {
    const older: Record<string, unknown> = { ...defaultState() }
    delete older.coffee
    writeRaw(older)
    expect(loadState(file).coffee).toEqual({})
    expect(loadState(file).settings.coffee).toEqual({ capCups: 3, cutoff: 900 })
  })

  it('returns defaults for a missing file', () => {
    expect(loadState(file)).toEqual(defaultState())
  })

  it('defaultState returns fresh objects and the documented defaults', () => {
    const a = defaultState()
    a.settings.water.targetMl = 1
    a.reminder.fired.push('x')
    const b = defaultState()
    expect(b.settings).toEqual(DEFAULT_SETTINGS)
    expect(b.reminder.fired).toEqual([])
    expect(DEFAULT_SETTINGS.water.targetMl).toBe(2000)
    expect(b).toMatchObject({
      items: [],
      plans: {},
      waterMl: {},
      nudges: {},
      overdue: [],
      manualBusy: null,
      lastDate: null,
      version: 1
    })
  })

  it('corrupt store is backed up and replaced with defaults', () => {
    fs.writeFileSync(file, '{bad')
    expect(loadState(file)).toEqual(defaultState())
    const backups = fs.readdirSync(dir).filter((f) => f.startsWith('dayfit.json.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(fs.readFileSync(path.join(dir, backups[0]), 'utf8')).toBe('{bad')
  })

  it('wrong version is backed up and replaced with defaults', () => {
    writeRaw({ version: 2 })
    expect(loadState(file)).toEqual(defaultState())
    expect(fs.readdirSync(dir).some((f) => f.startsWith('dayfit.json.corrupt-'))).toBe(true)
  })

  it('merges partial settings deeply over defaults and fills missing fields', () => {
    writeRaw({ version: 1, settings: { hotkey: 'X', water: { targetMl: 3000 } } })
    const s = loadState(file)
    expect(s.settings.hotkey).toBe('X')
    expect(s.settings.water).toEqual({
      enabled: true,
      intervalMin: 60,
      targetMl: 3000,
      glassMl: 250
    })
    expect(s.settings.workStart).toBe(DEFAULT_SETTINGS.workStart)
    expect(s.items).toEqual([])
    expect(s.reminder).toEqual(defaultState().reminder)
  })

  it('saveState creates the parent directory', () => {
    const nested = path.join(dir, 'a', 'b', 'dayfit.json')
    saveState(nested, defaultState())
    expect(fs.existsSync(nested)).toBe(true)
    expect(loadState(nested).version).toBe(1)
  })
})

describe('feature defaults', () => {
  it('busy-when-full-screen is opt-in (native full screen is common for work)', () => {
    expect(DEFAULT_SETTINGS.features.autoBusyFullscreen.enabled).toBe(false)
  })
})
