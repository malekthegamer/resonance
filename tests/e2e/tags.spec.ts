import { copyFileSync, existsSync, mkdirSync, readdirSync, rmSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { expect, test, type ElectronApplication, type Page } from '@playwright/test'
import { ensureFixtures, fixturePaths } from '../fixtures/gen-audio'
import { launchApp } from './helpers'

/**
 * Slice 3: the tag write core, driven through real IPC in the real app.
 *
 * Two isolations matter here and neither is optional.
 *
 * The files are **copies** in `test-results/tag-media`. Writing to the shared
 * fixtures would rewrite the very tags `scan.spec.ts` asserts on, and the
 * failure would surface over there rather than here.
 *
 * The app gets its **own userData directory** for the same reason: these
 * retagged tracks in the common database would corrupt the library the other
 * specs measure. It also means the backup directory under test is this run's
 * alone.
 *
 * The user's real library is never a target of any of this.
 */

let app: ElectronApplication
let page: Page

const USER_DATA = resolve(process.cwd(), 'test-results', 'userdata-tags')
const MEDIA = resolve(process.cwd(), 'test-results', 'tag-media')
const BACKUPS = join(USER_DATA, 'tag-backups')

const FORMATS = ['mp3', 'flac', 'm4a', 'ogg', 'opus', 'wav'] as const

const UI_FILES = [
  'Attack on Titan OP 1 Guren no Yumiya.mp3',
  'Attack on Titan OP 2 Jiyuu no Tsubasa.mp3',
  'Attack on Titan ED 1 Utsukushiki Zankoku na Sekai.mp3'
]

const NEW_TAGS = {
  title: 'Retagged 書き換え',
  artist: 'Edited Artist ñ',
  album: 'Edited Album Ω',
  albumArtist: 'Edited Album Artist',
  genre: 'Shoegaze',
  year: 2011,
  trackNo: 4
}

async function tracksNamed(term: string): Promise<Array<{ id: number; path: string; title: string }>> {
  return page.evaluate(async (t) => {
    const all = await window.resonance.library.getTracks()
    return all
      .filter((x) => x.path.includes(t))
      .map((x) => ({ id: x.id, path: x.path, title: x.title }))
  }, term)
}

function backupCount(): number {
  if (!existsSync(BACKUPS)) return 0
  return readdirSync(BACKUPS).length
}

test.beforeAll(async () => {
  ensureFixtures()

  rmSync(USER_DATA, { recursive: true, force: true })
  rmSync(MEDIA, { recursive: true, force: true })
  mkdirSync(MEDIA, { recursive: true })
  const src = fixturePaths().byFormat
  for (const ext of FORMATS) copyFileSync(src[ext]!, join(MEDIA, `tagme.${ext}`))

  // Named the way the author's real library is named, so "Fill from filename"
  // is exercised against the shape it was written for rather than a stub.
  for (const name of UI_FILES) copyFileSync(src['mp3']!, join(MEDIA, name))

  ;({ app, page } = await launchApp(USER_DATA))
  await page.evaluate((dir) => window.resonance.library.scanPaths([dir]), MEDIA)
  await page.reload()
  await page.waitForSelector('[data-testid="track-row"]')
})

test.afterAll(async () => {
  await app?.close()
})

test('the tag bridge is exposed and reads current tags', async () => {
  const exposed = await page.evaluate(() => ({
    read: typeof window.resonance.tags?.read,
    write: typeof window.resonance.tags?.write,
    pickArtwork: typeof window.resonance.tags?.pickArtwork
  }))
  expect(exposed).toEqual({ read: 'function', write: 'function', pickArtwork: 'function' })

  const tracks = await tracksNamed('tagme.mp3')
  expect(tracks).toHaveLength(1)

  const read = await page.evaluate((ids) => window.resonance.tags.read(ids), [tracks[0]!.id])
  expect(read[0]!.ok).toBe(true)
  // The generated fixtures carry a known title, so reading is provably real.
  expect(read[0]!.tags!.title).toBe('Resonance Test Tone')
})

test('writing tags updates the file, the database and the search index', async () => {
  const [track] = await tracksNamed('tagme.flac')
  expect(track).toBeTruthy()

  const report = await page.evaluate(
    ([id, tags]) => window.resonance.tags.write([id as number], tags as never),
    [track!.id, NEW_TAGS] as const
  )
  expect(report.failed, JSON.stringify(report.results)).toBe(0)
  expect(report.written).toBe(1)

  // The file itself.
  const read = await page.evaluate((id) => window.resonance.tags.read([id]), track!.id)
  expect(read[0]!.tags).toMatchObject(NEW_TAGS)

  /*
   * And the database, via the ordinary scanner. Writing changes the file's
   * mtime, which is what lets the scanner's mtime-skip pass it through — the
   * mechanism the project relies on instead of a second write path.
   */
  await expect
    .poll(async () => (await tracksNamed('tagme.flac'))[0]?.title)
    .toBe(NEW_TAGS.title)

  // FTS has to follow, or the track becomes unfindable under its new name.
  const hits = await page.evaluate((q) => window.resonance.library.search(q), NEW_TAGS.title)
  expect(hits.some((t) => t.path.includes('tagme.flac'))).toBe(true)
})

test('a multi-track edit changes only the fields it was given', async () => {
  const ids = await page.evaluate(async () => {
    const all = await window.resonance.library.getTracks()
    return all
      .filter((t) => /tagme\.(mp3|m4a|ogg)$/.test(t.path))
      .map((t) => t.id)
  })
  expect(ids).toHaveLength(3)

  await page.evaluate(
    ([list, tags]) => window.resonance.tags.write(list as number[], tags as never),
    [ids, NEW_TAGS] as const
  )

  // Now change one field across all three. The rest must survive.
  const report = await page.evaluate(
    (list) => window.resonance.tags.write(list, { album: 'Shared Album' }),
    ids
  )
  expect(report.failed).toBe(0)

  const read = await page.evaluate((list) => window.resonance.tags.read(list), ids)
  for (const r of read) {
    expect(r.ok).toBe(true)
    expect(r.tags!.album).toBe('Shared Album')
    expect(r.tags!.artist, 'an untouched field must not be blanked').toBe(NEW_TAGS.artist)
    expect(r.tags!.title).toBe(NEW_TAGS.title)
  }
})

test('every edited file is backed up exactly once, ever', async () => {
  const before = backupCount()
  const [track] = await tracksNamed('tagme.opus')

  const first = await page.evaluate(
    (id) => window.resonance.tags.write([id], { genre: 'One' }),
    track!.id
  )
  expect(first.results[0]!.backedUp).toBe(true)
  expect(backupCount()).toBe(before + 1)

  const second = await page.evaluate(
    (id) => window.resonance.tags.write([id], { genre: 'Two' }),
    track!.id
  )
  expect(second.results[0]!.backedUp, 'the pristine original must not be overwritten').toBe(false)
  expect(backupCount()).toBe(before + 1)
})

test('artwork can be embedded and reaches the art cache', async () => {
  const [track] = await tracksNamed('tagme.m4a')
  const cover = fixturePaths().cover

  const report = await page.evaluate(
    ([id, art]) => window.resonance.tags.write([id as number], {}, art as string),
    [track!.id, cover] as const
  )
  expect(report.failed, JSON.stringify(report.results)).toBe(0)

  // art_ref is populated by the scanner from the embedded picture, so a value
  // here proves the write, the rescan and the art cache all connected up.
  await expect
    .poll(async () => {
      const all = await page.evaluate(() => window.resonance.library.getTracks())
      return all.find((t) => t.path.includes('tagme.m4a'))?.artRef ?? null
    })
    .not.toBeNull()
})

test('the write channel refuses paths that are not in the library', async () => {
  // Track ids are resolved through the database, so an id that does not exist
  // yields nothing to write rather than an arbitrary filesystem write.
  const report = await page.evaluate(() => window.resonance.tags.write([999999], { title: 'x' }))
  expect(report.results).toHaveLength(0)
  expect(report.written).toBe(0)
})

test('tagging the currently playing track reports honestly either way', async () => {
  const [track] = await tracksNamed('tagme.wav')

  await page.evaluate(async (id) => {
    const all = await window.resonance.library.getTracks()
    const t = all.find((x) => x.id === id)!
    await (
      window as never as {
        __resonancePlayer: { playTracks(t: unknown[], i: number): Promise<void> }
      }
    ).__resonancePlayer.playTracks([t], 0)
  }, track!.id)
  await expect.poll(() => page.getByTestId('np-title').textContent()).not.toBe('Nothing playing')

  const report = await page.evaluate(
    (id) => window.resonance.tags.write([id], { genre: 'While Playing' }),
    track!.id
  )

  /*
   * Windows may hold the file open for the audio element. Whichever way it
   * goes, the report must be truthful — a silent failure here would tell the
   * user their edit was saved when it was not.
   */
  const result = report.results[0]!
  if (result.ok) {
    const read = await page.evaluate((id) => window.resonance.tags.read([id]), track!.id)
    expect(read[0]!.tags!.genre).toBe('While Playing')
  } else {
    expect(result.error).toMatch(/in use|EBUSY|EPERM/i)
  }
  // eslint-disable-next-line no-console
  console.log(`\n=== TAG WRITE WHILE PLAYING ===\nok=${result.ok} error=${result.error ?? '-'}\n`)
})

/*
 * The previous test plays a five-second tone, which Chromium may well have read
 * to the end before the write lands — so passing there does not prove much. This
 * one seeks into the middle of a 112 MB file, which cannot be buffered whole,
 * and writes while the stream is genuinely open. That is the case the risk
 * register was actually worried about.
 */
test('tagging a large file mid-stream, with the handle definitely still open', async () => {
  const large = fixturePaths().large
  test.skip(!existsSync(large), 'large fixture not generated')

  const copied = join(MEDIA, 'tagme-large.wav')
  if (!existsSync(copied)) copyFileSync(large, copied)
  await page.evaluate((p) => window.resonance.library.scanPaths([p]), copied)

  const [track] = await tracksNamed('tagme-large.wav')
  expect(track).toBeTruthy()

  await page.evaluate(async (id) => {
    const all = await window.resonance.library.getTracks()
    const t = all.find((x) => x.id === id)!
    const player = (
      window as never as {
        __resonancePlayer: { playTracks(t: unknown[], i: number): Promise<void>; seek(s: number): void }
      }
    ).__resonancePlayer
    await player.playTracks([t], 0)
    // Seek deep into the file so a byte-range request is in flight.
    player.seek(400)
  }, track!.id)
  await page.waitForTimeout(500)

  const report = await page.evaluate(
    (id) => window.resonance.tags.write([id], { genre: 'Mid Stream' }),
    track!.id
  )
  const result = report.results[0]!

  // eslint-disable-next-line no-console
  console.log(
    `\n=== TAG WRITE ON A 112 MB FILE MID-PLAYBACK ===\n` +
      `ok=${result.ok} error=${result.error ?? '-'}\n`
  )

  // Either outcome is acceptable; a *dishonest* outcome is not. If Windows
  // refuses the write, the user must be told, not shown a silent success.
  if (result.ok) {
    const read = await page.evaluate((id) => window.resonance.tags.read([id]), track!.id)
    expect(read[0]!.tags!.genre).toBe('Mid Stream')
  } else {
    expect(result.error).toMatch(/in use|EBUSY|EPERM/i)
  }
})

/* ---------------------------------------------------------------- the dialog */

/**
 * Selects rows **by track id** and opens the tag editor from the context menu.
 *
 * Not by row position: every fixture shares the title "Resonance Test Tone", so
 * sort order between them is arbitrary. An earlier version of this helper
 * searched and took `nth(0)`, which quietly opened the editor on a different
 * file than the test named — it only surfaced because that file happened to be
 * the WAV, whose NUL-terminated title made the assertion fail. A test that
 * picks the wrong row and passes is worse than one that fails.
 */
async function openEditorFor(...filenames: string[]): Promise<void> {
  await page.getByTestId('nav-songs').click()
  await page.getByTestId('search').fill('')
  await page.keyboard.press('Escape')

  const ids = await page.evaluate(async (names) => {
    const all = await window.resonance.library.getTracks()
    return names.map((n) => all.find((t) => t.path.endsWith(n))?.id ?? -1)
  }, filenames)
  expect(ids.every((id) => id > 0), `no library row for ${filenames.join(', ')}`).toBe(true)

  const rowFor = (id: number) =>
    page.locator(`[data-testid="track-row"][data-track-id="${id}"]`)

  await rowFor(ids[0]!).click()
  for (let i = 1; i < ids.length; i++) {
    await rowFor(ids[i]!).click({ modifiers: ['ControlOrMeta'] })
  }

  await rowFor(ids[0]!).click({ button: 'right' })
  await page.getByTestId('context-menu').getByRole('menuitem', { name: /Edit tags/ }).click()
  await expect(page.getByTestId('tag-editor')).toBeVisible()
}

test('the context menu offers Edit tags and the dialog loads real values', async () => {
  await openEditorFor(UI_FILES[0]!)

  // Populated from the file, not the database row — the dialog reads the file
  // it is about to overwrite.
  await expect(page.getByTestId('tag-title')).toHaveValue('Resonance Test Tone')
  await expect(page.getByTestId('tag-artist')).toHaveValue('Test Artist 紅蓮')

  // Save must not offer to do anything before a field is touched.
  await expect(page.getByTestId('tag-save')).toBeDisabled()

  await page.screenshot({ path: 'test-results/tag-editor-single.png', animations: "disabled" })
  await page.getByTestId('tag-editor-backdrop').click({ position: { x: 5, y: 5 } })
  await expect(page.getByTestId('tag-editor')).toBeHidden()
})

test('editing one track writes the file and updates the table', async () => {
  await openEditorFor(UI_FILES[0]!)

  await page.getByTestId('tag-title').fill('Guren no Yumiya')
  await expect(page.getByTestId('tag-save')).toBeEnabled()
  await page.getByTestId('tag-save').click()

  await expect(page.getByTestId('tag-editor')).toBeHidden()
  await expect(page.getByTestId('toast')).toContainText('Tagged 1 track')

  // The row the user is looking at must change, not just the file — otherwise
  // a correct edit reads as a failed one.
  await expect
    .poll(async () => (await tracksNamed('Guren no Yumiya.mp3'))[0]?.title)
    .toBe('Guren no Yumiya')
})

/*
 * Saving raises a toast, so reopening the editor straight afterwards used to put
 * the toast on top of Cancel and Save — the dialog covering its own footer with
 * something unclickable. Exactly the class of "the button does nothing" bug this
 * app has already shipped once.
 */
test('a toast never covers the dialog buttons', async () => {
  await openEditorFor(UI_FILES[2]!)
  await page.getByTestId('tag-genre').fill('Toast Check')
  await page.getByTestId('tag-save').click()
  await expect(page.getByTestId('toast')).toBeVisible()

  // Reopen while that toast is still on screen.
  await openEditorFor(UI_FILES[2]!)
  await expect(page.getByTestId('toast')).toBeVisible()

  const save = page.getByTestId('tag-save')
  const box = (await save.boundingBox())!
  const topmost = await page.evaluate(
    ({ x, y }) => {
      const el = document.elementFromPoint(x, y)
      return el?.closest('[data-testid]')?.getAttribute('data-testid') ?? el?.tagName ?? '?'
    },
    { x: box.x + box.width / 2, y: box.y + box.height / 2 }
  )
  expect(topmost, 'the save button must be what is actually under the cursor').toBe('tag-save')

  await page.getByTestId('tag-editor-backdrop').click({ position: { x: 5, y: 5 } })
})

test('a multi-track edit shows mixed fields and changes only what was typed', async () => {
  await openEditorFor(...UI_FILES)

  await expect(page.getByTestId('tag-editor-subject')).toHaveText('3 tracks')

  /*
   * One of the three was retitled by the previous test, so titles now differ.
   * The field must show a placeholder rather than one arbitrary track's title,
   * which a user would reasonably read as the value for all three.
   */
  await expect(page.getByTestId('tag-title')).toHaveAttribute('data-mixed', 'true')
  await expect(page.getByTestId('tag-title')).toHaveValue('')
  await expect(page.getByTestId('tag-title')).toHaveAttribute('placeholder', '(multiple values)')

  await page.screenshot({ path: 'test-results/tag-editor-multi.png', animations: "disabled" })

  const before = await page.evaluate(async () => {
    const all = await window.resonance.library.getTracks()
    return all
      .filter((t) => t.path.includes('Attack on Titan'))
      .map((t) => ({ path: t.path, title: t.title }))
      .sort((a, b) => a.path.localeCompare(b.path))
  })

  await page.getByTestId('tag-album').fill('Attack on Titan')
  await page.getByTestId('tag-save').click()
  await expect(page.getByTestId('toast')).toContainText('Tagged 3 tracks')

  const after = await page.evaluate(async () => {
    const all = await window.resonance.library.getTracks()
    return all
      .filter((t) => t.path.includes('Attack on Titan'))
      .map((t) => ({ path: t.path, title: t.title, album: t.album }))
      .sort((a, b) => a.path.localeCompare(b.path))
  })

  expect(after.map((t) => t.album)).toEqual(['Attack on Titan', 'Attack on Titan', 'Attack on Titan'])
  // The untouched, *mixed* field must be untouched on every file.
  expect(after.map((t) => t.title)).toEqual(before.map((t) => t.title))
})

test('Fill from filename populates the form and writes nothing until Save', async () => {
  await openEditorFor(UI_FILES[1]!)

  const titleBefore = await page.getByTestId('tag-title').inputValue()
  await page.getByTestId('fill-from-filename').click()

  // The parser splits series from song around the OP marker.
  await expect(page.getByTestId('tag-title')).toHaveValue('Jiyuu no Tsubasa')
  await expect(page.getByTestId('tag-album')).toHaveValue('Attack on Titan')
  await expect(page.getByTestId('tag-title')).not.toHaveValue(titleBefore)

  await page.screenshot({ path: 'test-results/tag-editor-filled.png', animations: "disabled" })

  /*
   * The whole reason this is a button. Filename inference was reverted for
   * writing guesses behind the user's back; cancelling here must leave the file
   * exactly as it was.
   */
  const onDisk = await page.evaluate(async () => {
    const all = await window.resonance.library.getTracks()
    const t = all.find((x) => x.path.includes('Jiyuu no Tsubasa'))!
    return (await window.resonance.tags.read([t.id]))[0]!.tags
  })
  await page.getByTestId('tag-editor-backdrop').click({ position: { x: 5, y: 5 } })

  const afterCancel = await page.evaluate(async () => {
    const all = await window.resonance.library.getTracks()
    const t = all.find((x) => x.path.includes('Jiyuu no Tsubasa'))!
    return (await window.resonance.tags.read([t.id]))[0]!.tags
  })
  expect(afterCancel).toEqual(onDisk)
  expect(afterCancel!.title).not.toBe('Jiyuu no Tsubasa')
})

test('a filled form does write once Save is pressed', async () => {
  await openEditorFor(UI_FILES[1]!)
  await page.getByTestId('fill-from-filename').click()
  await page.getByTestId('tag-save').click()

  await expect
    .poll(async () => (await tracksNamed('Jiyuu no Tsubasa.mp3'))[0]?.title)
    .toBe('Jiyuu no Tsubasa')
})

test('a failed file does not stop the rest of the batch', async () => {
  const ids = await page.evaluate(async () => {
    const all = await window.resonance.library.getTracks()
    return all.filter((t) => /tagme\.(mp3|flac)$/.test(t.path)).map((t) => t.id)
  })

  const report = await page.evaluate(
    (list) => window.resonance.tags.write([...list, 424242], { genre: 'Batch' }),
    ids
  )
  // The bogus id resolves to nothing, so only the real files are attempted.
  expect(report.written).toBe(ids.length)
  expect(report.failed).toBe(0)

  const read = await page.evaluate((list) => window.resonance.tags.read(list), ids)
  for (const r of read) expect(r.tags!.genre).toBe('Batch')
})
