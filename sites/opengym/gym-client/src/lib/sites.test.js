// @vitest-environment happy-dom
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest'

beforeEach(() => { vi.resetModules(); localStorage.clear(); vi.stubEnv('VITE_SITES', '1') })
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals() })

describe('hosted account data isolation', () => {
  it('does not read legacy or another account’s state and clears only its own keys', async () => {
    const { scopedStorage } = await import('./sites.js')
    localStorage.setItem('gym_state_v1', 'legacy workout')
    const alice = scopedStorage(localStorage, () => 'account:alice:')
    const bob = scopedStorage(localStorage, () => 'account:bob:')
    alice.setItem('gym_state_v1', 'Alice workout')
    alice.setItem('gym_rest', 'Alice timer')
    expect(bob.getItem('gym_state_v1')).toBeNull()
    expect(bob.getItem('gym_rest')).toBeNull()
    bob.setItem('gym_state_v1', 'Bob workout')
    expect(alice.getItem('gym_state_v1')).toBe('Alice workout')
    expect(alice.length).toBe(2)
    alice.clear()
    expect(bob.getItem('gym_state_v1')).toBe('Bob workout')
    expect(localStorage.getItem('gym_state_v1')).toBe('legacy workout')
  })

  it('requires verified identity before storage access and scopes media and cross-tab events', async () => {
    const { profileStorage, setSitesIdentity, sitesDatabase, sitesHeaders, storageEventKey } = await import('./sites.js')
    expect(() => profileStorage.getItem('gym_state_v1')).toThrow('Sign in')
    expect(() => sitesDatabase('opengym-media')).toThrow('Sign in')
    setSitesIdentity({ id: 'alice/123', name: 'Alice', admin: true })
    profileStorage.setItem('gym_state_v1', 'Alice workout')
    expect(localStorage.getItem('gym_state_v1')).toBeNull()
    expect(localStorage.getItem('opengym:sites:alice%2F123:gym_state_v1')).toBe('Alice workout')
    expect(sitesDatabase('opengym-media')).toBe('opengym:sites:alice%2F123:opengym-media')
    expect(sitesHeaders()).toEqual({ 'X-OpenGym-User': 'alice/123' })
    expect(storageEventKey('opengym:sites:alice%2F123:gym_state_v1')).toBe('gym_state_v1')
    expect(storageEventKey('opengym:sites:bob:gym_state_v1')).toBeNull()
    expect(() => setSitesIdentity({ id: 'bob' })).toThrow('Reload')
  })

  it('keeps the normal self-hosted storage contract outside hosted mode', async () => {
    vi.stubEnv('VITE_SITES', '')
    const { profileStorage, sitesDatabase, storageEventKey } = await import('./sites.js')
    profileStorage.setItem('gym_state_v1', 'normal workout')
    expect(localStorage.getItem('gym_state_v1')).toBe('normal workout')
    expect(sitesDatabase('opengym-media')).toBe('opengym-media')
    expect(storageEventKey('gym_owner')).toBe('gym_owner')
  })
})
