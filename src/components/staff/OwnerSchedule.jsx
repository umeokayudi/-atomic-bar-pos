import { useCallback, useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { useAuth } from '../Auth'
import { useI18n } from '../../lib/i18n'
import { canAccess } from '../../lib/barAccess'
import { loadBarTeam, peekBarTeam } from '../../lib/barTeam'
import { clockStaff } from '../../lib/timeClock'
import {
  DEFAULT_RULES, WEEKDAY_KEYS, addDays, attendanceFor, deadlineMs, scheduleBoard as buildBoard, scheduleWindow, spanLabel, weekCheck,
} from '../../lib/staffSchedule'
import { FINE_TYPES, fineSettings, finesTotal, suggestFine } from '../../lib/staffFines'
import { tokyoNightKey } from '../../lib/tokyo'
import { cancelFine, confirmSchedule, listFines, remindSchedule, saveFine, saveFineSettings, saveScheduleRules, scheduleBoard } from '../../lib/staffSelfApi'
import { errText } from '../../lib/errText'
import { fmtYen } from '../utils'
import Icon from '../ui/Icon'
import { fmtDay, fmtTime } from './staffUi'
import { END_TIMES, START_TIMES } from './ScheduleScreen'

const noon = key => `${key}T12:00:00+09:00`
const hoursOf = p => (p?.start ? `${p.start}${p.end ? `–${p.end}` : ''}` : '')

/** Everyone who can be scheduled: logins of the bar (not the owner/tills) and registered employees. */
export function rosterOf(pack) {
  const seen = new Set()
  const rows = []
  for (const p of [...clockStaff(pack?.staff), ...(pack?.people || [])]) {
    if (!p?.id || p.ativo === false || seen.has(p.id)) continue
    const nome = String(p.nome || p.email || '').trim()
    if (!nome) continue
    seen.add(p.id)
    rows.push({ id: p.id, nome })
  }
  rows.sort((a, b) => a.nome.localeCompare(b.nome))
  return rows
}

/** Board data for a range (marks, confirmed lists, punches, fines, settings) with attendance per night. */
export function useScheduleBoard(from, to) {
  const [state, setState] = useState({ loading: true, data: null, err: '' })
  const load = useCallback(() => {
    setState(s => ({ ...s, loading: true }))
    return scheduleBoard(from, to)
      .then(data => setState({ loading: false, data, err: '' }))
      .catch(e => setState({ loading: false, data: null, err: errText(e) }))
  }, [from, to])
  useEffect(() => { load() }, [load])
  const rows = useMemo(() => {
    const d = state.data
    if (!d) return []
    const settings = d.settings || fineSettings({})
    return buildBoard({ from, to, availability: d.availability, schedules: d.schedules }).map(r => ({
      ...r,
      attendance: attendanceFor({ day: r.day, expected: r.expected, punches: d.punches, toleranceMin: settings.tolerance }),
    }))
  }, [state.data, from, to])
  return { ...state, rows, reload: load }
}

const STATUS_TONE = { ok: 'is-ok', late: 'is-outside', absent: 'is-bad', missing: 'is-outside', pending: '' }

function StatusChip({ t, a }) {
  if (!a || a.status === 'pending') return a?.start ? <span className="sa-chip">{a.start}</span> : null
  return <span className={`sa-chip ${STATUS_TONE[a.status]}`}>{t(`ownerSchedule.st_${a.status}`, { min: a.lateMinutes })}</span>
}

/** Owner/manager: apply a fine (one person, one night). Amount pre-filled from the bar's fine settings. */
export function FineSheet({ initial, roster, onClose, onSaved }) {
  const { t } = useI18n()
  const [f, setF] = useState(() => ({ type: 'other', amount: '', note: '', ...initial }))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const today = tokyoNightKey()
  async function apply() {
    setBusy(true); setErr('')
    try {
      const person = roster.find(p => p.id === f.staff_id)
      const j = await saveFine({ ...f, staff_nome: person?.nome || f.staff_nome || '', amount: Math.round(+f.amount || 0) })
      onSaved?.(j.fine)
      onClose()
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }
  // Portal: the page animates in (transform), which would trap the sheet under the phone's bottom bar.
  return createPortal(
    <div className="sa-sheet-wrap is-top" role="dialog" aria-modal="true" aria-label={t('fines.applyTitle')} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sa-sheet fine-sheet">
        <div className="sa-sheet-grip" />
        <div className="sa-sheet-head">
          <span className="sa-sheet-icon is-outside"><Icon name="fine" size={22} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{t('fines.applyTitle')}</h2>
            <p>{t('fines.applyLead')}</p>
          </div>
          <button type="button" className="sa-icon-btn" onClick={onClose} aria-label={t('common.close')}><Icon name="close" size={20} /></button>
        </div>
        <div className="sa-sheet-body">
          <label className="sa-field">
            <span>{t('fines.person')}</span>
            <select value={f.staff_id || ''} onChange={e => setF(x => ({ ...x, staff_id: e.target.value }))}>
              <option value="">—</option>
              {roster.map(p => <option key={p.id} value={p.id}>{p.nome}</option>)}
            </select>
          </label>
          <label className="sa-field">
            <span>{t('fines.day')}</span>
            <input type="date" value={f.day || ''} max={today} onChange={e => setF(x => ({ ...x, day: e.target.value }))} />
          </label>
          <div className="sa-field">
            <span>{t('fines.type')}</span>
            <div className="sa-chips" role="radiogroup" aria-label={t('fines.type')}>
              {FINE_TYPES.map(type => (
                <button key={type} type="button" role="radio" aria-checked={f.type === type} className={f.type === type ? 'is-on' : ''} onClick={() => setF(x => ({ ...x, type }))}>{t(`fines.type_${type}`)}</button>
              ))}
            </div>
          </div>
          <label className="sa-field">
            <span>{t('fines.amount')}</span>
            <input type="number" inputMode="numeric" min="1" step="100" value={f.amount} onChange={e => setF(x => ({ ...x, amount: e.target.value }))} />
            {initial?.suggested > 0 && <small>{t('fines.suggested', { amount: fmtYen(initial.suggested) })}</small>}
          </label>
          <label className="sa-field">
            <span>{t('fines.note')}</span>
            <textarea rows={2} maxLength={300} value={f.note} placeholder={t('fines.notePh')} onChange={e => setF(x => ({ ...x, note: e.target.value }))} />
          </label>
          {err && <div className="sa-error" role="alert">{err}</div>}
          <div className="sa-sheet-actions">
            <button type="button" className="sa-btn is-ghost" onClick={onClose}>{t('common.cancel')}</button>
            <button type="button" className="sa-btn is-primary is-danger" disabled={busy || !f.staff_id || !f.day || !(+f.amount > 0)} onClick={apply}>
              <Icon name="fine" size={18} /> {busy ? t('common.wait') : t('fines.apply', { amount: fmtYen(+f.amount || 0) })}
            </button>
          </div>
        </div>
      </div>
    </div>,
    document.body,
  )
}

function ConfirmEditor({ t, row, roster, onCancel, onSaved }) {
  const markedIds = new Set(row.marked.map(p => p.id))
  const [picked, setPicked] = useState(() => Object.fromEntries(row.expected.map(p => [p.id, { start: p.start || '', end: p.end || '' }])))
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  const people = [...roster].sort((a, b) => (markedIds.has(b.id) - markedIds.has(a.id)) || a.nome.localeCompare(b.nome))
  async function save() {
    setBusy(true); setErr('')
    try {
      const list = people.filter(p => p.id in picked).map(p => ({ id: p.id, nome: p.nome, start: picked[p.id].start, end: picked[p.id].end }))
      await confirmSchedule(row.day, list)
      onSaved()
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <div className="osb-edit">
      {people.map(p => {
        const on = p.id in picked
        return (
          <div key={p.id} className={`osb-edit-row${on ? ' is-on' : ''}`}>
            <label>
              <input type="checkbox" checked={on} onChange={() => setPicked(x => { const o = { ...x }; const m = row.marked.find(mk => mk.id === p.id); if (on) delete o[p.id]; else o[p.id] = { start: m?.start || '', end: m?.end || '' }; return o })} />
              <span>{p.nome}</span>
              {markedIds.has(p.id) && <em className="sa-chip is-ok">{t('ownerSchedule.marked')}</em>}
            </label>
            {on && (
              <span className="osb-hours">
                <select aria-label={t('schedule.startAt')} value={picked[p.id].start || ''} onChange={e => setPicked(x => ({ ...x, [p.id]: { ...x[p.id], start: e.target.value } }))}>
                  <option value="">{t('schedule.anyTime')}</option>
                  {START_TIMES.map(tm => <option key={tm} value={tm}>{tm}</option>)}
                </select>
                <select aria-label={t('schedule.endAt')} value={picked[p.id].end || ''} onChange={e => setPicked(x => ({ ...x, [p.id]: { ...x[p.id], end: e.target.value } }))}>
                  <option value="">{t('schedule.noEnd')}</option>
                  {END_TIMES.map(tm => <option key={tm} value={tm}>{tm}</option>)}
                </select>
              </span>
            )}
          </div>
        )
      })}
      {err && <div className="sa-error" role="alert">{err}</div>}
      <div className="osb-actions">
        <button type="button" className="ui-btn" onClick={onCancel}>{t('common.cancel')}</button>
        <button type="button" className="btn-primary" disabled={busy} onClick={save}>{busy ? t('common.wait') : t('ownerSchedule.confirmN', { n: Object.keys(picked).length })}</button>
      </div>
    </div>
  )
}

/** The owner's rules for sending next week: required, deadline, reminder, least nights, end time. */
function ScheduleRulesCard({ t, rules, onSaved }) {
  const [v, setV] = useState(rules)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { setV(rules) }, [rules])
  async function save() {
    setBusy(true); setMsg('')
    try {
      const j = await saveScheduleRules(v)
      setMsg(t('scheduleRules.saved'))
      onSaved(j.rules)
    } catch (e) {
      setMsg(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const num = (k, label, min, max) => (
    <label key={k}>
      {label}
      <input type="number" inputMode="numeric" min={min} max={max} step="1" value={v[k]} disabled={busy} onChange={e => setV(x => ({ ...x, [k]: e.target.value }))} />
    </label>
  )
  return (
    <section className="desk-card osb-settings osb-rules">
      <h3><Icon name="settings" size={17} /> {t('scheduleRules.title')}</h3>
      <p className="desk-note">{t('scheduleRules.lead')}</p>
      <label className="osb-toggle">
        <input type="checkbox" checked={!!v.required} disabled={busy} onChange={e => setV(x => ({ ...x, required: e.target.checked }))} />
        <span><strong>{t('scheduleRules.required')}</strong><small>{t('scheduleRules.requiredHint')}</small></span>
      </label>
      <label className="osb-toggle">
        <input type="checkbox" checked={!!v.needEnd} disabled={busy} onChange={e => setV(x => ({ ...x, needEnd: e.target.checked }))} />
        <span><strong>{t('scheduleRules.needEnd')}</strong><small>{t('scheduleRules.needEndHint')}</small></span>
      </label>
      <div className="house-editor">
        <label>
          {t('scheduleRules.deadlineDay')}
          <select value={v.deadlineDay} disabled={busy} onChange={e => setV(x => ({ ...x, deadlineDay: +e.target.value }))}>
            {WEEKDAY_KEYS.map((k, i) => <option key={k} value={i}>{t(`schedule.wd_${k}`)}</option>)}
          </select>
        </label>
        <label>
          {t('scheduleRules.deadlineHour')}
          <select value={v.deadlineHour} disabled={busy} onChange={e => setV(x => ({ ...x, deadlineHour: +e.target.value }))}>
            {Array.from({ length: 24 }, (_, h) => <option key={h} value={h}>{`${String(h).padStart(2, '0')}:00`}</option>)}
          </select>
        </label>
        {num('remindDays', t('scheduleRules.remindDays'), 0, 6)}
        {num('minNights', t('scheduleRules.minNights'), 0, 7)}
      </div>
      <p className="desk-note">{t('scheduleRules.summary', { day: t(`schedule.wd_${WEEKDAY_KEYS[+v.deadlineDay || 0]}`), hour: `${String(+v.deadlineHour || 0).padStart(2, '0')}:00`, n: +v.remindDays || 0 })}</p>
      <button type="button" className="btn-primary" disabled={busy} onClick={save}>{busy ? t('common.wait') : t('common.save')}</button>
      {msg && <p className="desk-note" role="status">{msg}</p>}
    </section>
  )
}

/** Per person: did they send next week (start and end on every night), and which nights. */
function submissionRows(roster, availability, rules, nextWeek) {
  const byId = new Map((availability || []).map(r => [String(r.staff_id), r]))
  return roster.map(p => {
    const r = byId.get(String(p.id))
    const check = weekCheck(r?.days || {}, { ...nextWeek, rules })
    const sent = !!r?.weeks?.[nextWeek.from]?.submitted_at && check.ok
    const nights = []
    for (let d = nextWeek.from; d <= nextWeek.to; d = addDays(d, 1)) if (r?.days?.[d]) nights.push({ day: d, ...r.days[d] })
    return { ...p, sent, sentAt: sent ? r.weeks[nextWeek.from].submitted_at : null, nights }
  }).sort((a, b) => (a.sent - b.sent) || a.nome.localeCompare(b.nome))
}

/** Who sent next week (start and end on every night), who did not, and a reminder for the late ones. */
function SubmissionsCard({ t, roster, availability, rules, nextWeek }) {
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  if (!nextWeek) return null
  const rows = submissionRows(roster, availability, rules, nextWeek)
  const pending = rows.filter(r => !r.sent)
  const deadline = deadlineMs(nextWeek.from, rules)
  const left = deadline - Date.now()
  async function remind() {
    setBusy(true); setMsg('')
    try {
      const j = await remindSchedule(pending.map(p => p.id))
      setMsg(t('scheduleRules.reminded', { n: j.reminded ?? pending.length }))
    } catch (e) {
      setMsg(errText(e))
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="desk-card osb-subs">
      <div className="osb-head">
        <h3><Icon name="send" size={17} /> {t('scheduleRules.subsTitle', { from: fmtDay(noon(nextWeek.from), { month: 'short', day: 'numeric' }), to: fmtDay(noon(nextWeek.to), { month: 'short', day: 'numeric' }) })}</h3>
        <b className="sa-pill">{rows.length - pending.length}/{rows.length}</b>
      </div>
      <p className="desk-note">
        {left > 0
          ? t('scheduleRules.deadlineIn', { when: `${fmtDay(deadline, { weekday: 'short', month: 'numeric', day: 'numeric' })} ${fmtTime(deadline)}`, left: spanLabel(left) })
          : t('scheduleRules.deadlinePassed', { when: `${fmtDay(deadline, { weekday: 'short', month: 'numeric', day: 'numeric' })} ${fmtTime(deadline)}` })}
      </p>
      <ul className="osb-people">
        {!rows.length && <li className="osb-none">{t('ownerSchedule.nobody')}</li>}
        {rows.map(r => (
          <li key={r.id} className={r.sent ? 'is-ok' : 'is-missing'}>
            <span className="osb-name">
              {r.nome}
              <small> · {r.nights.length ? r.nights.map(n => `${fmtDay(noon(n.day), { weekday: 'short' })} ${hoursOf(n) || '?'}`).join(', ') : t('scheduleRules.noNights')}</small>
            </span>
            {r.sent
              ? <span className="sa-chip is-ok"><Icon name="check" size={12} /> {t('scheduleRules.sent')}</span>
              : <span className={`sa-chip ${left > 0 ? 'is-outside' : 'is-bad'}`}>{t('scheduleRules.pending')}</span>}
          </li>
        ))}
      </ul>
      {pending.length > 0 && (
        <button type="button" className="ui-btn" disabled={busy} onClick={remind}>
          <Icon name="bell" size={16} /> {busy ? t('common.wait') : t('scheduleRules.remindN', { n: pending.length })}
        </button>
      )}
      {msg && <p className="desk-note" role="status">{msg}</p>}
    </section>
  )
}

function FineSettingsCard({ t, settings, canEdit, onSaved }) {
  const [v, setV] = useState({ multa_falta: settings.absent, multa_atraso: settings.late, multa_atraso_min: settings.lateEvery, tolerancia_min: settings.tolerance })
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  useEffect(() => { setV({ multa_falta: settings.absent, multa_atraso: settings.late, multa_atraso_min: settings.lateEvery, tolerancia_min: settings.tolerance }) }, [settings.absent, settings.late, settings.lateEvery, settings.tolerance])
  async function save() {
    setBusy(true); setMsg('')
    try {
      const j = await saveFineSettings(v)
      setMsg(t('fines.settingsSaved'))
      onSaved(j.settings)
    } catch (e) {
      setMsg(errText(e))
    } finally {
      setBusy(false)
    }
  }
  const field = (k, label, step = 100) => (
    <label key={k}>
      {label}
      <input type="number" inputMode="numeric" min="0" step={step} value={v[k]} disabled={!canEdit || busy} onChange={e => setV(x => ({ ...x, [k]: e.target.value }))} />
    </label>
  )
  return (
    <section className="desk-card osb-settings">
      <h3><Icon name="settings" size={17} /> {t('fines.settingsTitle')}</h3>
      <p className="desk-note">{t('fines.settingsLead')}</p>
      <div className="house-editor">
        {field('multa_falta', t('fines.setAbsent'))}
        {field('multa_atraso', t('fines.setLate'))}
        {field('multa_atraso_min', t('fines.setLateEvery'), 5)}
        {field('tolerancia_min', t('fines.setTolerance'), 5)}
      </div>
      {canEdit ? <button type="button" className="btn-primary" disabled={busy} onClick={save}>{busy ? t('common.wait') : t('common.save')}</button> : <p className="desk-note">{t('fines.needPayroll')}</p>}
      {msg && <p className="desk-note" role="status">{msg}</p>}
    </section>
  )
}

function FinesList({ t, fines, canEdit, onChanged }) {
  const [busy, setBusy] = useState('')
  const [err, setErr] = useState('')
  async function cancel(f) {
    const note = window.prompt(t('fines.cancelWhy'), '')
    if (note === null) return
    setBusy(f.id); setErr('')
    try { await cancelFine(f.id, note); onChanged() } catch (e) { setErr(errText(e)) } finally { setBusy('') }
  }
  const total = finesTotal(fines)
  return (
    <section className="desk-card osb-fines">
      <div className="osb-head">
        <h3><Icon name="fine" size={17} /> {t('fines.listTitle')}</h3>
        <b className="sa-pill">{fmtYen(total)}</b>
      </div>
      {!fines.length && <div className="osb-empty"><Icon name="ok" size={22} /> {t('fines.none')}</div>}
      {fines.map(f => (
        <div key={f.id} className={`osb-fine${f.status === 'cancelled' ? ' is-cancelled' : ''}`}>
          <div>
            <strong>{f.staff_nome || f.staff_id} · {t(`fines.type_${f.type}`)}</strong>
            <span>{fmtDay(noon(f.day))}{f.note ? ` · ${f.note}` : ''}</span>
            <small>
              {t('fines.by', { who: f.created_by_nome || '—', when: `${fmtDay(f.created_at, { month: 'short', day: 'numeric' })} ${fmtTime(f.created_at)}` })}
              {f.status === 'cancelled' ? ` · ${t('fines.cancelledBy', { who: f.cancelled_by_nome || '—', when: `${fmtDay(f.cancelled_at, { month: 'short', day: 'numeric' })} ${fmtTime(f.cancelled_at)}` })}${f.cancel_note ? ` (${f.cancel_note})` : ''}` : ''}
            </small>
          </div>
          <b>{f.status === 'cancelled' ? <s>{fmtYen(f.amount)}</s> : `−${fmtYen(f.amount)}`}</b>
          {canEdit && f.status !== 'cancelled' && <button type="button" className="ui-btn" disabled={busy === f.id} onClick={() => cancel(f)}>{t('fines.cancel')}</button>}
        </div>
      ))}
      {err && <div className="pos-sale-err" role="alert">{err}</div>}
    </section>
  )
}

/**
 * Owner/manager schedule board (on the time clock page): per night who marked they will come, the confirmed
 * list, attendance against the clock (late / absent) with a one-tap fine, this month's fines and fine settings.
 * `view` shows one part only (schedule, nextWeek, fines, settings; 'home' shows none, the data still loads),
 * `onSummary` gets the numbers for the clock overview, and a new `fineSignal` opens a blank fine.
 */
export default function OwnerSchedule({ view = 'all', onSummary, fineSignal = 0 }) {
  const { t } = useI18n()
  const { perfil } = useAuth()
  const canFine = canAccess(perfil, 'payroll')
  const today = tokyoNightKey()
  const win = scheduleWindow(today)
  const [weekStart, setWeekStart] = useState(win.from)
  const weekEnd = addDays(weekStart, 6)
  const board = useScheduleBoard(weekStart, weekEnd)
  const [team, setTeam] = useState(() => peekBarTeam())
  const [editing, setEditing] = useState('')
  const [fine, setFine] = useState(null)
  const [settings, setSettings] = useState(null)
  const [rules, setRules] = useState(null)
  const month = today.slice(0, 7)
  const [fines, setFines] = useState([])
  const loadFines = useCallback(() => listFines(`${month}-01`, `${month}-31`).then(j => setFines(j.fines || [])).catch(() => setFines([])), [month])

  useEffect(() => { loadBarTeam().then(j => { if (j && !j.error) setTeam(j) }).catch(() => {}) }, [])
  useEffect(() => { loadFines() }, [loadFines])
  useEffect(() => { if (board.data?.settings) setSettings(board.data.settings) }, [board.data])
  useEffect(() => { if (board.data?.rules) setRules(board.data.rules) }, [board.data])

  const roster = rosterOf(team)
  const cfg = settings || fineSettings({})
  const weekFines = board.data?.fines || []
  const finedKey = new Set(weekFines.filter(f => f.status !== 'cancelled').map(f => `${f.staff_id}|${f.day}|${f.type}`))

  useEffect(() => { if (fineSignal && canFine) setFine({ day: today, type: 'other', amount: '', note: '' }) }, [fineSignal]) // eslint-disable-line react-hooks/exhaustive-deps

  // Overview numbers. Tonight and the week's late/absent only come from the current week (the owner can page away).
  const ruleSet = rules || DEFAULT_RULES
  useEffect(() => {
    if (!onSummary) return
    const live = fines.filter(f => f.status !== 'cancelled')
    const out = { fines: { count: live.length, total: finesTotal(fines) }, boardErr: board.err || '', boardLoading: !!board.loading, reloadBoard: board.reload }
    if (board.data && weekStart === win.from) {
      const tonight = board.rows.find(r => r.day === today)
      out.tonight = tonight ? { day: today, count: tonight.count, confirmed: !!tonight.confirmed, marked: tonight.marked.length, attendance: tonight.attendance } : { day: today, count: 0, confirmed: false, marked: 0, attendance: [] }
      out.flagged = board.rows.filter(r => r.day <= today).reduce((n, r) => n + r.attendance.filter(a => a.status === 'late' || a.status === 'absent').length, 0)
    }
    const nw = board.data?.nextWeek
    if (nw) {
      const subs = submissionRows(roster, board.data.availability, ruleSet, nw)
      out.nextWeek = { sent: subs.filter(r => r.sent).length, total: subs.length, deadline: deadlineMs(nw.from, ruleSet) }
    }
    onSummary(out)
  }, [board.data, board.rows, board.err, board.loading, fines, weekStart, team, rules]) // eslint-disable-line react-hooks/exhaustive-deps

  const show = part => view === 'all' || view === part

  function openFine(a) {
    const suggested = suggestFine(a, cfg)
    setFine({
      staff_id: a.id, staff_nome: a.nome, day: a.day, type: a.status === 'late' ? 'late' : a.status === 'absent' ? 'absent' : 'other',
      amount: suggested ? String(suggested) : '', suggested, late_minutes: a.lateMinutes || 0,
      note: a.status === 'late' ? t('fines.lateNote', { min: a.lateMinutes }) : a.status === 'absent' ? t('fines.absentNote') : '',
    })
  }

  return (
    <div className="osb">
      {show('schedule') && <section className="desk-card osb-board" aria-label={t('ownerSchedule.title')}>
        <div className="osb-head">
          <h3><Icon name="calendar" size={17} /> {t('ownerSchedule.title')}</h3>
          <div className="osb-nav">
            <button type="button" className="sa-icon-btn" aria-label={t('staffApp.prev')} onClick={() => setWeekStart(addDays(weekStart, -7))}><Icon name="back" size={18} /></button>
            <strong>{fmtDay(noon(weekStart), { month: 'short', day: 'numeric' })} – {fmtDay(noon(weekEnd), { month: 'short', day: 'numeric' })}</strong>
            <button type="button" className="sa-icon-btn" aria-label={t('staffApp.next')} disabled={weekStart >= addDays(win.to, -6)} onClick={() => setWeekStart(addDays(weekStart, 7))}><Icon name="next" size={18} /></button>
          </div>
        </div>
        <p className="desk-note">{t('ownerSchedule.lead', { min: cfg.tolerance })}</p>
        {board.err && <div className="pos-sale-err">{board.err}</div>}
        {board.loading && !board.data && <p className="desk-note">{t('common.wait')}</p>}
        <div className="osb-days">
          {board.rows.map(row => {
            const flagged = row.attendance.filter(a => a.status === 'late' || a.status === 'absent')
            return (
              <article key={row.day} className={`osb-day${row.day === today ? ' is-today' : ''}${row.day < today ? ' is-past' : ''}`}>
                <header>
                  <span className="sa-datepill"><small>{fmtDay(noon(row.day), { weekday: 'short' })}</small><b>{Number(row.day.slice(8))}</b></span>
                  <div className="osb-day-main">
                    <strong>{t('ownerSchedule.count', { n: row.count })}</strong>
                    <span>{row.confirmed ? <em className="sa-chip is-ok"><Icon name="check" size={12} /> {t('ownerSchedule.confirmed')}</em> : row.marked.length ? <em className="sa-chip">{t('ownerSchedule.notConfirmed')}</em> : null}
                      {flagged.length ? <em className="sa-chip is-bad">{t('ownerSchedule.flagged', { n: flagged.length })}</em> : null}</span>
                  </div>
                  {editing !== row.day && <button type="button" className="ui-btn" onClick={() => setEditing(row.day)}>{row.confirmed ? t('ownerSchedule.adjust') : t('ownerSchedule.confirm')}</button>}
                </header>
                {editing === row.day ? (
                  <ConfirmEditor t={t} row={row} roster={roster} onCancel={() => setEditing('')} onSaved={() => { setEditing(''); board.reload() }} />
                ) : (
                  <ul className="osb-people">
                    {!row.attendance.length && <li className="osb-none">{t('ownerSchedule.nobody')}</li>}
                    {row.attendance.map(a => {
                      const fined = finedKey.has(`${a.id}|${a.day}|${a.status}`)
                      const canSuggest = canFine && (a.status === 'late' || a.status === 'absent')
                      const amount = suggestFine(a, cfg)
                      return (
                        <li key={a.id} className={`is-${a.status}`}>
                          <span className="osb-name">{a.nome || a.id}{a.start ? <small> · {hoursOf(a)}</small> : null}{a.inAt ? <small> · {t('ownerSchedule.in', { time: fmtTime(a.inAt) })}</small> : null}</span>
                          <StatusChip t={t} a={a} />
                          {canSuggest && (fined
                            ? <span className="sa-chip">{t('ownerSchedule.fined')}</span>
                            : <button type="button" className="osb-fine-btn" onClick={() => openFine(a)}><Icon name="fine" size={15} /> {amount ? t('ownerSchedule.fineAmount', { amount: fmtYen(amount) }) : t('ownerSchedule.fine')}</button>)}
                        </li>
                      )
                    })}
                  </ul>
                )}
              </article>
            )
          })}
        </div>
        {canFine && (
          <button type="button" className="ui-btn osb-free-fine" onClick={() => setFine({ day: today, type: 'other', amount: '', note: '' })}>
            <Icon name="plus" size={16} /> {t('fines.newFine')}
          </button>
        )}
      </section>}
      {show('nextWeek') && <SubmissionsCard t={t} roster={roster} availability={board.data?.availability} rules={ruleSet} nextWeek={board.data?.nextWeek} />}
      {show('fines') && <FinesList t={t} fines={fines} canEdit={canFine} onChanged={() => { loadFines(); board.reload() }} />}
      {show('fines') && view !== 'all' && canFine && (
        <button type="button" className="ui-btn osb-free-fine" onClick={() => setFine({ day: today, type: 'other', amount: '', note: '' })}>
          <Icon name="plus" size={16} /> {t('fines.newFine')}
        </button>
      )}
      {show('settings') && <ScheduleRulesCard t={t} rules={ruleSet} onSaved={r => setRules(r)} />}
      {show('settings') && <FineSettingsCard t={t} settings={cfg} canEdit={canFine} onSaved={s => setSettings(s)} />}
      {fine && <FineSheet initial={fine} roster={roster} onClose={() => setFine(null)} onSaved={() => { loadFines(); board.reload() }} />}
    </div>
  )
}

