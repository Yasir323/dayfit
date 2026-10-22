import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_SETTINGS } from '../../src/core/types'
import { defaultState, loadState, saveState } from '../../src/main/store'

let dir: string
let file: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfit-store-'))
  file = path.join(dir, 'dayfit.json')
})
afterEach(() => fs.rmSync(dir, { recursive: true, force: true }))

describe('store', () => {
  it('round trips state', () => {
    const s = defaultState()
    s.waterMl['2026-10-23'] = 500
    s.lastDate = '2026-10-23'
    s.manualBusy = true
    saveState(file, s)
    expect(loadState(file)).toEqual(s)
    expect(fs.existsSync(file + '.tmp')).toBe(false)
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
    expect(b).toMatchObject({ items: [], plans: {}, waterMl: {}, nudges: {}, overdue: [], manualBusy: null, lastDate: null, version: 1 })
  })

  it('corrupt store is backed up and replaced with defaults', () => {
    fs.writeFileSync(file, '{bad')
    expect(loadState(file)).toEqual(defaultState())
    const backups = fs.readdirSync(dir).filter((f) => f.startsWith('dayfit.json.corrupt-'))
    expect(backups).toHaveLength(1)
    expect(fs.readFileSync(path.join(dir, backups[0]), 'utf8')).toBe('{bad')
    expect(fs.existsSync(file)).toBe(false)
  })

  it('wrong version is backed up and replaced with defaults', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 2 }))
    expect(loadState(file)).toEqual(defaultState())
    expect(fs.readdirSync(dir).some((f) => f.startsWith('dayfit.json.corrupt-'))).toBe(true)
  })

  it('merges partial settings deeply over defaults and fills missing fields', () => {
    fs.writeFileSync(file, JSON.stringify({ version: 1, settings: { hotkey: 'X', water: { targetMl: 3000 } } }))
    const s = loadState(file)
    expect(s.settings.hotkey).toBe('X')
    expect(s.settings.water).toEqual({ enabled: true, targetMl: 3000, glassMl: 250 })
    expect(s.settings.workStart).toBe(DEFAULT_SETTINGS.workStart)
    expect(s.items).toEqual([])
    expect(s.reminder).toEqual(defaultState().reminder)
  })

  it('saveState creates the parent directory', () => {
    const nested = path.join(dir, 'a', 'b', 'dayfit.json')
    saveState(nested, defaultState())
    expect(fs.existsSync(nested)).toBe(true)
    expect(fs.readFileSync(nested, 'utf8')).toContain('\n  "version": 1')
  })
})
