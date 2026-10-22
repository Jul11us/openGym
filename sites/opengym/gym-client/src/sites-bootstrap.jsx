import { StrictMode, useEffect, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { setSitesIdentity, SITES_SIGNIN, SITES_SIGNOUT } from './lib/sites.js'
import './index.css'

function Access({ message, denied = false, retry }) {
  return <main className="narrow" style={{ minHeight: '88vh', display: 'flex', flexDirection: 'column', justifyContent: 'center', textAlign: 'center', gap: 16 }}>
    <div style={{ color: 'var(--acc)', fontSize: 44, fontWeight: 800 }}>openGym</div>
    <h1 style={{ fontSize: 26, margin: 0 }}>Your training, in one place.</h1>
    <p className="muted" style={{ lineHeight: 1.6, margin: 0 }}>{message}</p>
    <a className="btn primary" href={SITES_SIGNIN} target="_top">Sign in with ChatGPT</a>
    {retry && <button className="btn" onClick={retry}>Try again</button>}
    {denied && <a className="dim" href={SITES_SIGNOUT} target="_top">Use another account</a>}
    <p className="dim small">Access is managed by this site's owner. Each account has its own plan, workouts and body weight.</p>
  </main>
}

function HostedApp({ App }) {
  const [expired, setExpired] = useState(null)
  useEffect(() => {
    const handle = event => setExpired(event.detail || 'Sign in again to continue.')
    window.addEventListener('opengym:auth-required', handle)
    return () => window.removeEventListener('opengym:auth-required', handle)
  }, [])
  return expired ? <Access message={expired} denied /> : <App />
}

const root = createRoot(document.getElementById('root'))
// Going Back after signing out must authenticate again before displaying data.
window.addEventListener('pageshow', event => { if (event.persisted) location.reload() })
async function boot() {
  root.render(<main className="narrow" style={{ paddingTop: '40vh', textAlign: 'center' }}><h1>openGym</h1><p className="muted" role="status">Opening your training space…</p></main>)
  try {
    const response = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(20000) })
    if (response.status === 401 || response.status === 403) {
      root.render(<Access message={response.status === 403 ? 'This account does not have access to this site. Ask the owner to invite you.' : 'Sign in with your invited ChatGPT account to open your personal training space.'} denied={response.status === 403} />)
      return
    }
    if (!response.ok) throw new Error('The site could not open your account. Please try again.')
    const { user } = await response.json()
    setSitesIdentity(user)
    // The import is deliberately after authentication and storage scoping.
    const { mountApp } = await import('./mount-app.jsx')
    await mountApp(root, App => <StrictMode><HostedApp App={App} /></StrictMode>)
  } catch (error) {
    root.render(<Access message={error.message || 'The site could not connect. Please try again.'} retry={boot} />)
  }
}
boot()
