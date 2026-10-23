import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import type { DateStr } from '../core/types'

/** Small local database: the app state as one JSON document, plus one summary row per day. */
export interface Db {
  readonly file: string
  readState(): unknown | null
  writeState(state: unknown): void
  putDay(date: DateStr, summary: unknown): void
  days(fromDate: DateStr, toDate: DateStr): { date: DateStr; summary: unknown }[]
  /** Replaces the whole history in one transaction (backup import). */
  replaceDays(days: { date: DateStr; summary: unknown }[]): void
  close(): void
}

const SCHEMA = `
  CREATE TABLE IF NOT EXISTS state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    json TEXT NOT NULL,
    updated_at TEXT NOT NULL
  );
  CREATE TABLE IF NOT EXISTS days (
    date TEXT PRIMARY KEY,
    summary TEXT NOT NULL
  );
`

function connect(file: string): DatabaseSync {
  const db = new DatabaseSync(file)
  db.exec('PRAGMA journal_mode = WAL')
  db.exec(SCHEMA)
  return db
}

/** Opens (creating if needed) the database; an unreadable file is set aside and replaced. */
export function openDb(file: string): Db {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let db: DatabaseSync
  try {
    db = connect(file)
  } catch {
    fs.renameSync(file, `${file}.corrupt-${Date.now()}`)
    for (const side of ['-wal', '-shm']) fs.rmSync(file + side, { force: true })
    db = connect(file)
  }
  const read = db.prepare('SELECT json FROM state WHERE id = 1')
  const write = db.prepare('INSERT OR REPLACE INTO state (id, json, updated_at) VALUES (1, ?, ?)')
  const put = db.prepare('INSERT OR REPLACE INTO days (date, summary) VALUES (?, ?)')
  const range = db.prepare(
    'SELECT date, summary FROM days WHERE date >= ? AND date <= ? ORDER BY date'
  )
  return {
    file,
    readState() {
      const row = read.get() as { json: string } | undefined
      if (!row) return null
      try {
        return JSON.parse(row.json) as unknown
      } catch {
        return null
      }
    },
    writeState(state) {
      write.run(JSON.stringify(state), new Date().toISOString())
    },
    putDay(date, summary) {
      put.run(date, JSON.stringify(summary))
    },
    days(fromDate, toDate) {
      return (range.all(fromDate, toDate) as { date: string; summary: string }[]).map((r) => ({
        date: r.date,
        summary: JSON.parse(r.summary) as unknown
      }))
    },
    replaceDays(rows) {
      db.exec('BEGIN')
      try {
        db.exec('DELETE FROM days')
        for (const r of rows) put.run(r.date, JSON.stringify(r.summary))
        db.exec('COMMIT')
      } catch (e) {
        db.exec('ROLLBACK')
        throw e
      }
    },
    close() {
      db.close()
    }
  }
}

/**
 * One-time import of the old JSON state file into an empty database. The JSON file is kept,
 * renamed to `.migrated`, as a safety copy. Returns true when it imported.
 */
export function migrateJson(db: Db, jsonFile: string): boolean {
  if (db.readState() !== null || !fs.existsSync(jsonFile)) return false
  let parsed: unknown
  try {
    parsed = JSON.parse(fs.readFileSync(jsonFile, 'utf8'))
  } catch {
    return false
  }
  db.writeState(parsed)
  fs.renameSync(jsonFile, `${jsonFile}.migrated`)
  return true
}
