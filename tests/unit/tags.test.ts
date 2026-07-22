import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { parseFile } from 'music-metadata'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  backupOnce,
  backupSlotFor,
  readTags,
  writeTags,
  type TagValues
} from '../../src/main/tags'
import { ensureFixtures, fixturePaths } from '../fixtures/gen-audio'

/**
 * Tag writing is destructive, so every test here works on a **copy** of a
 * generated fixture inside a temp directory. The user's own library is never a
 * test target — see the safety rule in the slice plan. The originals in
 * `tests/fixtures/media` are copied from, never written to.
 */

const WORK = join(tmpdir(), `resonance-tags-${process.pid}`)
const BACKUPS = join(WORK, 'backups')

const FORMATS = ['mp3', 'flac', 'm4a', 'ogg', 'opus', 'wav'] as const

/** Deliberately non-ASCII: that is where tag encoding bugs actually live. */
const NEW_TAGS: TagValues = {
  title: 'Rewritten 書き換え',
  artist: 'Nouveau Artiste ñ',
  album: 'New Album Ω',
  albumArtist: 'Album Artist',
  genre: 'Ambient',
  year: 2019,
  trackNo: 3
}

let sources: Record<string, string>

/** A fresh copy, so each test starts from a known-good file. */
function copyOf(ext: string, label: string): string {
  const dst = join(WORK, `${label}.${ext}`)
  copyFileSync(sources[ext]!, dst)
  return dst
}

beforeAll(() => {
  ensureFixtures()
  sources = fixturePaths().byFormat
  rmSync(WORK, { recursive: true, force: true })
  mkdirSync(WORK, { recursive: true })
}, 120_000)

afterAll(() => {
  rmSync(WORK, { recursive: true, force: true })
})

describe('write → read round-trip', () => {
  /*
   * The premise of the whole feature: taglib writes it, music-metadata reads it
   * back. Two unrelated libraries have to agree, across three unrelated tag
   * systems — ID3, Vorbis comments and MP4 atoms.
   */
  it.each(FORMATS)('%s survives a write and reads back through music-metadata', async (ext) => {
    const file = copyOf(ext, 'roundtrip')

    const [result] = writeTags([file], NEW_TAGS, { backupRoot: BACKUPS })
    expect(result!.ok, result!.error).toBe(true)

    const meta = await parseFile(file)
    expect(meta.common.title).toBe(NEW_TAGS.title)
    expect(meta.common.artist).toBe(NEW_TAGS.artist)
    expect(meta.common.album).toBe(NEW_TAGS.album)
    expect(meta.common.albumartist).toBe(NEW_TAGS.albumArtist)
    expect(meta.common.genre?.[0]).toBe(NEW_TAGS.genre)
    expect(meta.common.year).toBe(NEW_TAGS.year)
    expect(meta.common.track.no).toBe(NEW_TAGS.trackNo)
  })

  it.each(FORMATS)('%s reads back through readTags itself', (ext) => {
    const file = copyOf(ext, 'selfread')
    writeTags([file], NEW_TAGS, { backupRoot: BACKUPS })

    const [read] = readTags([file])
    expect(read!.ok, read!.error).toBe(true)
    expect(read!.tags).toMatchObject(NEW_TAGS)
  })

  it('still decodes as audio afterwards', async () => {
    const file = copyOf('mp3', 'stillaudio')
    writeTags([file], NEW_TAGS, { backupRoot: BACKUPS })

    // A tag write that corrupts the audio stream would still pass every
    // assertion above.
    const meta = await parseFile(file)
    expect(meta.format.duration).toBeGreaterThan(0)
    expect(meta.format.sampleRate).toBeGreaterThan(0)
  })
})

describe('partial edits', () => {
  // The reason a twelve-track edit is safe: an untouched field must not be
  // blanked across the whole selection.
  it('leaves fields that are not in the change set alone', async () => {
    const file = copyOf('mp3', 'partial')
    writeTags([file], NEW_TAGS, { backupRoot: BACKUPS })

    writeTags([file], { title: 'Only The Title' }, { backupRoot: BACKUPS })

    const meta = await parseFile(file)
    expect(meta.common.title).toBe('Only The Title')
    expect(meta.common.artist).toBe(NEW_TAGS.artist)
    expect(meta.common.album).toBe(NEW_TAGS.album)
  })

  // Clearing has to be expressible, or a wrong tag could never be removed.
  it('treats an empty string as "clear this field"', async () => {
    const file = copyOf('mp3', 'clearing')
    writeTags([file], NEW_TAGS, { backupRoot: BACKUPS })

    writeTags([file], { genre: '' }, { backupRoot: BACKUPS })

    const meta = await parseFile(file)
    expect(meta.common.genre ?? []).toHaveLength(0)
    expect(meta.common.title).toBe(NEW_TAGS.title)
  })

  it('writes nothing at all when the change set is empty', async () => {
    const file = copyOf('mp3', 'noop')
    writeTags([file], NEW_TAGS, { backupRoot: BACKUPS })

    const [result] = writeTags([file], {}, { backupRoot: BACKUPS })
    expect(result!.ok).toBe(true)

    const meta = await parseFile(file)
    expect(meta.common.title).toBe(NEW_TAGS.title)
  })
})

describe('artwork', () => {
  // ogg/opus carry pictures as base64 METADATA_BLOCK_PICTURE and the fixture
  // generator cannot produce them, so coverage stops at the three that can.
  it.each(['mp3', 'flac', 'm4a'])('embeds cover art into %s', async (ext) => {
    const file = copyOf(ext, 'artwork')
    const cover = fixturePaths().cover

    const [result] = writeTags([file], {}, { backupRoot: BACKUPS, artworkPath: cover })
    expect(result!.ok, result!.error).toBe(true)

    const meta = await parseFile(file)
    expect(meta.common.picture?.length).toBeGreaterThan(0)
    expect(meta.common.picture![0]!.format).toMatch(/jpeg|jpg/i)
  })

  it('clears artwork when passed null', async () => {
    const file = copyOf('mp3', 'artclear')
    writeTags([file], {}, { backupRoot: BACKUPS, artworkPath: fixturePaths().cover })

    writeTags([file], {}, { backupRoot: BACKUPS, artworkPath: null })

    const meta = await parseFile(file)
    expect(meta.common.picture ?? []).toHaveLength(0)
  })

  it('leaves artwork alone when the path is omitted', async () => {
    const file = copyOf('mp3', 'artkeep')
    writeTags([file], {}, { backupRoot: BACKUPS, artworkPath: fixturePaths().cover })

    writeTags([file], { title: 'Retagged' }, { backupRoot: BACKUPS })

    const meta = await parseFile(file)
    expect(meta.common.picture?.length).toBeGreaterThan(0)
  })
})

describe('backups', () => {
  it('copies the original before the first write', () => {
    const file = copyOf('mp3', 'backup-first')
    const before = readFileSync(file)

    const [result] = writeTags([file], NEW_TAGS, { backupRoot: BACKUPS })
    expect(result!.backedUp).toBe(true)

    const { file: backup } = backupSlotFor(BACKUPS, file)
    expect(existsSync(backup)).toBe(true)
    expect(readFileSync(backup).equals(before)).toBe(true)
  })

  /*
   * The point of the backup is the state the user came in with. Re-backing-up
   * on every edit would overwrite that pristine copy with an already-edited
   * one after a single further save — silently destroying the only thing the
   * mechanism exists to protect.
   */
  it('never overwrites the original with an already-edited copy', () => {
    const file = copyOf('mp3', 'backup-once')
    const pristine = readFileSync(file)

    expect(writeTags([file], { title: 'First' }, { backupRoot: BACKUPS })[0]!.backedUp).toBe(true)
    expect(writeTags([file], { title: 'Second' }, { backupRoot: BACKUPS })[0]!.backedUp).toBe(false)
    expect(writeTags([file], { title: 'Third' }, { backupRoot: BACKUPS })[0]!.backedUp).toBe(false)

    const { file: backup } = backupSlotFor(BACKUPS, file)
    expect(readFileSync(backup).equals(pristine)).toBe(true)
  })

  it('reports the second call as not-a-backup without touching the file', () => {
    const file = copyOf('mp3', 'backup-second')
    expect(backupOnce(BACKUPS, file)).toBe(true)
    const { file: backup } = backupSlotFor(BACKUPS, file)
    const stamp = statSync(backup).mtimeMs

    expect(backupOnce(BACKUPS, file)).toBe(false)
    expect(statSync(backup).mtimeMs).toBe(stamp)
  })

  // Two albums both containing "01 - Intro.mp3" must not share a backup slot.
  it('keys by full path, so identical filenames do not collide', () => {
    const a = join(WORK, 'a')
    const b = join(WORK, 'b')
    mkdirSync(a, { recursive: true })
    mkdirSync(b, { recursive: true })
    copyFileSync(sources['mp3']!, join(a, 'same-name.mp3'))
    copyFileSync(sources['mp3']!, join(b, 'same-name.mp3'))

    expect(backupOnce(BACKUPS, join(a, 'same-name.mp3'))).toBe(true)
    expect(backupOnce(BACKUPS, join(b, 'same-name.mp3'))).toBe(true)
    expect(backupSlotFor(BACKUPS, join(a, 'same-name.mp3')).dir).not.toBe(
      backupSlotFor(BACKUPS, join(b, 'same-name.mp3')).dir
    )
  })

  it('restores a file byte-for-byte from its backup', () => {
    const file = copyOf('flac', 'restore')
    const pristine = readFileSync(file)

    writeTags([file], NEW_TAGS, { backupRoot: BACKUPS })
    expect(readFileSync(file).equals(pristine)).toBe(false)

    // The backup is the undo. If this ever fails, the safety net is decorative.
    const { file: backup } = backupSlotFor(BACKUPS, file)
    copyFileSync(backup, file)
    expect(readFileSync(file).equals(pristine)).toBe(true)
  })
})

describe('reading is sanitised', () => {
  /*
   * RIFF INFO strings are NUL-terminated and taglib returns the terminator, so
   * a WAV title comes back as "Resonance Test Tone " while
   * music-metadata — and therefore the database — reports it trimmed. The
   * difference is invisible on screen and breaks every equality check that
   * touches it, including "do these tracks share a title?" in the editor.
   */
  it('strips the NUL terminator off RIFF INFO values', () => {
    const file = copyOf('wav', 'nul-terminated')
    const [read] = readTags([file])

    expect(read!.ok).toBe(true)
    const title = read!.tags!.title
    expect([...title].some((c) => c.charCodeAt(0) < 0x20)).toBe(false)
    expect(title).toBe(title.trim())
    expect(title).toBe('Resonance Test Tone')
  })

  it('leaves ordinary values untouched', () => {
    const file = copyOf('mp3', 'clean-read')
    const [read] = readTags([file])
    expect(read!.tags!.title).toBe('Resonance Test Tone')
    // Non-ASCII must survive sanitising; only control characters go.
    expect(read!.tags!.artist).toBe('Test Artist 紅蓮')
  })
})

describe('failure handling', () => {
  it('reports a missing file per-file instead of throwing', () => {
    const [result] = writeTags([join(WORK, 'does-not-exist.mp3')], NEW_TAGS, {
      backupRoot: BACKUPS
    })
    expect(result!.ok).toBe(false)
    expect(result!.error).toBeTruthy()
  })

  /*
   * A batch of twelve where one file is unwritable must write the other eleven
   * and say which failed. Failing the whole batch would leave the user unable to
   * tell how far it got.
   */
  it('writes the good files in a batch and reports only the bad one', async () => {
    const good1 = copyOf('mp3', 'batch-1')
    const good2 = copyOf('flac', 'batch-2')
    const missing = join(WORK, 'gone.mp3')

    const results = writeTags([good1, missing, good2], NEW_TAGS, { backupRoot: BACKUPS })

    expect(results.map((r) => r.ok)).toEqual([true, false, true])
    expect((await parseFile(good1)).common.title).toBe(NEW_TAGS.title)
    expect((await parseFile(good2)).common.title).toBe(NEW_TAGS.title)
  })

  it('reads back a failure rather than throwing', () => {
    const [read] = readTags([join(WORK, 'nope.mp3')])
    expect(read!.ok).toBe(false)
    expect(read!.tags).toBeUndefined()
  })
})
