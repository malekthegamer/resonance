import { DatabaseSync } from 'node:sqlite'
import { MIGRATIONS } from './schema'

/**
 * The single seam between Resonance and its SQLite driver.
 *
 * Everything above this file talks to `Db`, never to `node:sqlite` directly, so
 * swapping back to better-sqlite3 (should a C++ toolchain ever appear on the
 * target machine — see PLAN.md §A7) is a change to this file alone.
 *
 * Deliberately free of any `electron` import so the query layer can be unit
 * tested against an in-memory database under plain Node.
 */

export type Row = Record<string, unknown>

export interface Db {
  exec(sql: string): void
  get<T = Row>(sql: string, params?: unknown): T | undefined
  all<T = Row>(sql: string, params?: unknown): T[]
  run(sql: string, params?: unknown): { changes: number; lastInsertRowid: number }
  /** Runs `fn` inside a transaction, rolling back if it throws. */
  transaction<T>(fn: () => T): T
  close(): void
  readonly sqliteVersion: string
}

/** node:sqlite accepts either positional args or a single named-params object. */
function bind(stmt: { run: Function; get: Function; all: Function }, method: 'run' | 'get' | 'all', params: unknown): unknown {
  if (params === undefined || params === null) return stmt[method]()
  if (Array.isArray(params)) return stmt[method](...params)
  return stmt[method](params)
}

export function openDatabase(filename: string): Db {
  const raw = new DatabaseSync(filename)

  // WAL lets the scanner write while the UI reads without blocking each other.
  // ':memory:' does not support WAL and will report 'memory' — harmless.
  raw.exec('PRAGMA journal_mode = WAL')
  raw.exec('PRAGMA synchronous = NORMAL')
  raw.exec('PRAGMA foreign_keys = ON')

  const db: Db = {
    exec: (sql) => raw.exec(sql),

    get: <T,>(sql: string, params?: unknown) =>
      bind(raw.prepare(sql) as never, 'get', params) as T | undefined,

    all: <T,>(sql: string, params?: unknown) =>
      (bind(raw.prepare(sql) as never, 'all', params) ?? []) as T[],

    run: (sql, params) => {
      const r = bind(raw.prepare(sql) as never, 'run', params) as {
        changes: number | bigint
        lastInsertRowid: number | bigint
      }
      return {
        changes: Number(r.changes),
        lastInsertRowid: Number(r.lastInsertRowid)
      }
    },

    transaction: <T,>(fn: () => T): T => {
      raw.exec('BEGIN')
      try {
        const result = fn()
        raw.exec('COMMIT')
        return result
      } catch (err) {
        // Rollback must not mask the original error.
        try {
          raw.exec('ROLLBACK')
        } catch {
          /* already rolled back */
        }
        throw err
      }
    },

    close: () => raw.close(),

    get sqliteVersion(): string {
      const row = raw.prepare('SELECT sqlite_version() AS v').get() as { v: string }
      return row.v
    }
  }

  migrate(db)
  return db
}

/**
 * Applies any migrations the database has not yet seen.
 * `user_version` is used rather than a table so the very first migration has
 * somewhere to record itself.
 */
export function migrate(db: Db): number {
  const current = (db.get<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0) as number

  for (let version = current; version < MIGRATIONS.length; version++) {
    db.transaction(() => {
      db.exec(MIGRATIONS[version]!)
    })
    // PRAGMA does not accept bound parameters; the value is a loop counter, not
    // user input, so interpolation is safe here.
    db.exec(`PRAGMA user_version = ${version + 1}`)
  }

  return MIGRATIONS.length
}
