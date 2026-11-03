import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { loadBarTeam, peekBarTeam } from '../lib/barTeam'
import { addDays } from '../lib/barClose'
import { closeAlert } from '../lib/autoClose'
import { tokyoDateKey } from '../lib/tokyo'
import { useI18n } from '../lib/i18n'

const SNOOZE_MIN = 15

function readStore(key) {
  try { return window.localStorage.getItem(key) } catch { return null }
}

function writeStore(key, value) {
  try { window.localStorage.setItem(key, value) } catch { /* private window: the banner just comes back */ }
}

/** One short beep so a busy bar hears the reminder; browsers that block audio stay silent. */
function beep() {
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext
    if (!Ctx) return
    const ctx = new Ctx()
    const osc = ctx.createOscillator()
    const gain = ctx.createGain()
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.15, ctx.currentTime)
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.6)
    osc.connect(gain).connect(ctx.destination)
    osc.start()
    osc.stop(ctx.currentTime + 0.6)
    osc.onended = () => ctx.close()
  } catch { /* no audio */ }
}

/**
 * Reminder to close the night, set by the owner in Close → Automatic close:
 * a warning before the close time and, in alert mode, a banner until the night is closed.
 */
export default function CloseAlert({ bar, onClose }) {
  const { t } = useI18n()
  const [alert, setAlert] = useState(null)
  const [tick, setTick] = useState(0)

  useEffect(() => {
    if (!bar?.id) return undefined
    let cancelled = false
    async function check() {
      try {
        const team = peekBarTeam() && !tick ? peekBarTeam() : await loadBarTeam()
        const goals = team?.goals || {}
        const quick = closeAlert(goals)
        if (!quick) { if (!cancelled) setAlert(null); return }
        const shifts = await supabase.from('pos_shifts').select('night_key,status')
          .eq('bar_id', bar.id).gte('night_key', addDays(tokyoDateKey(), -2))
        const closedKeys = new Set((shifts.data || []).filter(s => s.status === 'closed' || s.status === 'counting').map(s => s.night_key))
        const next = closeAlert(goals, new Date(), closedKeys)
        if (cancelled) return
        setAlert(next)
        if (next) {
          const seenKey = `jbm.closeAlert.seen.${bar.id}.${next.key}.${next.kind}`
          if (!readStore(seenKey)) {
            writeStore(seenKey, '1')
            beep()
            if (typeof Notification !== 'undefined' && Notification.permission === 'granted') {
              try { new Notification(t(`portal.close.alert.${next.kind}Title`), { body: t('portal.close.alert.at', { time: next.time }), tag: seenKey }) } catch { /* ignore */ }
            }
          }
        }
      } catch {
        // A failed check keeps whatever was shown; the next minute tries again.
      }
    }
    check()
    const timer = setInterval(() => setTick(n => n + 1), 30_000)
    return () => { cancelled = true; clearInterval(timer) }
  }, [bar?.id, tick, t])

  if (!alert) return null
  const snoozeKey = `jbm.closeAlert.snooze.${bar.id}.${alert.key}.${alert.kind}`
  const snoozedUntil = +readStore(snoozeKey) || 0
  if (snoozedUntil > Date.now()) return null

  const canNotify = typeof Notification !== 'undefined' && Notification.permission === 'default'
  const text = alert.kind === 'soon'
    ? t(alert.mode === 'auto' ? 'portal.close.alert.soonAuto' : 'portal.close.alert.soon', { time: alert.time, min: alert.left })
    : alert.late > 0
      ? t('portal.close.alert.late', { time: alert.time, min: alert.late })
      : t('portal.close.alert.at', { time: alert.time })

  return (
    <div className={`close-alert is-${alert.kind}`} role="alert">
      <div className="close-alert-text">
        <strong>{t(`portal.close.alert.${alert.kind}Title`)}</strong>
        <span>{text}</span>
      </div>
      <div className="close-alert-actions">
        {onClose && alert.mode === 'alerta' && (
          <button type="button" className="ui-btn is-sm is-primary" onClick={onClose}>{t('portal.close.alert.go')}</button>
        )}
        {canNotify && (
          <button type="button" className="ui-btn is-sm" onClick={() => Notification.requestPermission().then(() => setTick(n => n + 1))}>
            {t('portal.close.alert.notify')}
          </button>
        )}
        <button
          type="button"
          className="ui-btn is-sm"
          onClick={() => { writeStore(snoozeKey, String(Date.now() + SNOOZE_MIN * 60_000)); setTick(n => n + 1) }}
        >
          {t('portal.close.alert.snooze', { min: SNOOZE_MIN })}
        </button>
      </div>
    </div>
  )
}
