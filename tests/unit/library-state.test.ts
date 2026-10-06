import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { useLibrary } from '../../src/renderer/src/state/library'
const search = vi.fn(async (query: string) => [{ id: 1, title: query }])
beforeEach(() => {
  vi.useFakeTimers()
  vi.stubGlobal('window', { resonance: { library: { search } } })
  search.mockClear()
  useLibrary.getState().setView('songs')
})
afterEach(() => { useLibrary.getState().setView('songs'); vi.useRealTimers(); vi.unstubAllGlobals() })
it('settles superseded search delays so library refreshes cannot hang', async () => {
  const first = useLibrary.getState().setQuery('first')
  const second = useLibrary.getState().setQuery('second')
  await first
  await vi.advanceTimersByTimeAsync(120)
  await second
  expect(search).toHaveBeenCalledExactlyOnceWith('second')
  expect(useLibrary.getState().searchResults?.[0]?.title).toBe('second')
})
it('navigation cancels delayed search and prevents stale results from returning', async () => {
  const pending = useLibrary.getState().setQuery('old')
  useLibrary.getState().setView('albums')
  await pending
  await vi.advanceTimersByTimeAsync(120)
  expect(search).not.toHaveBeenCalled()
  expect(useLibrary.getState().searchResults).toBeNull()
})
