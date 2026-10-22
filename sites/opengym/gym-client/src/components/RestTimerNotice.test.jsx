// @vitest-environment happy-dom
import React, { StrictMode, act } from 'react'
import { createRoot } from 'react-dom/client'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('../lib/sound.js', () => ({ beep: vi.fn(), chime: vi.fn(), vibrate: vi.fn(), alertBuzz: vi.fn() }))
globalThis.IS_REACT_ACT_ENVIRONMENT = true

let host, root, RestTimer, useUI, useStore, sites, preference
beforeEach(async () => {
  vi.resetModules()
  vi.useFakeTimers()
  vi.stubEnv('VITE_SITES', '1')
  localStorage.clear()
  sites = await import('../lib/sites.js')
  sites.setSitesIdentity({ id: 'alice', name: 'Alice' })
  preference = await import('../lib/rest-timer-notice.js')
  ;({ default: RestTimer } = await import('./RestTimer.jsx'))
  ;({ useUI } = await import('../store/useUI.js'))
  ;({ useStore } = await import('../store/useStore.js'))
  useStore.setState({ S: { ...useStore.getState().S, sound: false }, user: null })
  useUI.setState({ timer: null, work: null })
  host = document.createElement('div')
  document.body.appendChild(host)
  root = createRoot(host)
})
afterEach(() => {
  act(() => root.unmount())
  useUI.getState().stopRest()
  useUI.getState().stopWork()
  host.remove()
  vi.restoreAllMocks()
  vi.unstubAllEnvs()
  vi.useRealTimers()
})
const mount = () => act(() => root.render(<StrictMode><RestTimer /></StrictMode>))
const notice = () => host.querySelector('.rest-notice')
const start = sec => act(() => useUI.getState().startRest(sec))

describe('Sites first-rest notice', () => {
  it('does not appear on app load, a timed exercise, a side-switch pause, or an already completed rest', () => {
    mount()
    expect(notice()).toBeNull()
    act(() => useUI.getState().startWork(30, 'Hold', vi.fn()))
    expect(notice()).toBeNull()
    act(() => useUI.getState().startRest(10, 0, { kind: 'switch' }))
    expect(notice()).toBeNull()
    act(() => useUI.setState({ work: null, timer: { left: 0, total: 30, ready: true } }))
    expect(notice()).toBeNull()
    expect(localStorage.getItem('opengym:sites:alice:' + preference.REST_NOTICE_KEY)).toBeNull()
  })

  it('shows one readable notice for a real rest across ticks, pause, Ready and StrictMode remounts until acknowledged', () => {
    mount()
    start(30)
    const first = notice()
    expect(first?.textContent).toContain('Keep this page open')
    expect(host.querySelectorAll('.rest-notice')).toHaveLength(1)
    act(() => vi.advanceTimersByTime(5000))
    expect(notice()).toBe(first)
    expect(host.querySelector('#timer .t').textContent).toBe('0:25')
    act(() => host.querySelector('#timer .pause').click())
    expect(notice()).toBe(first)
    act(() => root.render(null))
    mount()
    expect(notice()).not.toBeNull()
    expect(preference.restNoticePreference.acknowledged()).toBe(false)
    act(() => host.querySelector('#timer .pause').click())
    act(() => vi.advanceTimersByTime(25000))
    expect(host.querySelector('#timer .t').textContent).toBe('Ready')
    expect(notice()).not.toBeNull()
  })

  it('marks only an explicit acknowledgement and stays quiet for the next rest and a fresh preference reader', () => {
    mount()
    start(30)
    expect(preference.restNoticePreference.acknowledged()).toBe(false)
    act(() => notice().querySelector('button').click())
    expect(notice()).toBeNull()
    expect(localStorage.getItem('opengym:sites:alice:' + preference.REST_NOTICE_KEY)).toBe('1')
    act(() => useUI.getState().stopRest())
    start(45)
    expect(notice()).toBeNull()
    expect(preference.createRestNoticePreference(sites.profileStorage).acknowledged()).toBe(true)
  })

  it('keeps acknowledgement separate for another account using this browser', async () => {
    preference.restNoticePreference.acknowledge()
    vi.resetModules() // A different account starts a new authenticated page.
    const nextSites = await import('../lib/sites.js')
    nextSites.setSitesIdentity({ id: 'bob', name: 'Bob' })
    const next = await import('../lib/rest-timer-notice.js')
    expect(next.restNoticePreference.acknowledged()).toBe(false)
    next.restNoticePreference.acknowledge()
    expect(localStorage.getItem('opengym:sites:alice:' + preference.REST_NOTICE_KEY)).toBe('1')
    expect(localStorage.getItem('opengym:sites:bob:' + preference.REST_NOTICE_KEY)).toBe('1')
  })

  it('reserves the expanded dock height, remeasures resizing, and leaves all timer actions usable', () => {
    let top = 600
    let resized
    vi.stubGlobal('ResizeObserver', class { constructor(callback) { resized = callback } observe() {} disconnect() {} })
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockImplementation(function () {
      return { x: 0, y: top, top, bottom: top + 180, left: 0, right: 320, width: 320, height: this.id === 'timer' ? 180 : 0, toJSON() {} }
    })
    mount()
    start(30)
    expect(document.body.classList.contains('has-rest-notice')).toBe(true)
    expect(document.body.style.getPropertyValue('--rest-notice-bottom-space')).toBe(Math.ceil(window.innerHeight - top + 12) + 'px')
    top = 550
    act(() => resized())
    expect(document.body.style.getPropertyValue('--rest-notice-bottom-space')).toBe(Math.ceil(window.innerHeight - top + 12) + 'px')
    expect(host.querySelectorAll('#timer .acts > button')).toHaveLength(4)
    act(() => host.querySelectorAll('#timer .adj')[1].click())
    expect(useUI.getState().timer.left).toBe(45)
    act(() => notice().querySelector('button').click())
    expect(document.body.classList.contains('has-rest-notice')).toBe(false)
    expect(document.body.style.getPropertyValue('--rest-notice-bottom-space')).toBe('')
    act(() => host.querySelector('#timer .skip').click())
    expect(useUI.getState().timer).toBeNull()
    vi.unstubAllGlobals()
  })

  it('leaves the ordinary self-hosted/native flavor unchanged', async () => {
    vi.stubEnv('VITE_SITES', '')
    vi.resetModules()
    const { default: OrdinaryNotice } = await import('./RestTimerNotice.jsx')
    act(() => root.render(<OrdinaryNotice timer={{ left: 30, total: 30 }} />))
    expect(notice()).toBeNull()
    expect(document.body.classList.contains('has-rest-notice')).toBe(false)
  })
})
