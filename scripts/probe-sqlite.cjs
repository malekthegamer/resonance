// Probe: is node:sqlite available inside Electron's bundled Node, and does it
// support everything Resonance's library DB needs?
const { app } = require('electron')

app.whenReady().then(() => {
  const out = {
    electron: process.versions.electron,
    node: process.versions.node,
    modules: process.versions.modules
  }
  try {
    const { DatabaseSync } = require('node:sqlite')
    const db = new DatabaseSync(':memory:')
    db.exec('CREATE TABLE t (id INTEGER PRIMARY KEY, name TEXT, n INTEGER)')

    const ins = db.prepare('INSERT INTO t (name, n) VALUES (?, ?)')
    ins.run('hello', 1)
    ins.run('world', 2)

    const ver = db.prepare('SELECT sqlite_version() AS v').get()
    const rows = db.prepare('SELECT * FROM t ORDER BY id').all()

    // Batched-insert transaction path used by the scanner
    db.exec('BEGIN')
    for (let i = 0; i < 500; i++) ins.run('bulk' + i, i)
    db.exec('COMMIT')
    const count = db.prepare('SELECT count(*) AS c FROM t').get()

    // Named parameters, used throughout the query layer
    const named = db.prepare('SELECT name FROM t WHERE n = :n').get({ n: 2 })

    // FTS5 — would be nice for global search
    let fts5 = 'no'
    try {
      db.exec("CREATE VIRTUAL TABLE fts USING fts5(title, artist)")
      db.exec("INSERT INTO fts VALUES ('Guren no Yumiya', 'Linked Horizon')")
      const hit = db.prepare("SELECT title FROM fts WHERE fts MATCH 'guren'").get()
      fts5 = hit ? 'yes' : 'no-match'
    } catch (e) { fts5 = 'no: ' + e.message }

    out.sqlite = {
      ok: true,
      version: ver.v,
      sampleRows: rows,
      bulkCount: count.c,
      namedParams: named && named.name,
      fts5
    }
    db.close()
  } catch (e) {
    out.sqlite = { ok: false, error: String((e && e.message) || e) }
  }

  // WAL needs a real file, not :memory:
  try {
    const os = require('node:os'); const path = require('node:path'); const fs = require('node:fs')
    const { DatabaseSync } = require('node:sqlite')
    const f = path.join(os.tmpdir(), 'resonance-probe-' + Date.now() + '.db')
    const db2 = new DatabaseSync(f)
    db2.exec('PRAGMA journal_mode = WAL')
    const jm = db2.prepare('PRAGMA journal_mode').get()
    out.walMode = jm.journal_mode
    db2.close()
    fs.rmSync(f, { force: true })
    fs.rmSync(f + '-wal', { force: true })
    fs.rmSync(f + '-shm', { force: true })
  } catch (e) {
    out.walMode = 'error: ' + ((e && e.message) || e)
  }

  console.log('PROBE_RESULT ' + JSON.stringify(out, null, 2))
  app.quit()
})
