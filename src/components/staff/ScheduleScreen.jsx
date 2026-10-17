import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_RULES, addDays, copyWeekMarks, nightHours, scheduleWeeks, spanLabel, timePresets, weekCheck } from '../../lib/staffSchedule'
import { meAvailability, meSaveAvailability } from '../../lib/staffSelfApi'
import { errText } from '../../lib/errText'
import Icon from '../ui/Icon'
import { Card, Note, fmtDay, fmtTime, useNow } from './staffUi'

const noon = key => `${key}T12:00:00+09:00`
const pad = n => String(n).padStart(2, '0')

/** Start times offered: 16:00 → 03:30 every 30 minutes. */
export const START_TIMES = (() => {
  const out = []
  for (let i = 0; i < 24; i++) {
    const min = 16 * 60 + i * 30
    const h = Math.floor(min / 60) % 24
    out.push(`${pad(h)}:${min % 60 ? '30' : '00'}`)
  }
  return out
})()

/** End times offered: 18:00 → 07:00 every 30 minutes. */
export const END_TIMES = (() => {
  const out = []
  for (let i = 0; i <= 26; i++) {
    const min = 18 * 60 + i * 30
    const h = Math.floor(min / 60) % 24
    out.push(`${pad(h)}:${min % 60 ? '30' : '00'}`)
  }
  return out
})()

const hoursLabel = m => (m?.start ? `${m.start}${m.end ? `–${m.end}` : ''}` : '')
/** "Oct 19 – 25" (same month) or "Oct 26 – Nov 1". */
export const rangeLabel = (from, to) => `${fmtDay(noon(from), { month: 'short', day: 'numeric' })} – ${fmtDay(noon(to), from.slice(0, 7) === to.slice(0, 7) ? { day: 'numeric' } : { month: 'short', day: 'numeric' })}`
const nightsLabel = (t, n) => (n === 1 ? t('schedule.oneNight') : t('schedule.nightsShort', { n }))

/** Loads my marks for the next weeks; `upcoming` = my next marked nights (for Home). */
export function useMySchedule() {
  const [state, setState] = useState({ loading: true, data: null, err: '' })
  const load = () => meAvailability()
    .then(data => setState({ loading: false, data, err: '' }))
    .catch(e => setState({ loading: false, data: null, err: errText(e) }))
  useEffect(() => { load() }, [])
  return { ...state, reload: load, setData: data => setState(s => ({ ...s, data })) }
}

export function upcomingNights(data, today, n = 3) {
  if (!data) return []
  return Object.entries(data.days || {})
    .filter(([d]) => d >= today)
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .slice(0, n)
    .map(([day, v]) => ({ day, start: v?.start || '', end: v?.end || '', confirmed: data.confirmed?.[day] }))
}

/** Next week at a glance: how many nights were sent and how many the owner confirmed. */
export function nextWeekSummary(data) {
  const week = data?.status?.week
  if (!week) return null
  let nights = 0
  let confirmed = 0
  const list = []
  for (let d = week.from; d <= week.to; d = addDays(d, 1)) {
    const on = !!data.days?.[d]
    const c = data.confirmed?.[d]
    if (on) nights++
    if (c?.in) confirmed++
    list.push({ day: d, on, confirmed: !!c?.in })
  }
  return { week, nights, confirmed, list, sent: !!data.status.submitted }
}

function deadlineShort(status) {
  if (!status?.deadline) return ''
  return `${fmtDay(status.deadline, { weekday: 'short' })} ${fmtTime(status.deadline)}`
}

function ConfirmChip({ t, c }) {
  if (!c) return <span className="sa-chip">{t('schedule.waiting')}</span>
  return c.in ? <span className="sa-chip is-ok"><Icon name="check" size={12} /> {t('schedule.confirmed')}</span> : <span className="sa-chip is-outside">{t('schedule.notOnList')}</span>
}

/** Seven small day cells (Mon → Sun): marked nights filled, confirmed ones with a check. */
function WeekStrip({ list }) {
  return (
    <div className="sa-weekstrip" aria-hidden="true">
      {list.map(d => (
        <span key={d.day} className={`${d.on ? 'is-on' : ''}${d.confirmed ? ' is-ok' : ''}`}>
          <small>{fmtDay(noon(d.day), { weekday: 'narrow' })}</small>
          <b>{d.confirmed ? <Icon name="check" size={12} strokeWidth={3} /> : Number(d.day.slice(8))}</b>
        </span>
      ))}
    </div>
  )
}

/**
 * Home: next week not sent yet → one clear call to action that opens the schedule screen.
 * Never the editor itself: Home stays a dashboard.
 */
export function ScheduleCta({ t, schedule, onOpen }) {
  useNow(true, 60000)
  const status = schedule.data?.status
  if (!status?.week || status.submitted) return null
  const late = status.overdue
  return (
    <section className={`sa-cta${late ? ' is-late' : status.remind ? ' is-soon' : ''}`} aria-live="polite">
      <div className="sa-cta-top">
        <span className="sa-cta-icon"><Icon name="calendar" size={24} /></span>
        <div className="sa-cta-text">
          <span className="sa-cta-kicker">{status.mustSend ? t('schedule.ctaRequired') : t('schedule.ctaKicker')}</span>
          <h2>{t('schedule.ctaTitle', { range: rangeLabel(status.week.from, status.week.to) })}</h2>
          <p>
            <Icon name="timer" size={14} />
            {late
              ? t('schedule.ctaLate', { when: deadlineShort(status) })
              : t('schedule.ctaDeadline', { when: deadlineShort(status), left: spanLabel(status.msLeft) })}
          </p>
        </div>
      </div>
      <button type="button" className="sa-btn is-primary sa-cta-btn" onClick={onOpen}>
        <Icon name="send" size={18} /> {t('schedule.ctaButton')}
      </button>
    </section>
  )
}

/** Home: next week's status (when sent) and my next 3 nights. */
export function ScheduleHomeCard({ t, schedule, today, onOpen }) {
  const next = upcomingNights(schedule.data, today)
  const sum = nextWeekSummary(schedule.data)
  return (
    <Card title={t('schedule.nextTitle')} right={<button type="button" className="sa-link" onClick={onOpen}>{t('schedule.edit')}</button>}>
      {sum?.sent && (
        <button type="button" className="sa-weeksum" onClick={onOpen}>
          <span className="sa-weeksum-head">
            <span className="sa-chip is-ok"><Icon name="check" size={12} /> {t('schedule.sentChip')}</span>
            <small>{rangeLabel(sum.week.from, sum.week.to)}</small>
          </span>
          <strong>{t('schedule.sentSummary', { nights: nightsLabel(t, sum.nights), c: sum.confirmed })}</strong>
          <WeekStrip list={sum.list} />
        </button>
      )}
      {schedule.loading ? <Note>{t('common.wait')}</Note> : !next.length ? (
        <button type="button" className="sa-empty is-btn" onClick={onOpen}>
          <Icon name="calendar" size={28} />
          <strong>{t('schedule.noneTitle')}</strong>
          <span>{t('schedule.noneHint')}</span>
        </button>
      ) : next.map(n => (
        <div key={n.day} className="sa-dayrow is-static">
          <span className={`sa-datepill${n.day === today ? ' is-today' : ''}`}><small>{fmtDay(noon(n.day), { weekday: 'short' })}</small><b>{Number(n.day.slice(8))}</b></span>
          <span className="sa-line-main">
            <strong>{n.day === today ? t('schedule.tonight') : fmtDay(noon(n.day), { weekday: 'long', month: 'short', day: 'numeric' })}</strong>
            <small>{hoursLabel(n.confirmed?.start ? n.confirmed : n) || t('schedule.anyTime')}</small>
          </span>
          <ConfirmChip t={t} c={n.confirmed} />
        </div>
      ))}
    </Card>
  )
}

/** Shared editing state of the schedule screen. */
function useScheduleEditor(schedule) {
  const { data } = schedule
  const [days, setDays] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [saveErr, setSaveErr] = useState('')
  useEffect(() => { if (data) setDays(data.days || {}) }, [data])
  const editable = useMemo(() => new Set(data?.editable || []), [data])
  const rules = data?.rules || DEFAULT_RULES

  /** Sets (mark) or clears (null) several nights at once; locked nights are left alone. */
  function setMarks(updates) {
    setMsg(''); setSaveErr('')
    setDays(prev => {
      const out = { ...prev }
      for (const [day, mark] of Object.entries(updates)) {
        if (!editable.has(day)) continue
        if (!mark) delete out[day]
        else out[day] = mark.end ? { start: mark.start, end: mark.end } : { start: mark.start }
      }
      return out
    })
  }
  async function save(t, submitWeek) {
    setBusy(true); setSaveErr(''); setMsg('')
    try {
      const send = Object.fromEntries(Object.entries(days).filter(([d]) => editable.has(d)))
      const j = await meSaveAvailability(send, submitWeek)
      schedule.setData({ ...data, days: j.days || send, weeks: j.weeks || data.weeks, status: j.status ? { ...data.status, ...j.status } : data.status })
      setMsg(submitWeek ? t('schedule.weekSent') : j.locked?.length ? t('schedule.savedLocked', { n: j.locked.length }) : t('schedule.saved'))
      return true
    } catch (e) {
      setSaveErr(errText(e))
      return false
    } finally {
      setBusy(false)
    }
  }
  return { data, days, busy, msg, saveErr, editable, rules, setMarks, save }
}

function weekProblems(t, check, rules) {
  if (!check) return ''
  if (check.tooFew) return t('schedule.needMin', { n: rules.minNights })
  if (check.noStart.length) return t('schedule.needStart', { n: check.noStart.length })
  if (check.noEnd.length) return t('schedule.needEnd', { n: check.noEnd.length })
  return ''
}

/** Bottom sheet for one night (or every marked night of the week): preset chips, or custom start + end. */
function TimeSheet({ t, title, sub, mark, presets, needEnd, canRemove, onSave, onRemove, onClose }) {
  const isPreset = p => mark && p.start === mark.start && p.end === (mark.end || '')
  // New night: first preset ready (one tap to save). Full mark: its preset or custom. Half mark (no end): nothing picked.
  const startPreset = !mark ? 0 : !mark.end && needEnd ? null : presets.findIndex(isPreset)
  const [pick, setPick] = useState(startPreset === null ? null : startPreset >= 0 ? startPreset : 'custom')
  const [start, setStart] = useState(mark?.start || presets[0].start)
  const [end, setEnd] = useState(mark?.end || (mark ? '' : presets[0].end))
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    document.body.classList.add('sa-lock')
    return () => { window.removeEventListener('keydown', onKey); document.body.classList.remove('sa-lock') }
  }, [onClose])
  const choose = i => { setPick(i); if (i !== 'custom') { setStart(presets[i].start); setEnd(presets[i].end) } }
  const ok = !!start && (!needEnd || !!end)
  const len = nightHours(start, end)
  return (
    <div className="sa-sheet-wrap" role="presentation" onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sa-sheet sa-timesheet" role="dialog" aria-modal="true" aria-label={title}>
        <div className="sa-sheet-grip" />
        <header className="sa-timesheet-head">
          <div>
            <h2>{title}</h2>
            {sub && <p>{sub}</p>}
          </div>
          <button type="button" className="sa-icon-btn" onClick={onClose} aria-label={t('common.close')}><Icon name="close" size={20} /></button>
        </header>
        <div className="sa-presets" role="radiogroup" aria-label={t('schedule.pickHours')}>
          {presets.map((p, i) => (
            <button key={`${p.start}-${p.end}`} type="button" role="radio" aria-checked={pick === i} className={pick === i ? 'is-on' : ''} onClick={() => choose(i)}>
              <strong>{p.start} – {p.end}</strong>
              <small>{t('schedule.hoursN', { n: nightHours(p.start, p.end) })}</small>
            </button>
          ))}
          <button type="button" role="radio" aria-checked={pick === 'custom'} className={`is-custom${pick === 'custom' ? ' is-on' : ''}`} onClick={() => choose('custom')}>
            <strong><Icon name="clock" size={16} /> {t('schedule.custom')}</strong>
            <small>{t('schedule.customHint')}</small>
          </button>
        </div>
        {pick === 'custom' && (
          <div className="sa-hours">
            <label>
              <span>{t('schedule.startAt')}</span>
              <select className="sa-time" value={start} onChange={e => setStart(e.target.value)}>
                <option value="">{t('schedule.pick')}</option>
                {START_TIMES.map(tm => <option key={tm} value={tm}>{tm}</option>)}
              </select>
            </label>
            <label>
              <span>{t('schedule.endAt')}{needEnd ? '' : ` ${t('schedule.optional')}`}</span>
              <select className="sa-time" value={end} onChange={e => setEnd(e.target.value)}>
                <option value="">{needEnd ? t('schedule.pick') : t('schedule.noEnd')}</option>
                {END_TIMES.map(tm => <option key={tm} value={tm}>{tm}</option>)}
              </select>
            </label>
          </div>
        )}
        <div className="sa-sheet-actions">
          <button type="button" className="sa-btn is-primary" disabled={!ok} onClick={() => onSave({ start, end })}>
            <Icon name="check" size={18} /> {ok ? t('schedule.saveNight', { time: `${start}${end ? `–${end}` : ''}`, h: len ? ` · ${t('schedule.hoursN', { n: len })}` : '' }) : t('schedule.pickHours')}
          </button>
          {canRemove && (
            <button type="button" className="sa-btn is-ghost sa-btn-off" onClick={onRemove}>
              <Icon name="userOff" size={18} /> {t('schedule.notWorking')}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

/** One night as a tappable card: off (tap to add) or the hours, with the owner's answer. */
function NightCard({ t, day, today, mark, canEdit, confirmed, problem, onOpen }) {
  const on = !!mark
  const label = fmtDay(noon(day), { weekday: 'long', month: 'short', day: 'numeric' })
  return (
    <button
      type="button"
      className={`sa-night${on ? ' is-on' : ''}${canEdit ? '' : ' is-locked'}${day === today ? ' is-today' : ''}${problem ? ' is-problem' : ''}`}
      disabled={!canEdit}
      onClick={() => onOpen(day)}
      aria-label={`${label}: ${on ? hoursLabel(mark) || t('schedule.pickHours') : t('schedule.off')}`}
    >
      <span className="sa-datepill"><small>{fmtDay(noon(day), { weekday: 'short' })}</small><b>{Number(day.slice(8))}</b></span>
      <span className="sa-line-main">
        <strong>{day === today ? t('schedule.tonight') : fmtDay(noon(day), { weekday: 'long' })}</strong>
        <small>
          {!canEdit ? (day < today ? t('schedule.past') : t('schedule.locked'))
            : on ? (problem ? t('schedule.pickHours') : t('schedule.working'))
              : t('schedule.tapToAdd')}
        </small>
      </span>
      {on ? (
        <span className="sa-night-right">
          <b className="sa-night-time">{hoursLabel(mark) || '—'}</b>
          {confirmed ? <ConfirmChip t={t} c={confirmed} /> : null}
        </span>
      ) : !canEdit ? <Icon name="lock" size={16} /> : <span className="sa-night-add"><Icon name="plus" size={18} /></span>}
    </button>
  )
}

/**
 * My schedule: one week at a time; each night is a card, tapping it opens a sheet with one-tap hours.
 * Shortcuts: copy last week, same time for every marked night. A sticky footer sends next week (the owner's deadline)
 * or saves changes. Saved with meSaveAvailability (own row only, from the session); server rules unchanged.
 */
export function ScheduleScreen({ t, today, schedule, onBack }) {
  const { loading, err } = schedule
  const ed = useScheduleEditor(schedule)
  const { data, days, editable } = ed
  useNow(true, 60000)
  const weeks = useMemo(() => (data ? scheduleWeeks(data.from, data.to) : []), [data])
  const status = data?.status
  const nextFrom = status?.week?.from
  const nextIdx = Math.max(0, weeks.findIndex(w => w[0] === nextFrom))
  const [weekIdx, setWeekIdx] = useState(null)
  const [sheet, setSheet] = useState(null) // { day } | { all: true }
  const [justSent, setJustSent] = useState(false)
  const idx = weekIdx ?? (status && !status.submitted ? nextIdx : 0)
  const week = weeks[idx] || []

  const presets = useMemo(() => timePresets(data?.openHour ?? 20), [data?.openHour])
  const changed = data ? [...new Set([...Object.keys(days), ...Object.keys(data.days || {})])]
    .filter(d => editable.has(d) && (!!days[d] !== !!data.days?.[d] || (days[d]?.start || '') !== (data.days?.[d]?.start || '') || (days[d]?.end || '') !== (data.days?.[d]?.end || ''))).length : 0
  const nextCheck = status?.week ? weekCheck(days, { ...status.week, rules: ed.rules }) : null
  const sent = !!data?.weeks?.[nextFrom]?.submitted_at && nextCheck?.ok
  const weekCheckSel = week.length ? weekCheck(days, { from: week[0], to: week[week.length - 1], rules: ed.rules }) : null
  const bad = new Set([...(weekCheckSel?.noStart || []), ...(weekCheckSel?.noEnd || [])])
  const markedInWeek = week.filter(d => days[d] && editable.has(d))
  const prevWeek = idx > 0 ? weeks[idx - 1] : null
  const canCopy = !!prevWeek && prevWeek.some(d => days[d]) && week.some(d => editable.has(d))

  function copyLastWeek() {
    ed.setMarks(copyWeekMarks(days, prevWeek, week, editable))
  }
  async function send() {
    const ok = await ed.save(t, nextFrom)
    if (ok) setJustSent(true)
  }

  if (justSent && sent) {
    const sum = nextWeekSummary({ ...data, days })
    return (
      <div className="sa-screen">
        <section className="sa-done" role="status">
          <span className="sa-done-icon"><Icon name="ok" size={40} /></span>
          <h1>{t('schedule.doneTitle')}</h1>
          <p>{t('schedule.doneLead', { nights: nightsLabel(t, sum?.nights || 0), range: rangeLabel(status.week.from, status.week.to) })}</p>
          {sum && <WeekStrip list={sum.list} />}
          <div className="sa-done-actions">
            <button type="button" className="sa-btn is-primary" onClick={onBack}><Icon name="home" size={18} /> {t('schedule.backHome')}</button>
            <button type="button" className="sa-btn" onClick={() => setJustSent(false)}><Icon name="edit" size={18} /> {t('schedule.keepEditing')}</button>
          </div>
        </section>
      </div>
    )
  }

  const sheetDay = sheet?.day
  return (
    <div className="sa-screen sa-schedule">
      <header className="sa-pagehead">
        {onBack && <button type="button" className="sa-icon-btn" onClick={onBack} aria-label={t('staffApp.tabHome')}><Icon name="back" size={20} /></button>}
        <div>
          <h1 className="sa-title">{t('schedule.title')}</h1>
          <p className="sa-muted">{t('schedule.leadShort')}</p>
        </div>
      </header>

      {status?.week && (
        <div className={`sa-banner ${sent ? 'is-ok' : status.overdue ? 'is-bad' : 'is-warn'}`} role="status">
          <Icon name={sent ? 'ok' : 'timer'} size={20} />
          <span>
            <strong>{sent ? t('schedule.nextSent') : t('schedule.ctaTitle', { range: rangeLabel(status.week.from, status.week.to) })}</strong>
            <small>{sent ? t('schedule.nextSentHint') : status.overdue ? t('schedule.ctaLate', { when: deadlineShort(status) }) : t('schedule.ctaDeadline', { when: deadlineShort(status), left: spanLabel(status.msLeft) })}</small>
          </span>
        </div>
      )}

      {loading && <Note>{t('common.wait')}</Note>}
      {err && <Note icon="warning">{t('schedule.loadFailed')}</Note>}

      {weeks.length > 0 && (
        <div className="sa-weektabs" role="tablist" aria-label={t('schedule.title')}>
          {weeks.map((w, i) => {
            const n = w.filter(d => days[d]).length
            return (
              <button key={w[0]} type="button" role="tab" aria-selected={i === idx} className={`${i === idx ? 'is-on' : ''}${w[0] === nextFrom ? ' is-next' : ''}`} onClick={() => setWeekIdx(i)}>
                <small>{w[0] === nextFrom ? t('schedule.nextWeekTab') : i === 0 ? t('schedule.thisWeek') : t('schedule.weekN', { n: i + 1 })}</small>
                <strong>{fmtDay(noon(w[0]), { month: 'numeric', day: 'numeric' })}</strong>
                <em>{nightsLabel(t, n)}</em>
              </button>
            )
          })}
        </div>
      )}

      {week.length > 0 && (
        <div className="sa-shortcuts">
          <button type="button" className="sa-btn" disabled={!canCopy || ed.busy} onClick={copyLastWeek}>
            <Icon name="copy" size={17} /> {t('schedule.copyLast')}
          </button>
          <button type="button" className="sa-btn" disabled={!markedInWeek.length || ed.busy} onClick={() => setSheet({ all: true })}>
            <Icon name="clock" size={17} /> {t('schedule.sameTime')}
          </button>
        </div>
      )}

      {week.length > 0 && (
        <div className="sa-nights">
          {week.map(day => (
            <NightCard
              key={day} t={t} day={day} today={today} mark={days[day]} canEdit={editable.has(day) && !ed.busy}
              confirmed={data?.confirmed?.[day]} problem={bad.has(day)} onOpen={d => setSheet({ day: d })}
            />
          ))}
        </div>
      )}

      {week[0] === nextFrom && weekCheckSel?.nights === 0 && ed.rules.minNights === 0 && <Note icon="info">{t('schedule.zeroOk')}</Note>}
      {ed.saveErr && <div className="sa-error" role="alert">{ed.saveErr}</div>}
      {ed.msg && <p className="sa-ok" role="status">{ed.msg}</p>}
      <p className="sa-muted">{t('schedule.footnote', { hour: `${pad(data?.openHour ?? 20)}:00` })}</p>

      {data && (
        <div className={`sa-savebar${changed || !sent ? ' is-dirty' : ''}`}>
          {!sent && nextFrom && (nextCheck?.ok || !changed) ? (<>
            {weekProblems(t, nextCheck, ed.rules) && <p className="sa-savebar-why">{weekProblems(t, nextCheck, ed.rules)}</p>}
            <button type="button" className="sa-btn is-primary" disabled={ed.busy || !nextCheck?.ok} onClick={send}>
              <Icon name="send" size={18} /> {ed.busy ? t('common.wait') : t('schedule.sendSchedule', { nights: nightsLabel(t, nextCheck?.nights || 0) })}
            </button>
          </>) : (
            <button type="button" className="sa-btn is-primary" disabled={!changed || ed.busy} onClick={() => ed.save(t)}>
              <Icon name="save" size={18} /> {ed.busy ? t('common.wait') : changed ? t('schedule.saveN', { n: changed }) : t('schedule.allSaved')}
            </button>
          )}
        </div>
      )}

      {sheet && (
        <TimeSheet
          key={sheetDay || 'all'}
          t={t}
          title={sheetDay ? fmtDay(noon(sheetDay), { weekday: 'long', month: 'long', day: 'numeric' }) : t('schedule.sameTime')}
          sub={sheetDay ? t('schedule.sheetLead') : t('schedule.sameTimeLead', { n: markedInWeek.length })}
          mark={sheetDay ? days[sheetDay] : days[markedInWeek[0]]}
          presets={presets}
          needEnd={ed.rules.needEnd}
          canRemove={!!(sheetDay && days[sheetDay])}
          onClose={() => setSheet(null)}
          onRemove={() => { ed.setMarks({ [sheetDay]: null }); setSheet(null) }}
          onSave={mark => {
            ed.setMarks(sheetDay ? { [sheetDay]: mark } : Object.fromEntries(markedInWeek.map(d => [d, mark])))
            setSheet(null)
          }}
        />
      )}
    </div>
  )
}
