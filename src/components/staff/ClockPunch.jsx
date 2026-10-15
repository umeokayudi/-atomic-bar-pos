import { useEffect, useRef, useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { readPosition } from '../../lib/geoClient'
import { JUSTIFICATION_MIN, evaluatePunchGeo, punchGeoFlag } from '../../lib/clockGeo'
import { postClockMark } from '../TimeClock'
import { errText } from '../../lib/errText'
import Icon from '../ui/Icon'

/**
 * Clock in / out with a GPS check. Tap → one GPS reading → if the bar has a location and the phone is
 * outside it (or has no GPS), a sheet asks for a reason before anything is sent. The server checks the same rule.
 *   const punch = useClockPunch({ barId, meId, venue, onDone })
 *   <button onClick={() => punch.start('in')}>…</button>  {punch.sheet}
 */
export function useClockPunch({ barId, meId, venue, onDone }) {
  const { t } = useI18n()
  const [phase, setPhase] = useState('') // '' | 'locating' | 'sending'
  const [err, setErr] = useState('')
  const [ask, setAsk] = useState(null) // { tipo, fix, status, distance, kind }
  const [note, setNote] = useState('')

  async function send(tipo, fix, justification) {
    setPhase('sending')
    setErr('')
    try {
      const j = await postClockMark({
        barId,
        staffId: meId,
        tipo,
        position: fix?.position || null,
        geoError: fix?.position ? null : (fix?.error || 'unavailable'),
        justification: justification || undefined,
      })
      setAsk(null)
      setNote('')
      onDone?.(j)
    } catch (e) {
      if (e.code === 'justification_required') {
        setAsk({ tipo, fix, status: e.geoStatus || 'unavailable', distance: e.distance, kind: fix?.error || null })
      } else {
        setErr(errText(e))
      }
    } finally {
      setPhase('')
    }
  }

  async function start(tipo) {
    if (!meId || phase) return
    setErr('')
    setPhase('locating')
    const fix = await readPosition({ timeoutMs: 10000 })
    if (venue?.configured) {
      const check = evaluatePunchGeo({ venue: { lat: venue.lat, lng: venue.lng, radius_m: venue.radius_m }, position: fix.position, geoError: fix.error })
      if (check.needsJustification) {
        setPhase('')
        setAsk({ tipo, fix, status: check.geo_status, distance: check.distance_m, kind: fix.error || null })
        return
      }
    }
    await send(tipo, fix, '')
  }

  async function retry() {
    if (!ask || phase) return
    const tipo = ask.tipo
    setPhase('locating')
    const fix = await readPosition({ timeoutMs: 10000 })
    setPhase('')
    if (venue?.configured) {
      const check = evaluatePunchGeo({ venue: { lat: venue.lat, lng: venue.lng, radius_m: venue.radius_m }, position: fix.position, geoError: fix.error })
      if (check.needsJustification) {
        setAsk({ tipo, fix, status: check.geo_status, distance: check.distance_m, kind: fix.error || null })
        return
      }
    }
    await send(tipo, fix, '')
  }

  const sheet = ask ? (
    <JustifySheet
      ask={ask}
      venue={venue}
      note={note}
      setNote={setNote}
      busy={!!phase}
      phase={phase}
      err={err}
      onRetry={retry}
      onCancel={() => { setAsk(null); setNote(''); setErr('') }}
      onSend={() => send(ask.tipo, ask.fix, note.trim())}
      t={t}
    />
  ) : null

  return { start, phase, busy: !!phase, err: ask ? '' : err, sheet, clearErr: () => setErr('') }
}

function reasonText(t, ask, venue) {
  if (ask.status === 'outside') {
    return t('staffApp.geo.outsideBody', { distance: ask.distance ?? '?', radius: venue?.radius_m ?? 150 })
  }
  if (ask.kind === 'denied' || ask.status === 'denied') return t('staffApp.geo.deniedBody')
  if (ask.kind === 'timeout') return t('staffApp.geo.timeoutBody')
  return t('staffApp.geo.unavailableBody')
}

function reasonTitle(t, ask) {
  if (ask.status === 'outside') return t('staffApp.geo.outsideTitle')
  if (ask.kind === 'denied' || ask.status === 'denied') return t('staffApp.geo.deniedTitle')
  if (ask.kind === 'timeout') return t('staffApp.geo.timeoutTitle')
  return t('staffApp.geo.unavailableTitle')
}

function JustifySheet({ ask, venue, note, setNote, busy, phase, err, onRetry, onCancel, onSend, t }) {
  const area = useRef(null)
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])
  const enough = note.trim().length >= JUSTIFICATION_MIN
  const isIn = ask.tipo !== 'out'
  return (
    <div className="sa-sheet-wrap" role="presentation" onClick={() => { if (!busy) onCancel() }}>
      <div className="sa-sheet" role="dialog" aria-modal="true" aria-labelledby="sa-geo-title" onClick={e => e.stopPropagation()}>
        <div className="sa-sheet-grip" aria-hidden="true" />
        <div className="sa-sheet-head">
          <span className={`sa-sheet-icon is-${ask.status}`}><Icon name="location" size={22} /></span>
          <div>
            <h2 id="sa-geo-title">{reasonTitle(t, ask)}</h2>
            <p>{reasonText(t, ask, venue)}</p>
          </div>
        </div>
        <label className="sa-field">
          <span>{t(isIn ? 'staffApp.geo.whyIn' : 'staffApp.geo.whyOut')}</span>
          <textarea
            ref={area}
            rows={3}
            maxLength={500}
            value={note}
            onChange={e => setNote(e.target.value)}
            placeholder={t('staffApp.geo.placeholder')}
            autoFocus
          />
          <small className={enough ? 'is-ok' : ''}>{t('staffApp.geo.minChars', { n: JUSTIFICATION_MIN, have: note.trim().length })}</small>
        </label>
        {err && <div className="sa-error" role="alert">{err}</div>}
        <div className="sa-sheet-actions">
          <button type="button" className="sa-btn is-primary" disabled={!enough || busy} onClick={onSend}>
            {phase === 'sending' ? t('common.wait') : t(isIn ? 'staffApp.geo.sendIn' : 'staffApp.geo.sendOut')}
          </button>
          <button type="button" className="sa-btn" disabled={busy} onClick={onRetry}>
            <Icon name="refresh" size={16} /> {phase === 'locating' ? t('staffApp.locating') : t('staffApp.geo.retry')}
          </button>
          <button type="button" className="sa-btn is-ghost" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button>
        </div>
      </div>
    </div>
  )
}

/** Small owner-facing badge for a punch outside the area or without GPS, with the staff's reason. */
export function PunchGeoBadge({ punch, withReason = true }) {
  const { t } = useI18n()
  const flag = punchGeoFlag(punch)
  if (!flag) return null
  const label = flag.status === 'outside'
    ? t('staffApp.geo.badgeOutside', { distance: flag.distance ?? '?' })
    : t('staffApp.geo.badgeNoGps')
  return (
    <span className={`geo-badge is-${flag.status}`} title={flag.justification || undefined}>
      <Icon name="location" size={12} /> {label}
      {withReason && flag.justification ? <em>“{flag.justification}”</em> : null}
    </span>
  )
}
