import { profileStorage } from './sites.js'

export const REST_NOTICE_KEY = 'gym_sites_rest_notice_v1'

// profileStorage already separates accounts on this browser. Keep the answer in
// memory too when a browser refuses storage, so every later rest stays quiet.
export function createRestNoticePreference(storage) {
  let acknowledgedHere = false
  return {
    acknowledged() {
      if (acknowledgedHere) return true
      try { return storage.getItem(REST_NOTICE_KEY) === '1' } catch { return false }
    },
    acknowledge() {
      acknowledgedHere = true
      try { storage.setItem(REST_NOTICE_KEY, '1') } catch { /* this page still remembers */ }
    },
  }
}

export const restNoticePreference = createRestNoticePreference(profileStorage)
