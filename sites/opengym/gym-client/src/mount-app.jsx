import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import { MOBILE } from './lib/mobile.js'
import { SITES } from './lib/sites.js'
import { useStore } from './store/useStore.js'
import { startMediaSync } from './lib/media-sync.js'
import { startNativeKeyboard } from './lib/native-keyboard.js'
import './index.css'

export function mountApp(root = createRoot(document.getElementById('root')), wrap = App => <StrictMode><App /></StrictMode>) {
  if ('scrollRestoration' in history) history.scrollRestoration = 'manual'
  root.render(wrap(App))
  startMediaSync(useStore)
  startNativeKeyboard()
  // Authenticate before reading account data on Sites; never replay a cached
  // authenticated shell on a shared device.
  if (!SITES && !MOBILE && 'serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {})
    import('./lib/media-prefetch.js').then(m => m.startMediaPrefetch(useStore)).catch(() => {})
  }
}
