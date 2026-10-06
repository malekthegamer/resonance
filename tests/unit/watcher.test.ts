import { afterEach, beforeEach, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ handlers: new Map<string, (path: string) => void>(), add: vi.fn(), close: vi.fn(async () => undefined) }))
vi.mock('chokidar', () => ({ default: { watch: () => ({
  on(event: string, handler: (path: string) => void) { mocks.handlers.set(event, handler); return this },
  add: mocks.add, close: mocks.close
}) } }))
import { startWatching, stopWatching } from '../../src/main/scan/watcher'
beforeEach(() => { vi.useFakeTimers(); mocks.handlers.clear(); mocks.add.mockClear() })
afterEach(() => { stopWatching(); vi.useRealTimers() })

it('deduplicates changes and retains events arriving while a queued scan waits', async () => {
  let finish!: () => void
  const changed = vi.fn<(_paths: string[]) => Promise<void>>()
    .mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
    .mockResolvedValue(undefined)
  startWatching(['music'], { onChanged: changed })
  mocks.handlers.get('add')!('music/a.mp3')
  mocks.handlers.get('change')!('music/a.mp3')
  await vi.advanceTimersByTimeAsync(1500)
  expect(changed).toHaveBeenCalledWith(['music/a.mp3'])
  mocks.handlers.get('change')!('music/b.flac')
  mocks.handlers.get('change')!('music/b.flac')
  await vi.advanceTimersByTimeAsync(1500)
  expect(changed).toHaveBeenCalledTimes(1)
  finish()
  await vi.advanceTimersByTimeAsync(1500)
  expect(changed).toHaveBeenNthCalledWith(2, ['music/b.flac'])
})

it('queues deletions and follows the last event when a file reappears', async () => {
  const changed = vi.fn(async (_paths: string[]) => undefined)
  startWatching(['music'], { onChanged: changed })
  mocks.handlers.get('add')!('music/deleted.wav')
  mocks.handlers.get('unlink')!('music/deleted.wav')
  mocks.handlers.get('unlink')!('music/restored.wav')
  mocks.handlers.get('add')!('music/restored.wav')
  await vi.advanceTimersByTimeAsync(1500)
  expect(changed).toHaveBeenCalledWith(['music/restored.wav', 'music/deleted.wav'])
})

it('adds newly picked folders immediately without discarding pending paths', async () => {
  const changed = vi.fn(async (_paths: string[]) => undefined)
  startWatching(['first'], { onChanged: changed })
  mocks.handlers.get('add')!('first/song.mp3')
  startWatching(['first', 'second'], { onChanged: changed })
  expect(mocks.add).toHaveBeenCalledWith(['first', 'second'])
  await vi.advanceTimersByTimeAsync(1500)
  expect(changed).toHaveBeenCalledWith(['first/song.mp3'])
})
