import { useEffect, useMemo, useState } from 'react'
import './pushSettings.css'
import { useI18n } from '../lib/i18n'
import { dismissPrompt, enablePush, promptDismissed, pushSupport, resyncPush } from '../lib/push'
import Icon from './ui/Icon'

/**
 * On every open for the owner, managers and JBM: a phone that already allowed notifications is saved on the
 * server again quietly. One that was never asked gets a small card with "Turn on" (the browser needs a tap);
 * on an iPhone outside the home-screen app it explains "Share → Add to Home Screen" instead.
 */
export default function PushPrompt() {
  const { t, lang } = useI18n()
  const sup = useMemo(() => pushSupport(), [])
  const [state, setState] = useState('idle')
  const [hidden, setHidden] = useState(() => promptDismissed())

  useEffect(() => { resyncPush(lang) }, [lang])

  if (hidden || state === 'on') return null
  const iosOutside = sup.reason === 'ios_home'
  if (!iosOutside && (!sup.ok || sup.permission !== 'default')) return null

  async function turnOn() {
    setState('busy')
    try {
      await enablePush({ lang })
      setState('on')
    } catch (e) {
      setState(e.message === 'denied' ? 'denied' : 'error')
    }
  }
  const close = () => { dismissPrompt(); setHidden(true) }

  return (
    <div className="ui-card push-prompt" role="region" aria-label={t('push.title')}>
      <Icon name="bell" size={18} />
      <div className="push-prompt-text">
        <strong>{t('push.promptTitle')}</strong>
        <span>{iosOutside ? t('push.iosHome') : state === 'denied' ? t('push.denied') : state === 'error' ? t('push.notSaved') : t('push.promptLead')}</span>
      </div>
      {!iosOutside && (
        <button type="button" className="ui-btn is-primary is-sm" disabled={state === 'busy'} onClick={turnOn}>
          {state === 'busy' ? t('common.saving') : t('push.promptGo')}
        </button>
      )}
      <button type="button" className="ui-btn is-ghost is-sm" onClick={close} aria-label={t('push.promptLater')}>{t('push.promptLater')}</button>
    </div>
  )
}
