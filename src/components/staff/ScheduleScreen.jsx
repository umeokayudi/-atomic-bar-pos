import { useEffect, useMemo, useState } from 'react'
import { DEFAULT_RULES, WEEKDAY_KEYS, addDays, scheduleWeeks, spanLabel, weekCheck } from '../../lib/staffSchedule'
import { meAvailability, meSaveAvailability } from '../../lib/staffSelfApi'
import { errText } from '../../lib/errText'
import Icon from '../ui/Icon'
import { Card, Note, Stat, fmtDay, fmtTime, useNow } from './staffUi'

const noon = key => `${key}T12:00:00+09:00`

/** Start times offered: 16:00 → 03:30 every 30 minutes. */
export const START_TIMES = (() => {
  const out = []
  for (let i = 0; i < 24; i++) {
    const min = 16 * 60 + i * 30
    const h = Math.floor(min / 60) % 24
    out.push(`${String(h).padStart(2, '0')}:${min % 60 ? '30' : '00'}`)
  }
  return out
})()

/** End times offered: 18:00 → 07:00 every 30 minutes. */
export const END_TIMES = (() => {
  const out = []
  for (let i = 0; i <= 26; i++) {
    const min = 18 * 60 + i * 30
    const h = Math.floor(min / 60) % 24
    out.push(`${String(h).padStart(2, '0')}:${min % 60 ? '30' : '00'}`)
  }
  return out
})()

const hoursLabel = m => (m?.start ? `${m.start}${m.end ? `–${m.end}` : ''}` : '')

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

function ConfirmChip({ t, c }) {
  if (!c) return <span className="sa-chip">{t('schedule.waiting')}</span>
  return c.in ? <span className="sa-chip is-ok"><Icon name="check" size={12} /> {t('schedule.confirmed')}</span> : <span className="sa-chip is-outside">{t('schedule.notOnList')}</span>
}

/** Home card: my next nights and a way to mark more. */
export function NextShiftsCard({ t, schedule, today, onOpen }) {
  const next = upcomingNights(schedule.data, today)
  return (
    <Card title={t('schedule.nextTitle')} right={<button type="button" className="sa-link" onClick={onOpen}>{t('schedule.edit')}</button>}>
      {schedule.loading ? <Note>{t('common.wait')}</Note> : !next.length ? (
        <button type="button" className="sa-empty is-btn" onClick={onOpen}>
          <Icon name="calendar" size={28} />
          <strong>{t('schedule.noneTitle')}</strong>
          <span>{t('schedule.noneHint')}</span>
        </button>
      ) : next.map(n => (
        <div key={n.day} className="sa-dayrow is-static">
          <span className="sa-datepill"><small>{fmtDay(noon(n.day), { weekday: 'short' })}</small><b>{Number(n.day.slice(8))}</b></span>
          <span className="sa-line-main">
            <strong>{n.day === today ? t('schedule.tonight') : fmtDay(noon(n.day), { month: 'short', day: 'numeric' })}</strong>
            <small>{hoursLabel(n.confirmed?.start ? n.confirmed : n) || t('schedule.anyTime')}</small>
          </span>
          <ConfirmChip t={t} c={n.confirmed} />
        </div>
      ))}
    </Card>
  )
}

/** One night: date, working/off switch, start and end time. */
function DayRow({ t, day, today, mark, canEdit, busy, confirmed, defaultStart, needEnd, problem, onToggle, onChange }) {
  const on = !!mark
  return (
    <div className={`sa-sched-day${on ? ' is-on' : ''}${canEdit ? '' : ' is-locked'}${day === today ? ' is-today' : ''}${problem ? ' is-problem' : ''}`}>
      <span className="sa-datepill"><small>{fmtDay(noon(day), { weekday: 'short' })}</small><b>{Number(day.slice(8))}</b></span>
      <span className="sa-line-main">
        <strong>{on ? t('schedule.working') : t('schedule.off')}</strong>
        <small>{!canEdit ? (day < today ? t('schedule.past') : t('schedule.locked')) : on ? (hoursLabel(mark) ? t('schedule.from', { time: hoursLabel(mark) }) : t('schedule.pickHours')) : t('schedule.tapToMark')}</small>
        {confirmed && (on || confirmed.in) ? <ConfirmChip t={t} c={confirmed} /> : null}
      </span>
      <button
        type="button"
        role="switch"
        aria-checked={on}
        aria-label={`${fmtDay(noon(day), { weekday: 'long', month: 'long', day: 'numeric' })}: ${on ? t('schedule.working') : t('schedule.off')}`}
        className={`sa-switch${on ? ' is-on' : ''}`}
        disabled={!canEdit || busy}
        onClick={() => onToggle(day)}
      >
        {canEdit ? <span /> : <Icon name="lock" size={16} />}
      </button>
      {on && canEdit && (
        <div className="sa-hours">
          <label>
            <span>{t('schedule.startAt')}</span>
            <select className="sa-time" value={mark.start || ''} onChange={e => onChange(day, { ...mark, start: e.target.value })}>
              <option value="">{t('schedule.pick')}</option>
              {START_TIMES.map(tm => <option key={tm} value={tm}>{tm}</option>)}
            </select>
          </label>
          <label>
            <span>{t('schedule.endAt')}{needEnd ? '' : ` ${t('schedule.optional')}`}</span>
            <select className="sa-time" value={mark.end || ''} onChange={e => onChange(day, { ...mark, end: e.target.value })}>
              <option value="">{needEnd ? t('schedule.pick') : t('schedule.noEnd')}</option>
              {END_TIMES.map(tm => <option key={tm} value={tm}>{tm}</option>)}
            </select>
          </label>
        </div>
      )}
    </div>
  )
}

/** Shared editing state for the schedule and the "send next week" gate. */
function useScheduleEditor(schedule) {
  const { data } = schedule
  const [days, setDays] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [saveErr, setSaveErr] = useState('')
  useEffect(() => { if (data) setDays(data.days || {}) }, [data])
  const editable = useMemo(() => new Set(data?.editable || []), [data])
  const defaultStart = `${String(data?.openHour ?? 20).padStart(2, '0')}:00`
  const rules = data?.rules || DEFAULT_RULES

  function toggle(day) {
    if (!editable.has(day)) return
    setMsg(''); setSaveErr('')
    setDays(prev => {
      const out = { ...prev }
      if (out[day]) delete out[day]
      else out[day] = { start: data?.days?.[day]?.start || defaultStart, ...(data?.days?.[day]?.end ? { end: data.days[day].end } : {}) }
      return out
    })
  }
  function change(day, mark) {
    setMsg(''); setSaveErr('')
    setDays(prev => ({ ...prev, [day]: mark.end ? { start: mark.start, end: mark.end } : { start: mark.start } }))
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
  return { data, days, busy, msg, saveErr, editable, defaultStart, rules, toggle, change, save }
}

function deadlineText(t, status) {
  if (!status?.deadline) return ''
  const when = `${fmtDay(status.deadline, { weekday: 'short', month: 'numeric', day: 'numeric' })} ${fmtTime(status.deadline)}`
  return status.msLeft > 0 ? t('schedule.deadlineIn', { when, left: spanLabel(status.msLeft) }) : t('schedule.deadlinePassed', { when })
}

function RulesHint({ t, rules }) {
  const bits = [t('schedule.ruleHours')]
  if (rules.minNights > 0) bits.push(t('schedule.ruleMin', { n: rules.minNights }))
  bits.push(t('schedule.ruleDeadline', { day: t(`schedule.wd_${WEEKDAY_KEYS[rules.deadlineDay]}`), hour: `${String(rules.deadlineHour).padStart(2, '0')}:00` }))
  return <ul className="sa-rules">{bits.map(b => <li key={b}><Icon name="check" size={14} /> {b}</li>)}</ul>
}

function weekProblems(t, check, rules) {
  if (!check) return ''
  if (check.tooFew) return t('schedule.needMin', { n: rules.minNights })
  if (check.noStart.length) return t('schedule.needStart', { n: check.noStart.length })
  if (check.noEnd.length) return t('schedule.needEnd', { n: check.noEnd.length })
  return ''
}

/**
 * Required before the rest of the app: send next week (Mon–Sun) with a start and end time on every night.
 * Shown by StaffApp while the bar requires it and next week is not sent. The clock card stays above it.
 */
export function NextWeekGate({ t, today, schedule, top = null }) {
  const ed = useScheduleEditor(schedule)
  useNow(true, 30000)
  const status = ed.data?.status
  const week = status?.week
  if (!week) return null
  const list = []
  for (let d = week.from; d <= week.to; d = addDays(d, 1)) list.push(d)
  const check = weekCheck(ed.days, { ...week, rules: ed.rules })
  const problem = weekProblems(t, check, ed.rules)
  const bad = new Set([...check.noStart, ...check.noEnd])
  return (
    <div className="sa-screen sa-gate">
      {top}
      <section className={`sa-gate-head${status.overdue ? ' is-late' : ''}`}>
        <span className="sa-gate-icon"><Icon name="calendar" size={26} /></span>
        <div>
          <h1>{t('schedule.gateTitle')}</h1>
          <p>{t('schedule.gateLead', { from: fmtDay(noon(week.from), { month: 'short', day: 'numeric' }), to: fmtDay(noon(week.to), { month: 'short', day: 'numeric' }) })}</p>
          <strong className="sa-gate-deadline"><Icon name="timer" size={15} /> {deadlineText(t, status)}</strong>
        </div>
      </section>
      <RulesHint t={t} rules={ed.rules} />
      <Card title={t('schedule.weekOf', { date: fmtDay(noon(week.from), { month: 'short', day: 'numeric' }) })} right={<b className="sa-pill">{t('schedule.nights', { n: check.nights })}</b>}>
        <div className="sa-sched">
          {list.map(day => (
            <DayRow
              key={day} t={t} day={day} today={today} mark={ed.days[day]} canEdit={ed.editable.has(day)} busy={ed.busy}
              confirmed={ed.data?.confirmed?.[day]} defaultStart={ed.defaultStart} needEnd={ed.rules.needEnd} problem={bad.has(day)}
              onToggle={ed.toggle} onChange={ed.change}
            />
          ))}
        </div>
      </Card>
      {check.nights === 0 && ed.rules.minNights === 0 && <Note icon="info">{t('schedule.zeroOk')}</Note>}
      {ed.saveErr && <div className="sa-error" role="alert">{ed.saveErr}</div>}
      <div className="sa-savebar is-dirty is-gate">
        {problem && <p className="sa-savebar-why">{problem}</p>}
        <button type="button" className="sa-btn is-primary" disabled={!!problem || ed.busy} onClick={() => ed.save(t, week.from)}>
          <Icon name="send" size={18} /> {ed.busy ? t('common.wait') : t('schedule.sendWeek', { n: check.nights })}
        </button>
      </div>
    </div>
  )
}

/**
 * My schedule: the next 4 weeks; I tap the nights I will work (with a start and end time). A night can change until
 * the bar opens that day; past nights are locked. Saved with meSaveAvailability (own row only, from the session).
 * Next week is "sent" separately (the owner's deadline); changing it after keeps it sent while it follows the rules.
 */
export function ScheduleScreen({ t, today, schedule }) {
  const { loading, err } = schedule
  const ed = useScheduleEditor(schedule)
  const { data, days, editable } = ed
  const weeks = data ? scheduleWeeks(data.from, data.to) : []
  const changed = data ? [...new Set([...Object.keys(days), ...Object.keys(data.days || {})])]
    .filter(d => editable.has(d) && (!!days[d] !== !!data.days?.[d] || (days[d]?.start || '') !== (data.days?.[d]?.start || '') || (days[d]?.end || '') !== (data.days?.[d]?.end || ''))).length : 0
  const marked = Object.keys(days).filter(d => data && d >= data.from && d <= data.to && d >= today).length
  const confirmedIn = Object.entries(data?.confirmed || {}).filter(([d, c]) => c.in && d >= today).length
  const next = upcomingNights(data && { ...data, days }, today, 1)[0]
  const status = data?.status
  const nextFrom = status?.week?.from
  const nextCheck = status?.week ? weekCheck(days, { ...status.week, rules: ed.rules }) : null
  const sent = !!data?.weeks?.[nextFrom]?.submitted_at && nextCheck?.ok

  return (
    <div className="sa-screen">
      <h1 className="sa-title">{t('schedule.title')}</h1>
      <p className="sa-lead">{t('schedule.lead')}</p>
      {status?.week && (
        <div className={`sa-banner ${sent ? 'is-ok' : status.overdue ? 'is-bad' : 'is-warn'}`} role="status">
          <Icon name={sent ? 'ok' : 'timer'} size={18} />
          <span>
            <strong>{sent ? t('schedule.nextSent') : t('schedule.nextNotSent')}</strong>
            <small>{sent ? t('schedule.nextSentHint') : deadlineText(t, status)}</small>
          </span>
        </div>
      )}
      <div className="sa-stats">
        <Stat label={t('schedule.statMarked')} value={String(marked)} sub={t('schedule.next4')} />
        <Stat label={t('schedule.statConfirmed')} value={String(confirmedIn)} tone={confirmedIn ? 'good' : undefined} />
        <Stat label={t('schedule.statNext')} value={next ? fmtDay(noon(next.day), { month: 'numeric', day: 'numeric' }) : '—'} sub={hoursLabel(next)} />
      </div>
      {loading && <Note>{t('common.wait')}</Note>}
      {err && <Note icon="warning">{t('schedule.loadFailed')}</Note>}
      {weeks.map(week => {
        const count = week.filter(d => days[d]).length
        const isNext = week[0] === nextFrom
        return (
          <Card
            key={week[0]}
            className={isNext ? 'is-next-week' : ''}
            title={`${t('schedule.weekOf', { date: fmtDay(noon(week[0]), { month: 'short', day: 'numeric' }) })}${isNext ? ` · ${t('schedule.nextWeek')}` : ''}`}
            right={<b className="sa-pill">{t('schedule.nights', { n: count })}</b>}
          >
            <div className="sa-sched">
              {week.map(day => (
                <DayRow
                  key={day} t={t} day={day} today={today} mark={days[day]} canEdit={editable.has(day)} busy={ed.busy}
                  confirmed={data?.confirmed?.[day]} defaultStart={ed.defaultStart} needEnd={ed.rules.needEnd}
                  onToggle={ed.toggle} onChange={ed.change}
                />
              ))}
            </div>
          </Card>
        )
      })}
      {ed.saveErr && <div className="sa-error" role="alert">{ed.saveErr}</div>}
      {ed.msg && <p className="sa-ok" role="status">{ed.msg}</p>}
      <p className="sa-muted">{t('schedule.footnote', { hour: `${String(data?.openHour ?? 20).padStart(2, '0')}:00` })}</p>
      {data && (
        <div className={`sa-savebar${changed || !sent ? ' is-dirty' : ''}`}>
          {!sent && nextFrom && (nextCheck?.ok || !changed) ? (
            <button type="button" className="sa-btn is-primary" disabled={ed.busy || !nextCheck?.ok} onClick={() => ed.save(t, nextFrom)}>
              <Icon name="send" size={18} /> {ed.busy ? t('common.wait') : nextCheck?.ok ? t('schedule.saveAndSend') : weekProblems(t, nextCheck, ed.rules)}
            </button>
          ) : (
            <button type="button" className="sa-btn is-primary" disabled={!changed || ed.busy} onClick={() => ed.save(t)}>
              <Icon name="save" size={18} /> {ed.busy ? t('common.wait') : changed ? t('schedule.saveN', { n: changed }) : t('schedule.allSaved')}
            </button>
          )}
        </div>
      )}
    </div>
  )
}
