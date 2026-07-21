import { join } from 'node:path'
import { app } from 'electron'
import { openDatabase, type Db } from './index'
import { SCHEMA_VERSION } from './schema'

/**
 * Electron-aware database singleton. Kept separate from `./index` so the query
 * layer stays importable (and unit-testable) without pulling in Electron.
 */

let db: Db | null = null
let dbPath = ''

export function getDb(): Db {
  if (!db) {
    dbPath = join(app.getPath('userData'), 'library.db')
    db = openDatabase(dbPath)
  }
  return db
}

export function closeDb(): void {
  db?.close()
  db = null
}

export interface DbInfo {
  path: string
  sqlite: string
  schemaVersion: number
  expectedSchemaVersion: number
  journalMode: string
  tables: string[]
  trackCount: number
}

/** Runtime evidence that the database is real and migrated, not merely imported. */
export function getDbInfo(): DbInfo {
  const d = getDb()
  return {
    path: dbPath,
    sqlite: d.sqliteVersion,
    schemaVersion: d.get<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0,
    expectedSchemaVersion: SCHEMA_VERSION,
    journalMode: d.get<{ journal_mode: string }>('PRAGMA journal_mode')?.journal_mode ?? '?',
    tables: d
      .all<{ name: string }>(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .map((r) => r.name),
    trackCount: d.get<{ c: number }>('SELECT count(*) AS c FROM tracks')?.c ?? 0
  }
}
