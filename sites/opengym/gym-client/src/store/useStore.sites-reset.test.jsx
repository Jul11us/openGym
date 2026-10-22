// @vitest-environment happy-dom
import { beforeEach, afterEach, expect, it, vi } from 'vitest'

vi.mock('../lib/api.js', () => ({ api: vi.fn(), setRemoteAuth: vi.fn() }))
vi.mock('./useUI.js', () => ({ useUI: { getState: () => ({ toast: vi.fn() }) } }))
vi.mock('../lib/sites.js', async importActual => ({ ...await importActual(), SITES: true, profileStorage: globalThis.localStorage }))
import { api } from '../lib/api.js'
import { DEF, useStore } from './useStore.js'

beforeEach(() => {
  localStorage.clear()
  api.mockReset()
  useStore.setState({ S: { ...structuredClone(DEF), resetAt: 1000, _ts: 1000 }, user: { id: 'u1' }, ready: true, sync: { status: 'ok', pending: false } })
})
afterEach(() => { useStore.setState({ user: null, ready: false }); localStorage.clear() })

it('resumes locked cleanup from the server marker after reload without a PUT', async () => {
  api.mockResolvedValueOnce({ rev: 9, wid: 'reset-write' })
  api.mockResolvedValueOnce({ removed: 2 })
  api.mockResolvedValueOnce({ media_cleanup_pending: false, media: {} })
  await expect(useStore.getState().resumeMediaCleanup()).resolves.toEqual({ removed: 2 })
  expect(api.mock.calls.map(([path]) => path)).toEqual(['/api/data/rev', '/api/media/sweep', '/api/config'])
  expect(JSON.parse(api.mock.calls[1][1].body)).toEqual({ purge: true, baseRev: 9, baseWid: 'reset-write' })
  expect(api.mock.calls.some(([, options]) => options?.method === 'PUT')).toBe(false)
})

it('purges recent reset media only against the exact committed reset revision and write id', async () => {
  api.mockResolvedValueOnce({ ok: true, rev: 9, wid: 'reset-write' })
  api.mockResolvedValueOnce({ removed: 2 })
  await expect(useStore.getState().purgeResetMedia()).resolves.toEqual({ removed: 2 })
  expect(api.mock.calls[0][0]).toBe('/api/data')
  expect(api.mock.calls[0][1].method).toBe('PUT')
  expect(api.mock.calls[1][0]).toBe('/api/media/sweep')
  expect(JSON.parse(api.mock.calls[1][1].body)).toEqual({ purge: true, baseRev: 9, baseWid: 'reset-write' })
})

it('does not purge cloud files when the reset could not sync', async () => {
  api.mockRejectedValueOnce(new Error('offline'))
  await expect(useStore.getState().purgeResetMedia()).rejects.toThrow('not finished syncing')
  expect(api.mock.calls.some(([path]) => path === '/api/media/sweep')).toBe(false)
})

it('surfaces a concurrent-write refusal without retrying the destructive request', async () => {
  api.mockResolvedValueOnce({ ok: true, rev: 9, wid: 'reset-write' })
  api.mockRejectedValueOnce(Object.assign(new Error('Profile changed. Reset again before deleting cloud photos.'), { status: 409 }))
  await expect(useStore.getState().purgeResetMedia()).rejects.toMatchObject({ status: 409 })
  expect(api.mock.calls.filter(([path]) => path === '/api/media/sweep')).toHaveLength(1)
})

it('refuses ordinary profiles and a reset state that already contains new media', async () => {
  useStore.setState({ S: { ...structuredClone(DEF), _ts: 10 } })
  await expect(useStore.getState().purgeResetMedia()).rejects.toThrow('Reset your training data')
  useStore.setState({ S: { ...structuredClone(DEF), resetAt: 1000, _ts: 1000, customEx: [{ id: 'c1', media: { hash: 'a'.repeat(64), kind: 'image', mime: 'image/jpeg', size: 20, width: 10, height: 10 } }] } })
  await expect(useStore.getState().purgeResetMedia()).rejects.toThrow('Reset your training data')
  expect(api).not.toHaveBeenCalled()
})
