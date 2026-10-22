// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

const mountApp = vi.hoisted(() => vi.fn())
vi.mock('./mount-app.jsx', () => ({ mountApp }))

beforeEach(() => {
  vi.resetModules()
  vi.stubEnv('VITE_SITES', '1')
  document.body.innerHTML = '<div id="root"></div>'
  mountApp.mockReset()
  localStorage.clear()
})
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('hosted account bootstrap', () => {
  it('opens no stores or training UI until the platform verifies an account', async () => {
    let resolve
    vi.stubGlobal('fetch', vi.fn(() => new Promise(done => { resolve = done })))
    localStorage.setItem('gym_state_v1', JSON.stringify({ workouts: [{ name: 'Previous account secret' }] }))
    await import('./sites-bootstrap.jsx')
    expect(mountApp).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain('Previous account secret')
    resolve(new Response(JSON.stringify({ user: { id: 'alice', name: 'Alice' } }), { headers: { 'Content-Type': 'application/json' } }))
    await vi.waitFor(() => expect(mountApp).toHaveBeenCalledTimes(1))
    const { sitesIdentity } = await import('./lib/sites.js')
    expect(sitesIdentity()).toEqual({ id: 'alice', name: 'Alice', admin: false })
  })

  it.each([401, 403])('offers a top-level sign-in link on %i without opening cached records', async status => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status })))
    await import('./sites-bootstrap.jsx')
    await vi.waitFor(() => expect(document.querySelector('a[href^="/signin-with-chatgpt"]')).not.toBeNull())
    expect(document.querySelector('a[href^="/signin-with-chatgpt"]').target).toBe('_top')
    expect(mountApp).not.toHaveBeenCalled()
    if (status === 403) expect(document.body.textContent).toContain('does not have access')
  })
})
