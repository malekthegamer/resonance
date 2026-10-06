import { beforeEach, expect, it, vi } from 'vitest'
import type { Track } from '@shared/types'
import { usePlaylists } from '../../src/renderer/src/state/playlists'
const tracks = [1, 2, 1, 3].map((id) => ({ id, title: String(id) }) as Track)
const api = { list: vi.fn(async () => []), tracks: vi.fn(async (_id: number) => tracks), reorder: vi.fn<(id: number, from: number, to: number) => Promise<void>>(async () => undefined) }
beforeEach(() => {
  vi.stubGlobal('window', { resonance: { playlists: api } })
  api.list.mockClear()
  api.tracks.mockReset().mockResolvedValue(tracks)
  api.reorder.mockReset().mockResolvedValue(undefined)
  usePlaylists.setState({ openId: 1, openTracks: tracks, saving: false })
})
it('moves only the grabbed duplicate occurrence and captures the playlist id', async () => {
  let finish!: () => void
  api.reorder.mockImplementationOnce(() => new Promise<void>((resolve) => { finish = resolve }))
  const saving = usePlaylists.getState().reorder(1, 2, 3)
  expect(usePlaylists.getState().openTracks.map((t) => t.id)).toEqual([1, 2, 3, 1])
  expect(usePlaylists.getState().saving).toBe(true)
  await usePlaylists.getState().reorder(1, 0, 1)
  expect(api.reorder).toHaveBeenCalledTimes(1)
  await usePlaylists.getState().open(null)
  finish()
  await saving
  expect(usePlaylists.getState().openId).toBeNull()
  expect(usePlaylists.getState().openTracks).toEqual([])
})
it('reloads authoritative order on persistence failure', async () => {
  api.reorder.mockRejectedValueOnce(new Error('Disk full'))
  await expect(usePlaylists.getState().reorder(1, 0, 3)).rejects.toThrow('Disk full')
  expect(usePlaylists.getState().openTracks).toEqual(tracks)
  expect(usePlaylists.getState().saving).toBe(false)
  expect(api.tracks).toHaveBeenCalledWith(1)
})
it('cannot reopen a playlist after navigation while its tracks are loading', async () => {
  let finish!: (tracks: Track[]) => void
  api.tracks.mockImplementationOnce(() => new Promise<Track[]>((resolve) => { finish = resolve }))
  const opening = usePlaylists.getState().open(7)
  await usePlaylists.getState().open(null)
  finish(tracks)
  await opening
  expect(usePlaylists.getState().openId).toBeNull()
})
