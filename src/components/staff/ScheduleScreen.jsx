import { useEffect, useMemo, useState } from 'react'
import { scheduleWeeks } from '../../lib/staffSchedule'
import { meAvailability, meSaveAvailability } from '../../lib/staffSelfApi'
import { errText } from '../../lib/errText'
import Icon from '../ui/Icon'
import { Card, Note, Stat, fmtDay } from './staffUi'

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
    .map(([day, v]) => ({ day, start: v?.start || '', confirmed: data.confirmed?.[day] }))
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
            <small>{n.confirmed?.start || n.start ? t('schedule.from', { time: n.confirmed?.start || n.start }) : t('schedule.anyTime')}</small>
          </span>
          <ConfirmChip t={t} c={n.confirmed} />
        </div>
      ))}
    </Card>
  )
}

/**
 * My schedule: the next 4 weeks; I tap the nights I will work (with a start time). A night can change until
 * the bar opens that day; past nights are locked. Saved with meSaveAvailability (own row only, from the session).
 */
export function ScheduleScreen({ t, today, schedule }) {
  const { data, loading, err } = schedule
  const [days, setDays] = useState({})
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [saveErr, setSaveErr] = useState('')
  useEffect(() => { if (data) setDays(data.days || {}) }, [data])

  const editable = useMemo(() => new Set(data?.editable || []), [data])
  const weeks = data ? scheduleWeeks(data.from, data.to) : []
  const defaultStart = `${String(data?.openHour ?? 20).padStart(2, '0')}:00`
  const changed = data ? [...new Set([...Object.keys(days), ...Object.keys(data.days || {})])]
    .filter(d => editable.has(d) && (!!days[d] !== !!data.days?.[d] || (days[d]?.start || '') !== (data.days?.[d]?.start || ''))).length : 0
  const marked = Object.keys(days).filter(d => data && d >= data.from && d <= data.to && d >= today).length
  const confirmedIn = Object.entries(data?.confirmed || {}).filter(([d, c]) => c.in && d >= today).length
  const next = upcomingNights(data && { ...data, days }, today, 1)[0]

  function toggle(day) {
    if (!editable.has(day)) return
    setMsg('')
    setDays(prev => {
      const out = { ...prev }
      if (out[day]) delete out[day]
      else out[day] = { start: data?.days?.[day]?.start || defaultStart }
      return out
    })
  }
  function setStart(day, start) {
    setMsg('')
    setDays(prev => ({ ...prev, [day]: { start } }))
  }
  async function save() {
    setBusy(true); setSaveErr(''); setMsg('')
    try {
      const send = Object.fromEntries(Object.entries(days).filter(([d]) => editable.has(d)))
      const j = await meSaveAvailability(send)
      schedule.setData({ ...data, days: j.days || send })
      setMsg(j.locked?.length ? t('schedule.savedLocked', { n: j.locked.length }) : t('schedule.saved'))
    } catch (e) {
      setSaveErr(errText(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="sa-screen">
      <h1 className="sa-title">{t('schedule.title')}</h1>
      <p className="sa-lead">{t('schedule.lead')}</p>
      <div className="sa-stats">
        <Stat label={t('schedule.statMarked')} value={String(marked)} sub={t('schedule.next4')} />
        <Stat label={t('schedule.statConfirmed')} value={String(confirmedIn)} tone={confirmedIn ? 'good' : undefined} />
        <Stat label={t('schedule.statNext')} value={next ? fmtDay(noon(next.day), { month: 'numeric', day: 'numeric' }) : '—'} sub={next?.start || ''} />
      </div>
      {loading && <Note>{t('common.wait')}</Note>}
      {err && <Note icon="warning">{t('schedule.loadFailed')}</Note>}
      {weeks.map(week => {
        const count = week.filter(d => days[d]).length
        return (
          <Card key={week[0]} title={t('schedule.weekOf', { date: fmtDay(noon(week[0]), { month: 'short', day: 'numeric' }) })} right={<b className="sa-pill">{t('schedule.nights', { n: count })}</b>}>
            <div className="sa-sched">
              {week.map(day => {
                const on = !!days[day]
                const canEdit = editable.has(day)
                const c = data?.confirmed?.[day]
                return (
                  <div key={day} className={`sa-sched-day${on ? ' is-on' : ''}${canEdit ? '' : ' is-locked'}${day === today ? ' is-today' : ''}`}>
                    <span className="sa-datepill"><small>{fmtDay(noon(day), { weekday: 'short' })}</small><b>{Number(day.slice(8))}</b></span>
                    <span className="sa-line-main">
                      <strong>{on ? t('schedule.working') : t('schedule.off')}</strong>
                      <small>{!canEdit ? (day < today ? t('schedule.past') : t('schedule.locked')) : on ? t('schedule.from', { time: days[day].start || defaultStart }) : t('schedule.tapToMark')}</small>
                      {c && (on || c.in) ? <ConfirmChip t={t} c={c} /> : null}
                    </span>
                    {on && canEdit && (
                      <select className="sa-time" aria-label={t('schedule.startAt')} value={days[day].start || ''} onChange={e => setStart(day, e.target.value)}>
                        <option value="">{t('schedule.anyTime')}</option>
                        {START_TIMES.map(tm => <option key={tm} value={tm}>{tm}</option>)}
                      </select>
                    )}
                    <button
                      type="button"
                      role="switch"
                      aria-checked={on}
                      aria-label={`${fmtDay(noon(day), { weekday: 'long', month: 'long', day: 'numeric' })}: ${on ? t('schedule.working') : t('schedule.off')}`}
                      className={`sa-switch${on ? ' is-on' : ''}`}
                      disabled={!canEdit || busy}
                      onClick={() => toggle(day)}
                    >
                      {canEdit ? <span /> : <Icon name="lock" size={16} />}
                    </button>
                  </div>
                )
              })}
            </div>
          </Card>
        )
      })}
      {saveErr && <div className="sa-error" role="alert">{saveErr}</div>}
      {msg && <p className="sa-ok" role="status">{msg}</p>}
      <p className="sa-muted">{t('schedule.footnote', { hour: `${String(data?.openHour ?? 20).padStart(2, '0')}:00` })}</p>
      {data && (
        <div className={`sa-savebar${changed ? ' is-dirty' : ''}`}>
          <button type="button" className="sa-btn is-primary" disabled={!changed || busy} onClick={save}>
            <Icon name="save" size={18} /> {busy ? t('common.wait') : changed ? t('schedule.saveN', { n: changed }) : t('schedule.allSaved')}
          </button>
        </div>
      )}
    </div>
  )
}

