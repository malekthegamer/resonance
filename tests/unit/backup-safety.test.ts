import * as fs from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { backupOnce, backupSlotFor, writeTags } from '../../src/main/tags'
import { ensureFixtures } from '../fixtures/gen-audio'

vi.mock('node:fs', async (original) => {
  const actual = await original<typeof import('node:fs')>()
  return { ...actual, copyFileSync: vi.fn(actual.copyFileSync) }
})
const actual = await vi.importActual<typeof import('node:fs')>('node:fs')
const roots: string[] = []
afterEach(() => {
  vi.mocked(fs.copyFileSync).mockImplementation(actual.copyFileSync)
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})
function setup() {
  const root = fs.mkdtempSync(join(tmpdir(), 'resonance-backup-safety-'))
  roots.push(root)
  const source = join(root, 'song.mp3')
  actual.copyFileSync(ensureFixtures().byFormat.mp3!, source)
  return { root, source, backupRoot: join(root, 'backups') }
}
describe('backup publication', () => {
  it('refuses edits after a partial copy and safely retries the empty slot', () => {
    const { source, backupRoot } = setup()
    const original = fs.readFileSync(source)
    vi.mocked(fs.copyFileSync).mockImplementationOnce((_source, target) => {
      fs.writeFileSync(target, 'partial')
      throw new Error('Disk full')
    })
    expect(writeTags([source], { title: 'Must not write' }, { backupRoot })[0]!.ok).toBe(false)
    expect(fs.readFileSync(source)).toEqual(original)
    const slot = backupSlotFor(backupRoot, source)
    expect(fs.existsSync(slot.file)).toBe(false)
    expect(fs.readdirSync(slot.dir)).toEqual([])
    expect(backupOnce(backupRoot, source)).toBe(true)
    expect(fs.readFileSync(slot.file)).toEqual(original)
  })
  it('detects a silently truncated copy and leaves the original unmodified', () => {
    const { source, backupRoot } = setup()
    const before = fs.readFileSync(source)
    vi.mocked(fs.copyFileSync).mockImplementationOnce((_source, target) => fs.writeFileSync(target, 'partial'))
    expect(writeTags([source], { title: 'No' }, { backupRoot })[0]!.ok).toBe(false)
    expect(fs.readFileSync(source)).toEqual(before)
  })
  it('accepts completed legacy backups without replacing their bytes', () => {
    const { source, backupRoot } = setup()
    const slot = backupSlotFor(backupRoot, source)
    fs.mkdirSync(slot.dir, { recursive: true })
    const original = fs.readFileSync(source)
    fs.writeFileSync(slot.file, original)
    fs.writeFileSync(join(slot.dir, '.pending-old'), 'partial')
    expect(writeTags([source], { title: 'First' }, { backupRoot })[0]!.ok).toBe(true)
    expect(writeTags([source], { title: 'Second' }, { backupRoot })[0]!.backedUp).toBe(false)
    expect(fs.readFileSync(slot.file)).toEqual(original)
  })
  it.each(['empty', 'directory'])('blocks a suspicious %s original rather than overwriting it', (kind) => {
    const { source, backupRoot } = setup()
    const slot = backupSlotFor(backupRoot, source)
    fs.mkdirSync(slot.dir, { recursive: true })
    if (kind === 'empty') fs.writeFileSync(slot.file, '')
    else fs.mkdirSync(slot.file)
    const before = fs.readFileSync(source)
    expect(writeTags([source], { title: 'No' }, { backupRoot })[0]!.error).toContain('suspicious')
    expect(fs.readFileSync(source)).toEqual(before)
  })
})
