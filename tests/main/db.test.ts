import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { migrateJson, openDb, restoreMigrated } from '../../src/main/db'
import { removeDir } from './tempDir'

let dir: string
let file: string
beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dayfit-db-'))
  file = path.join(dir, 'dayfit.db')
})
afterEach(() => removeDir(dir))

describe('openDb', () => {
  it('starts empty and round-trips the state', () => {
    const db = openDb(file)
    expect(db.readState()).toBeNull()
    db.writeState({ version: 1, a: [1, 2] })
    db.close()
    expect(openDb(file).readState()).toEqual({ version: 1, a: [1, 2] })
  })

  it('stores day summaries and reads a date range in order', () => {
    const db = openDb(file)
    db.putDay('2026-10-21', { n: 1 })
    db.putDay('2026-10-23', { n: 3 })
    db.putDay('2026-10-22', { n: 2 })
    db.putDay('2026-10-22', { n: 22 })
    expect(db.days('2026-10-22', '2026-10-23')).toEqual([
      { date: '2026-10-22', summary: { n: 22 } },
      { date: '2026-10-23', summary: { n: 3 } }
    ])
  })

  it('a corrupt file is set aside and a fresh database starts', () => {
    fs.writeFileSync(file, 'not a database at all, just text')
    const db = openDb(file)
    expect(db.readState()).toBeNull()
    expect(fs.readdirSync(dir).some((f) => f.startsWith('dayfit.db.corrupt-'))).toBe(true)
  })
})

describe('migrateJson', () => {
  it('imports dayfit.json once and renames it', () => {
    const json = path.join(dir, 'dayfit.json')
    fs.writeFileSync(json, JSON.stringify({ version: 1, items: [] }))
    const db = openDb(file)
    expect(migrateJson(db, json)).toBe(true)
    expect(db.readState()).toEqual({ version: 1, items: [] })
    expect(fs.existsSync(json)).toBe(false)
    expect(fs.existsSync(json + '.migrated')).toBe(true)
    expect(migrateJson(db, json)).toBe(false)
  })

  it('never overwrites existing database state', () => {
    const json = path.join(dir, 'dayfit.json')
    fs.writeFileSync(json, JSON.stringify({ version: 1, items: ['old'] }))
    const db = openDb(file)
    db.writeState({ version: 1, items: ['new'] })
    expect(migrateJson(db, json)).toBe(false)
    expect(db.readState()).toEqual({ version: 1, items: ['new'] })
  })
})

describe('replaceDays', () => {
  it('swaps the whole history', () => {
    const db = openDb(file)
    db.putDay('2026-10-01', { n: 1 })
    db.replaceDays([{ date: '2026-10-22', summary: { n: 2 } }])
    expect(db.days('2000-01-01', '2999-12-31')).toEqual([{ date: '2026-10-22', summary: { n: 2 } }])
  })
})

describe('migrateJson failures and recovery', () => {
  it('an unreadable JSON file is set aside so it is not silently lost', () => {
    const json = path.join(dir, 'dayfit.json')
    fs.writeFileSync(json, '{ not json')
    const db = openDb(file)
    expect(migrateJson(db, json)).toBe(false)
    expect(fs.existsSync(json)).toBe(false)
    expect(fs.readdirSync(dir).some((f) => f.startsWith('dayfit.json.corrupt-'))).toBe(true)
  })

  it('a corrupt database is rebuilt from the migrated JSON copy', () => {
    fs.writeFileSync(file, 'garbage, not sqlite')
    const json = path.join(dir, 'dayfit.json')
    fs.writeFileSync(`${json}.migrated`, JSON.stringify({ version: 1, items: [] }))
    const db = openDb(file)
    expect(db.recovered).toBe(true)
    expect(restoreMigrated(db, json)).toBe(true)
    expect(db.readState()).toEqual({ version: 1, items: [] })
    expect(fs.existsSync(`${json}.migrated`)).toBe(true)
  })

  it('a healthy empty database is not filled from the old copy', () => {
    const json = path.join(dir, 'dayfit.json')
    fs.writeFileSync(`${json}.migrated`, JSON.stringify({ version: 1 }))
    const db = openDb(file)
    expect(db.recovered).toBe(false)
    expect(restoreMigrated(db, json)).toBe(false)
  })
})
