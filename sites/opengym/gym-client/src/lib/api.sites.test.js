// @vitest-environment happy-dom
import { afterEach, expect, it, vi } from 'vitest'

afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); vi.resetModules() })

it('binds data requests to the verified identity and hides the app if the platform account changes', async () => {
  vi.stubEnv('VITE_SITES', '1')
  vi.resetModules()
  const { setSitesIdentity } = await import('./sites.js')
  setSitesIdentity({ id: 'alice', name: 'Alice' })
  const fetch = vi.fn(async () => new Response(JSON.stringify({ error: 'Your signed-in account changed. Reload to continue.', code: 'account-changed' }), { status: 401, headers: { 'Content-Type': 'application/json' } }))
  vi.stubGlobal('fetch', fetch)
  const { api, beacon, webauthnOK } = await import('./api.js')
  const expired = vi.fn()
  window.addEventListener('opengym:auth-required', expired)
  await expect(api('/api/data', { method: 'PUT', body: JSON.stringify({ state: { workouts: [] } }) })).rejects.toMatchObject({ status: 401 })
  expect(fetch.mock.calls[0][1].headers['X-OpenGym-User']).toBe('alice')
  expect(expired).toHaveBeenCalledOnce()
  expect(expired.mock.calls[0][0].detail).toContain('account changed')
  expect(webauthnOK()).toBe(false)
  expect(beacon('/api/activity', { active: false })).toBe(false)
  window.removeEventListener('opengym:auth-required', expired)
})
