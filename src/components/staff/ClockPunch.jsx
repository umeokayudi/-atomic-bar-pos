import { useEffect, useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { readPosition } from '../../lib/geoClient'
import { JUSTIFICATION_MIN, evaluatePunchGeo, punchGeoFlag } from '../../lib/clockGeo'
import { postClockMark } from '../TimeClock'
import { errText } from '../../lib/errText'
import { fmtYen } from '../utils'
import Icon from '../ui/Icon'
import SignaturePad from './SignaturePad'

/**
 * Clock in / out from the staff app.
 *   IN:  tap → GPS → (outside / no GPS: reason) → "Read and agree" (mission, goals, my role) → saved with ack.
 *   OUT: tap → GPS → (reason) → day summary (sold, drank, notes, how it went, signature) → saved; the server
 *        writes the owner's day report (AI text included when it works).
 * The server checks the same GPS rule, so nothing here can be skipped by calling the API directly.
 *   const punch = useClockPunch({ barId, meId, venue, day, openIn, onDone })
 *   <button onClick={() => punch.start('in')}>…</button>  {punch.sheet}
 */
export function useClockPunch({ barId, meId, venue, day, openIn, onDone }) {
  const { t } = useI18n()
  const [phase, setPhase] = useState('') // '' | 'locating' | 'sending'
  const [err, setErr] = useState('')
  const [flow, setFlow] = useState(null) // { tipo, fix, geo: {status, distance, kind} | null, step: 'justify'|'ack'|'checkout', reason }

  function geoCheck(fix) {
    if (!venue?.configured) return null
    const check = evaluatePunchGeo({ venue: { lat: venue.lat, lng: venue.lng, radius_m: venue.radius_m }, position: fix.position, geoError: fix.error })
    return check.needsJustification ? { status: check.geo_status, distance: check.distance_m, kind: fix.error || null } : null
  }

  const nextStep = tipo => (tipo === 'out' ? 'checkout' : 'ack')

  async function start(tipo) {
    if (!meId || phase) return
    setErr('')
    setPhase('locating')
    const fix = await readPosition({ timeoutMs: 10000 })
    setPhase('')
    const geo = geoCheck(fix)
    setFlow({ tipo, fix, geo, step: geo ? 'justify' : nextStep(tipo), reason: '' })
  }

  async function retryGps() {
    if (!flow || phase) return
    setPhase('locating')
    const fix = await readPosition({ timeoutMs: 10000 })
    setPhase('')
    const geo = geoCheck(fix)
    setFlow(f => ({ ...f, fix, geo, step: geo ? 'justify' : nextStep(f.tipo) }))
  }

  async function send(extra = {}) {
    if (!flow) return
    setPhase('sending')
    setErr('')
    try {
      const j = await postClockMark({
        barId,
        staffId: meId,
        tipo: flow.tipo,
        position: flow.fix?.position || null,
        geoError: flow.fix?.position ? null : (flow.fix?.error || 'unavailable'),
        justification: flow.geo ? flow.reason.trim() : undefined,
        extra: {
          ...(flow.tipo === 'out' && openIn?.at ? { open_in_at: openIn.at, open_in_id: openIn.id || undefined } : {}),
          ...extra,
        },
      })
      setFlow(null)
      onDone?.(j, flow.tipo)
    } catch (e) {
      if (e.code === 'justification_required') {
        setFlow(f => ({ ...f, step: 'justify', geo: { status: e.geoStatus || 'unavailable', distance: e.distance, kind: f.fix?.error || null } }))
      } else {
        setErr(errText(e))
      }
    } finally {
      setPhase('')
    }
  }

  const close = () => { if (!phase) { setFlow(null); setErr('') } }

  let sheet = null
  if (flow?.step === 'justify') {
    sheet = (
      <JustifySheet
        flow={flow} venue={venue} phase={phase} err={err} t={t}
        setReason={reason => setFlow(f => ({ ...f, reason }))}
        onRetry={retryGps}
        onNext={() => setFlow(f => ({ ...f, step: nextStep(f.tipo) }))}
        onCancel={close}
      />
    )
  } else if (flow?.step === 'ack') {
    sheet = <AckSheet day={day} phase={phase} err={err} t={t} onAgree={() => send({ ack: true, ack_role: day?.role || '', ack_mission: day?.mission || '' })} onCancel={close} />
  } else if (flow?.step === 'checkout') {
    sheet = <CheckoutSheet day={day} phase={phase} err={err} t={t} onSend={checkout => send({ checkout })} onCancel={close} />
  }

  return { start, phase, busy: !!phase, err: flow ? '' : err, sheet, clearErr: () => setErr('') }
}

function Sheet({ title, icon, tone, lead, children, onCancel, busy, labelId }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape' && !busy) onCancel() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onCancel])
  return (
    <div className="sa-sheet-wrap" role="presentation" onClick={() => { if (!busy) onCancel() }}>
      <div className="sa-sheet" role="dialog" aria-modal="true" aria-labelledby={labelId} onClick={e => e.stopPropagation()}>
        <div className="sa-sheet-grip" aria-hidden="true" />
        <div className="sa-sheet-head">
          <span className={`sa-sheet-icon is-${tone || 'ok'}`}><Icon name={icon} size={22} /></span>
          <div>
            <h2 id={labelId}>{title}</h2>
            {lead && <p>{lead}</p>}
          </div>
        </div>
        <div className="sa-sheet-body">{children}</div>
      </div>
    </div>
  )
}

function geoTitle(t, geo) {
  if (geo.status === 'outside') return t('staffApp.geo.outsideTitle')
  if (geo.kind === 'denied' || geo.status === 'denied') return t('staffApp.geo.deniedTitle')
  if (geo.kind === 'timeout') return t('staffApp.geo.timeoutTitle')
  return t('staffApp.geo.unavailableTitle')
}

function geoBody(t, geo, venue) {
  if (geo.status === 'outside') return t('staffApp.geo.outsideBody', { distance: geo.distance ?? '?', radius: venue?.radius_m ?? 150 })
  if (geo.kind === 'denied' || geo.status === 'denied') return t('staffApp.geo.deniedBody')
  if (geo.kind === 'timeout') return t('staffApp.geo.timeoutBody')
  return t('staffApp.geo.unavailableBody')
}

function JustifySheet({ flow, venue, phase, err, t, setReason, onRetry, onNext, onCancel }) {
  const enough = flow.reason.trim().length >= JUSTIFICATION_MIN
  const isIn = flow.tipo !== 'out'
  const busy = !!phase
  return (
    <Sheet title={geoTitle(t, flow.geo)} lead={geoBody(t, flow.geo, venue)} icon="location" tone={flow.geo.status} onCancel={onCancel} busy={busy} labelId="sa-geo-title">
      <label className="sa-field">
        <span>{t(isIn ? 'staffApp.geo.whyIn' : 'staffApp.geo.whyOut')}</span>
        <textarea rows={3} maxLength={500} value={flow.reason} onChange={e => setReason(e.target.value)} placeholder={t('staffApp.geo.placeholder')} />
        <small className={enough ? 'is-ok' : ''}>{t('staffApp.geo.minChars', { n: JUSTIFICATION_MIN, have: flow.reason.trim().length })}</small>
      </label>
      {err && <div className="sa-error" role="alert">{err}</div>}
      <div className="sa-sheet-actions">
        <button type="button" className="sa-btn is-primary" disabled={!enough || busy} onClick={onNext}>{t('staffApp.continue')}</button>
        <button type="button" className="sa-btn" disabled={busy} onClick={onRetry}>
          <Icon name="refresh" size={16} /> {phase === 'locating' ? t('staffApp.locating') : t('staffApp.geo.retry')}
        </button>
        <button type="button" className="sa-btn is-ghost" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </Sheet>
  )
}

function GoalLines({ day, t }) {
  const g = day?.goal || {}
  return (
    <ul className="sa-brief">
      <li><span>{t('staffApp.brief.mission')}</span><strong>{day?.mission || t('staffApp.brief.noMission')}</strong></li>
      <li><span>{t('staffApp.brief.role')}</span><strong>{day?.role || t('staffApp.brief.noRole')}</strong></li>
      <li><span>{t('staffApp.brief.barGoal')}</span><strong>{day?.barGoal ? fmtYen(day.barGoal) : t('staffApp.brief.none')}</strong></li>
      <li><span>{t('staffApp.brief.myGoal')}</span><strong>{g.target ? fmtYen(g.target) : t('staffApp.brief.none')}</strong></li>
    </ul>
  )
}

function AckSheet({ day, phase, err, t, onAgree, onCancel }) {
  const busy = !!phase
  return (
    <Sheet title={t('staffApp.ack.title')} lead={t('staffApp.ack.lead')} icon="tasks" onCancel={onCancel} busy={busy} labelId="sa-ack-title">
      {day ? <GoalLines day={day} t={t} /> : <p className="sa-muted">{t('staffApp.ack.noDay')}</p>}
      {err && <div className="sa-error" role="alert">{err}</div>}
      <div className="sa-sheet-actions">
        <button type="button" className="sa-btn is-primary" disabled={busy} onClick={onAgree}>
          <Icon name="check" size={18} /> {phase === 'sending' ? t('common.wait') : t('staffApp.ack.agree')}
        </button>
        <button type="button" className="sa-btn is-ghost" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </Sheet>
  )
}

function CheckoutSheet({ day, phase, err, t, onSend, onCancel }) {
  const [notes, setNotes] = useState('')
  const [improve, setImprove] = useState('')
  const [signature, setSignature] = useState('')
  const busy = !!phase
  const s = day?.summary || { tickets: 0, sales: 0, commission: 0, sold: [], drinkBacks: [], drinkBackCount: 0 }
  const missed = !!day?.goal?.missed
  const improveOk = !missed || improve.trim().length >= 5
  const ready = improveOk && !!signature
  return (
    <Sheet title={t('staffApp.out.title')} lead={t('staffApp.out.lead')} icon="clock" onCancel={onCancel} busy={busy} labelId="sa-out-title">
      <div className="sa-sum">
        <div><span>{t('staffApp.out.sales')}</span><strong>{fmtYen(s.sales)}</strong><small>{t('staffApp.out.tickets', { n: s.tickets })}</small></div>
        <div><span>{t('staffApp.out.commission')}</span><strong>{fmtYen(s.commission)}</strong></div>
        <div><span>{t('staffApp.out.drank')}</span><strong>{s.drinkBackCount}</strong></div>
      </div>
      {day?.goal?.target > 0 && (
        <p className={`sa-goal-line${missed ? ' is-missed' : ' is-hit'}`}>
          {t(missed ? 'staffApp.out.goalMissed' : 'staffApp.out.goalHit', { target: fmtYen(day.goal.target), pct: day.goal.pct ?? 0 })}
        </p>
      )}
      {(s.sold.length > 0 || s.drinkBacks.length > 0) && (
        <div className="sa-two-lists">
          {s.sold.length > 0 && (
            <div><h3>{t('staffApp.out.sold')}</h3><ul>{s.sold.slice(0, 6).map(x => <li key={x.nome}><span>{x.nome}</span><b>×{x.qtd}</b></li>)}</ul></div>
          )}
          {s.drinkBacks.length > 0 && (
            <div><h3>{t('staffApp.out.drinkBacks')}</h3><ul>{s.drinkBacks.slice(0, 6).map(x => <li key={x.nome}><span>{x.nome}</span><b>×{x.qtd}</b></li>)}</ul></div>
          )}
        </div>
      )}
      {!day && <p className="sa-muted">{t('staffApp.out.noSummary')}</p>}
      <label className="sa-field">
        <span>{t('staffApp.out.notes')}</span>
        <textarea rows={2} maxLength={1000} value={notes} onChange={e => setNotes(e.target.value)} placeholder={t('staffApp.out.notesPh')} />
      </label>
      <label className="sa-field">
        <span>{t(missed ? 'staffApp.out.improveRequired' : 'staffApp.out.improve')}</span>
        <textarea rows={2} maxLength={1000} value={improve} onChange={e => setImprove(e.target.value)} placeholder={t('staffApp.out.improvePh')} />
        {missed && <small className={improveOk ? 'is-ok' : ''}>{t('staffApp.geo.minChars', { n: 5, have: improve.trim().length })}</small>}
      </label>
      <SignaturePad label={t('staffApp.out.sign')} clearLabel={t('staffApp.out.clearSign')} onChange={setSignature} />
      <p className="sa-muted">{t('staffApp.out.ownerOnly')}</p>
      {err && <div className="sa-error" role="alert">{err}</div>}
      <div className="sa-sheet-actions">
        <button type="button" className="sa-btn is-primary is-danger" disabled={!ready || busy} onClick={() => onSend({ notes: notes.trim(), improve: improve.trim(), signature })}>
          {phase === 'sending' ? t('staffApp.out.saving') : t('staffApp.out.confirm')}
        </button>
        <button type="button" className="sa-btn is-ghost" disabled={busy} onClick={onCancel}>{t('common.cancel')}</button>
      </div>
    </Sheet>
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
