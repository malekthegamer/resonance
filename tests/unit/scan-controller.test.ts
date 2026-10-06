import { beforeEach, expect, it, vi } from 'vitest'
import type { ScanProgress } from '@shared/types'
import { mkdtempSync, writeFileSync, unlinkSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const mocks = vi.hoisted(() => ({
  workers: [] as Array<{ emit(event: string, ...args: unknown[]): boolean; terminate(): Promise<number> }>,
  changed: vi.fn(), removed: vi.fn(() => 0), write: vi.fn(() => ({ inserted: 1, updated: 0 }))
}))
vi.mock('electron', () => ({ app: { getPath: () => 'test-userdata' } }))
vi.mock('../../src/main/libraryEvents', () => ({ libraryChanged: mocks.changed }))
vi.mock('../../src/main/db/open', () => ({ getDb: () => ({}) }))
vi.mock('../../src/main/db/tracks', () => ({ getKnownMtimes: () => ({}), markUnavailable: mocks.removed, upsertTracks: mocks.write }))
vi.mock('node:worker_threads', async () => {
  const { EventEmitter } = await import('node:events')
  return { Worker: class extends EventEmitter {
    constructor() { super(); mocks.workers.push(this) }
    terminate(): Promise<number> { this.emit('exit', 1); return Promise.resolve(1) }
  } }
})
import { scanFolders, cancelScan, isScanning } from '../../src/main/scan/controller'
beforeEach(async () => {
  await vi.waitFor(() => expect(isScanning()).toBe(false))
  mocks.workers.length = 0
  mocks.changed.mockClear()
  mocks.removed.mockClear()
  mocks.write.mockReset().mockReturnValue({ inserted: 1, updated: 0 })
})
it('cancels once, retains committed batches, ignores late messages and drains queued work', async () => {
  const progress: ScanProgress[] = []
  const first = scanFolders([], { onProgress: (p) => progress.push(p) })
  const next = scanFolders([], { onProgress: () => undefined })
  await vi.waitFor(() => expect(mocks.workers).toHaveLength(1))
  mocks.workers[0]!.emit('message', { type: 'batch', tracks: [{}] })
  cancelScan()
  const result = await first
  expect(result.phase).toBe('cancelled')
  expect(result.inserted).toBe(1)
  mocks.workers[0]!.emit('message', { type: 'batch', tracks: [{}] })
  mocks.workers[0]!.emit('message', { type: 'done', processed: 99 })
  expect(mocks.write).toHaveBeenCalledTimes(1)
  expect(progress.filter((p) => p.phase === 'cancelled')).toHaveLength(1)
  expect(mocks.changed).toHaveBeenCalledTimes(1)
  await vi.waitFor(() => expect(mocks.workers).toHaveLength(2))
  mocks.workers[1]!.emit('message', { type: 'done', processed: 0 })
  expect((await next).phase).toBe('done')
})
it('rejects worker failure while allowing the next request to complete', async () => {
  const first = scanFolders([], { onProgress: () => undefined })
  const rejected = expect(first).rejects.toThrow('Worker broke')
  const next = scanFolders([], { onProgress: () => undefined })
  await vi.waitFor(() => expect(mocks.workers).toHaveLength(1))
  mocks.workers[0]!.emit('error', new Error('Worker broke'))
  await rejected
  await vi.waitFor(() => expect(mocks.workers).toHaveLength(2))
  mocks.workers[1]!.emit('message', { type: 'done', processed: 0 })
  expect((await next).phase).toBe('done')
})
it('settles a database write failure rather than leaving the scanner busy forever', async () => {
  mocks.write.mockImplementationOnce(() => { throw new Error('Database full') })
  const first = scanFolders([], { onProgress: () => undefined })
  const rejected = expect(first).rejects.toThrow('Database full')
  await vi.waitFor(() => expect(mocks.workers).toHaveLength(1))
  mocks.workers[0]!.emit('message', { type: 'batch', tracks: [{}] })
  await rejected
  await vi.waitFor(() => expect(isScanning()).toBe(false))
})

it('checks a queued file for deletion when its scan begins', async () => {
  const root = mkdtempSync(join(tmpdir(), 'resonance-scan-'))
  const path = join(root, 'song.wav')
  writeFileSync(path, 'disposable')
  try {
    const first = scanFolders([], { onProgress: () => undefined })
    const next = scanFolders([path, path], { onProgress: () => undefined })
    await vi.waitFor(() => expect(mocks.workers).toHaveLength(1))
    unlinkSync(path)
    mocks.workers[0]!.emit('message', { type: 'done', processed: 0 })
    await first
    await vi.waitFor(() => expect(mocks.workers).toHaveLength(2))
    expect(mocks.removed).toHaveBeenLastCalledWith({}, [path])
    mocks.workers[1]!.emit('message', { type: 'done', processed: 0 })
    await next
  } finally { rmSync(root, { recursive: true, force: true }) }
})
