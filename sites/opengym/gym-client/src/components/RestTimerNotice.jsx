import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { SITES } from '../lib/sites.js'
import { t } from '../lib/i18n.js'
import { restNoticePreference } from '../lib/rest-timer-notice.js'
import { Button } from './ui.jsx'
import './RestTimerNotice.css'

export default function RestTimerNotice({ timer }) {
  const running = !!timer && timer.kind !== 'switch' && !timer.ready && timer.left > 0 && timer.total > 0
  const [acknowledged, setAcknowledged] = useState(() => !SITES || restNoticePreference.acknowledged())
  const [started, setStarted] = useState(running)
  const noticeRef = useRef(null)
  // A completed timer restored as Ready is not a first rest. Once shown, keep
  // the explanation readable while that real rest pauses or reaches Ready.
  useEffect(() => { if (running) setStarted(true) }, [running])
  const visible = SITES && started && !acknowledged

  useLayoutEffect(() => {
    if (!visible) return
    const dock = noticeRef.current?.closest('#timer')
    if (!dock) return
    const body = document.body
    const measure = () => {
      const rect = dock.getBoundingClientRect()
      if (rect.height > 0) body.style.setProperty('--rest-notice-bottom-space', Math.ceil(window.innerHeight - rect.top + 12) + 'px')
    }
    body.classList.add('has-rest-notice')
    measure()
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(measure) : null
    observer?.observe(dock)
    window.addEventListener('resize', measure)
    return () => {
      observer?.disconnect()
      window.removeEventListener('resize', measure)
      body.classList.remove('has-rest-notice')
      body.style.removeProperty('--rest-notice-bottom-space')
    }
  }, [visible])

  if (!visible) return null
  const acknowledge = () => {
    restNoticePreference.acknowledge()
    setAcknowledged(true)
  }
  return <aside className="rest-notice" ref={noticeRef} role="status" aria-live="polite" aria-label={t('Timer alerts')}>
    <p>{t('This site has no background push notifications. Keep this page open for rest timer sounds and alerts.')}</p>
    <Button size="sm" variant="tinted" onClick={acknowledge}>{t('Got it')}</Button>
  </aside>
}
