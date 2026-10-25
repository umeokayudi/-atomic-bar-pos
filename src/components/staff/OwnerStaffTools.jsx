import { useEffect, useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { readPosition } from '../../lib/geoClient'
import { DEFAULT_RADIUS_M, clampRadius, venueOf } from '../../lib/clockGeo'
import { answerRequest, listDayReports, listRequests, saveBarLocation } from '../../lib/staffSelfApi'
import { invalidateBarTeam } from '../../lib/barTeam'
import { errText } from '../../lib/errText'
import { fmtYen } from '../utils'
import Icon from '../ui/Icon'
import { fmtDay, fmtTime } from './staffUi'

/** Owner/manager: the bar's clock-in point and radius. Saved with the existing saveLocation action ('users' area). */
export function OwnerLocation({ bar, canEdit, onSaved }) {
  const { t } = useI18n()
  const venue = venueOf(bar)
  const [radius, setRadius] = useState(String(venue?.radius_m || bar?.geofence_m || DEFAULT_RADIUS_M))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [err, setErr] = useState('')

  useEffect(() => { setRadius(String(venueOf(bar)?.radius_m || bar?.geofence_m || DEFAULT_RADIUS_M)) }, [bar?.lat, bar?.lng, bar?.geofence_m]) // eslint-disable-line react-hooks/exhaustive-deps

  async function save(pos) {
    setBusy(true); setErr(''); setMsg('')
    try {
      await saveBarLocation({ lat: pos.lat, lng: pos.lng, geofence_m: clampRadius(radius) })
      invalidateBarTeam()
      setMsg(t('ownerClock.saved'))
      onSaved?.()
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }

  async function useHere() {
    setBusy(true); setErr(''); setMsg('')
    const fix = await readPosition({ timeoutMs: 12000 })
    setBusy(false)
    if (!fix.position) { setErr(t('ownerClock.gpsFailed', { error: fix.error })); return }
    await save(fix.position)
  }

  return (
    <section className="desk-card own-loc" aria-label={t('ownerClock.locTitle')}>
      <h3><Icon name="location" size={17} /> {t('ownerClock.locTitle')}</h3>
      <p className="desk-note">{t('ownerClock.locLead')}</p>
      {venue
        ? <p className="desk-note"><b>{t('ownerClock.locSet', { lat: venue.lat.toFixed(5), lng: venue.lng.toFixed(5), radius: venue.radius_m })}</b></p>
        : <div className="sa-note"><Icon name="warning" size={15} /> <span>{t('ownerClock.locMissing')}</span></div>}
      {canEdit ? (
        <div className="own-loc-row">
          <label>{t('ownerClock.radius')}<input type="number" min="50" max="500" step="10" value={radius} onChange={e => setRadius(e.target.value)} /></label>
          <button type="button" className="btn-primary" disabled={busy} onClick={useHere}><Icon name="location" size={16} /> {busy ? t('common.wait') : t('ownerClock.useHere')}</button>
          {venue && <button type="button" className="ui-btn" disabled={busy} onClick={() => save(venue)}>{t('ownerClock.saveRadius')}</button>}
        </div>
      ) : <p className="desk-note">{t('ownerClock.needUsers')}</p>}
      {msg && <p className="desk-note" role="status">{msg}</p>}
      {err && <div className="pos-sale-err" role="alert">{err}</div>}
    </section>
  )
}

/** Owner/manager: end-of-shift reports (summary, notes, signature, AI text). Never shown in the staff app. */
export function OwnerDayReports() {
  const { t } = useI18n()
  const [list, setList] = useState(null)
  const [open, setOpen] = useState(null)
  useEffect(() => {
    let live = true
    listDayReports().then(j => { if (live) setList(j.reports || []) }).catch(() => { if (live) setList([]) })
    return () => { live = false }
  }, [])
  return (
    <section className="desk-card own-reports" aria-label={t('ownerClock.reportsTitle')}>
      <h3><Icon name="tasks" size={17} /> {t('ownerClock.reportsTitle')}</h3>
      <p className="desk-note">{t('ownerClock.reportsLead')}</p>
      {list == null && <p className="desk-note">{t('common.wait')}</p>}
      {list != null && !list.length && <p className="desk-note">{t('ownerClock.noReports')}</p>}
      {(list || []).slice(0, 20).map(r => (
        <article key={r.id} className="own-report">
          <button type="button" className="own-report-head sa-link" style={{ textAlign: 'left', color: 'inherit' }} onClick={() => setOpen(open === r.id ? null : r.id)} aria-expanded={open === r.id}>
            <strong>{r.staff_nome || '—'} · {r.night_key}</strong>
            <span>{fmtYen(r.summary?.sales || 0)}{r.goal?.target ? ` / ${fmtYen(r.goal.target)}` : ''} · {fmtTime(r.out_at)}</span>
          </button>
          <div className="own-report-ai">{r.ai_report || t('ownerClock.aiMissing')}</div>
          {open === r.id && (
            <dl>
              {r.role && <><dt>{t('staffApp.brief.role')}</dt><dd>{r.role}</dd></>}
              {r.mission && <><dt>{t('staffApp.brief.mission')}</dt><dd>{r.mission}</dd></>}
              <dt>{t('staffApp.out.commission')}</dt><dd>{fmtYen(r.summary?.commission || 0)}</dd>
              <dt>{t('staffApp.out.drank')}</dt><dd>{r.summary?.drinkBackCount || 0}</dd>
              {r.notes && <><dt>{t('ownerClock.notes')}</dt><dd>{r.notes}</dd></>}
              {r.improve && <><dt>{t('ownerClock.improve')}</dt><dd>{r.improve}</dd></>}
              {r.signature && <><dt>{t('ownerClock.signature')}</dt><dd><img className="own-report-sign" src={r.signature} alt={t('ownerClock.signature')} /></dd></>}
            </dl>
          )}
        </article>
      ))}
    </section>
  )
}

/** Owner/manager inbox: reports and requests staff sent from their app. */
export function StaffInbox() {
  const { t } = useI18n()
  const [list, setList] = useState(null)
  const [drafts, setDrafts] = useState({})
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  function load() { listRequests().then(j => setList(j.requests || [])).catch(e => { setList([]); setErr(errText(e)) }) }
  useEffect(load, [])
  async function act(r, patch) {
    setBusy(r.id); setErr('')
    try {
      const j = await answerRequest(r.id, patch)
      setList(prev => (prev || []).map(x => (x.id === r.id ? { ...x, ...j.request } : x)))
      if (patch.answer != null) setDrafts(d => ({ ...d, [r.id]: '' }))
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy('')
    }
  }
  return (
    <section className="desk-card own-inbox" aria-label={t('staffInbox.title')}>
      <h3><Icon name="inbox" size={17} /> {t('staffInbox.title')}</h3>
      <p className="desk-note">{t('staffInbox.lead')}</p>
      {err && <div className="pos-sale-err">{err}</div>}
      {list == null && <p className="desk-note">{t('common.wait')}</p>}
      {list != null && !list.length && <p className="desk-note">{t('staffInbox.none')}</p>}
      {(list || []).map(r => (
        <article key={r.id} className={`own-inbox-item${r.status === 'done' ? ' is-done' : ''}`}>
          <div className="own-report-head">
            <strong>{r.staff_nome || '—'} · {t(`staffApp.req.type_${r.tipo}`)}</strong>
            <span className={`sa-chip is-req-${r.status}`}>{t(`staffApp.req.status_${r.status}`)}</span>
          </div>
          <div>{r.texto}</div>
          <small className="desk-note">{fmtDay(r.criado_em)} {fmtTime(r.criado_em)}</small>
          {r.foto_url && <a href={r.foto_url} target="_blank" rel="noreferrer"><img className="own-inbox-photo" src={r.foto_url} alt="" /></a>}
          {r.answer && <p className="desk-note">{t('staffApp.req.answer', { who: r.answered_by || '' })} {r.answer}</p>}
          <div className="own-inbox-actions">
            <input value={drafts[r.id] || ''} onChange={e => setDrafts(d => ({ ...d, [r.id]: e.target.value }))} placeholder={t('staffInbox.replyPh')} aria-label={t('staffInbox.reply')} />
            <button type="button" className="ui-btn" disabled={busy === r.id || !(drafts[r.id] || '').trim()} onClick={() => act(r, { answer: drafts[r.id].trim(), status: r.status === 'open' ? 'seen' : r.status })}>{t('staffInbox.send')}</button>
            {r.status === 'open' && <button type="button" className="ui-btn" disabled={busy === r.id} onClick={() => act(r, { status: 'seen' })}>{t('staffInbox.seen')}</button>}
            {r.status !== 'done' && <button type="button" className="btn-primary" disabled={busy === r.id} onClick={() => act(r, { status: 'done' })}>{r.tipo === 'zangyo' ? t('staffInbox.confirmZangyo') : r.tipo === 'early' ? t('staffInbox.confirmEarly') : t('staffInbox.done')}</button>}
          </div>
        </article>
      ))}
    </section>
  )
}
