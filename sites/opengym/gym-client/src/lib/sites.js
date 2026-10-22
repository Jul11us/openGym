// Hosted mode uses the platform's verified identity. Set it before importing any
// store, so another person on the same browser never loads the previous profile.
export const SITES = import.meta.env.VITE_SITES === '1'
export const SITES_SIGNIN = '/signin-with-chatgpt?return_to=%2F'
export const SITES_SIGNOUT = '/signout-with-chatgpt?return_to=%2F'
let identity = null

export function setSitesIdentity(user) {
  if (!user?.id || typeof user.id !== 'string') throw new Error('A verified account is required.')
  if (identity && identity.id !== user.id) throw new Error('Reload to change accounts.')
  identity = Object.freeze({ ...user, admin: false })
}
export const sitesIdentity = () => identity
const prefix = () => {
  if (!identity) throw new Error('Sign in before opening your training data.')
  return 'opengym:sites:' + encodeURIComponent(identity.id) + ':'
}
export const sitesDatabase = name => SITES ? prefix() + name : name
export const sitesHeaders = () => SITES && identity ? { 'X-OpenGym-User': identity.id } : {}
export const storageEventKey = key => !SITES ? key : (typeof key === 'string' && key.startsWith(prefix()) ? key.slice(prefix().length) : null)

export function scopedStorage(storage, scope) {
  const name = key => scope() + String(key)
  const keys = () => Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter(k => k?.startsWith(scope()))
  return {
    getItem: key => storage.getItem(name(key)),
    setItem: (key, value) => storage.setItem(name(key), String(value)),
    removeItem: key => storage.removeItem(name(key)),
    clear: () => { for (const key of keys()) storage.removeItem(key) },
    key: i => { const key = keys()[i]; return key == null ? null : key.slice(scope().length) },
    get length() { return keys().length },
  }
}

// Lazy access preserves the existing behavior in ordinary builds and in browsers
// that refuse persistent storage. The app already catches those storage errors.
export const profileStorage = new Proxy({}, {
  get(_, key) {
    const storage = SITES ? scopedStorage(globalThis.localStorage, prefix) : globalThis.localStorage
    const value = storage[key]
    return typeof value === 'function' ? value.bind(storage) : value
  },
})

export function sitesAuthRequired(message = 'Your session ended. Sign in again to continue.') {
  if (SITES) window.dispatchEvent(new CustomEvent('opengym:auth-required', { detail: message }))
}
