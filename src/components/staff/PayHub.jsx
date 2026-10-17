import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { paymentLabel, statementTotals } from '../../lib/payrollCore'
import { earningsRange, statementInRange } from '../../lib/staffNight'
import { payNet, paymentHistory } from '../../lib/staffFines'
import { addDays, weekdayMon } from '../../lib/staffSchedule'
import { shiftMonthKey, tokyoDateKey, tokyoMonthKey } from '../../lib/tokyo'
import { meEarnings, mePayouts } from '../../lib/staffSelfApi'
import { errText } from '../../lib/errText'
import { getGlobalLang } from '../../lib/i18n'
import { dateLocale } from '../../lib/tokyo'
import { fmtYen } from '../utils'
import { InOutChart, shortNum } from '../ui/Charts'
import Icon from '../ui/Icon'
import { Card, Empty, Note, PageHead, Seg, fmtDay, fmtHours } from './staffUi'

/** "−¥1,200" for a deduction, "¥1,200" otherwise. */
export const signedYen = n => (Math.round(+n || 0) < 0 ? `−${fmtYen(Math.abs(n))}` : fmtYen(n))
const noon = key => `${key}T12:00:00+09:00`

function monthLabel(key, opts = { month: 'long', year: 'numeric' }) {
  const [y, m] = key.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleDateString(dateLocale(getGlobalLang()), { ...opts, timeZone: 'UTC' })
}

function usePackFor(competence, current, initial, initialMissing) {
  const [state, setState] = useState({ pack: current === competence ? initial : null, missing: current === competence ? initialMissing : false })
  useEffect(() => {
    if (competence === current) { setState({ pack: initial, missing: initialMissing }); return undefined }
    let live = true
    supabase.rpc('payroll_my_pack', { p_competence: competence }).then(({ data, error }) => {
      if (!live) return
      setState(error ? { pack: null, missing: true } : { pack: data && typeof data === 'object' ? data : null, missing: false })
    }, () => { if (live) setState({ pack: null, missing: true }) })
    return () => { live = false }
  }, [competence, current, initial, initialMissing])
  return state
}

function useEarnings(from, to) {
  const [state, setState] = useState({ loading: true, data: null, err: '' })
  useEffect(() => {
    let live = true
    setState(s => ({ ...s, loading: true, err: '' }))
    meEarnings(from, to)
      .then(data => { if (live) setState({ loading: false, data, err: '' }) })
      .catch(e => { if (live) setState({ loading: false, data: null, err: errText(e) }) })
    return () => { live = false }
  }, [from, to])
  return state
}

/** Past payments: bar payouts (owner marked paid) and HQ payroll periods (approved/paid) of the last 6 months. */
function usePaymentHistory(current) {
  const [state, setState] = useState({ loading: true, rows: [] })
  useEffect(() => {
    let live = true
    const months = Array.from({ length: 6 }, (_, i) => shiftMonthKey(current, -i))
    const hq = Promise.all(months.map(m => supabase.rpc('payroll_my_pack', { p_competence: m })
      .then(({ data, error }) => {
        const period = !error && data?.period
        if (!period || !['approved', 'paid'].includes(period.status)) return null
        const tot = statementTotals(data.lines || [])
        return { month: m, gross: tot.gross, taken: tot.advances + tot.deductions, net: tot.net, status: period.status, paidAt: period.paid_at || null }
      }, () => null)))
    Promise.all([mePayouts().then(j => j.payouts || []).catch(() => []), hq.catch(() => [])]).then(([payouts, periods]) => {
      if (live) setState({ loading: false, rows: paymentHistory({ payouts, periods: periods.filter(Boolean), limit: 12 }) })
    })
    return () => { live = false }
  }, [current])
  return state
}

function MonthNav({ t, value, onChange }) {
  const now = tokyoMonthKey()
  return (
    <div className="sa-monthnav">
      <button type="button" className="sa-icon-btn" onClick={() => onChange(shiftMonthKey(value, -1))} aria-label={t('staffApp.prev')}><Icon name="back" size={18} /></button>
      <strong>{monthLabel(value)}</strong>
      <button type="button" className="sa-icon-btn" disabled={value >= now} onClick={() => onChange(shiftMonthKey(value, 1))} aria-label={t('staffApp.next')}><Icon name="next" size={18} /></button>
    </div>
  )
}

function LineItem({ icon, tone, title, meta, value, strong }) {
  return (
    <div className={`sa-line${strong ? ' is-total' : ''}`}>
      <span className={`sa-line-icon${tone ? ` is-${tone}` : ''}`}><Icon name={icon} size={18} /></span>
      <span className="sa-line-main"><strong>{title}</strong>{meta ? <small>{meta}</small> : null}</span>
      <b className={`sa-line-value${tone === 'bad' ? ' is-bad' : tone === 'good' ? ' is-good' : ''}`}>{value}</b>
    </div>
  )
}

/** Earned on a day (hours pay + commission) minus that day's active fines. */
function dayNet(d, finesByDay) {
  return (d.hoursPay || 0) + (d.commission || 0) - (finesByDay[d.day] || 0)
}

function Calendar({ t, month, days, finesByDay, attendance, today, onPick }) {
  const first = `${month}-01`
  const byDay = Object.fromEntries((days || []).map(d => [d.day, d]))
  const [y, m] = month.split('-').map(Number)
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const cells = []
  for (let i = 0; i < weekdayMon(first); i++) cells.push(null)
  for (let d = 1; d <= last; d++) cells.push(`${month}-${String(d).padStart(2, '0')}`)
  const heads = Array.from({ length: 7 }, (_, i) => fmtDay(noon(addDays('2024-01-01', i)), { weekday: 'narrow' }))
  return (
    <div className="sa-cal" role="grid" aria-label={t('staffApp.pay.calendar')}>
      {heads.map((h, i) => <span key={`h${i}`} className="sa-cal-head" role="columnheader">{h}</span>)}
      {cells.map((key, i) => {
        if (!key) return <span key={`e${i}`} className="sa-cal-cell is-empty" aria-hidden="true" />
        const d = byDay[key]
        const att = attendance?.[key]
        const fine = finesByDay[key] || 0
        const worked = d && d.hours > 0
        const amount = d ? dayNet(d, finesByDay) : -fine
        const future = key > today
        const marks = []
        if (worked) marks.push('worked')
        if (att?.status === 'absent') marks.push('absent')
        if (att?.status === 'late') marks.push('late')
        if (fine) marks.push('fine')
        return (
          <button
            key={key}
            type="button"
            role="gridcell"
            className={`sa-cal-cell${key === today ? ' is-today' : ''}${future ? ' is-future' : ''}${amount > 0 ? ' has-pay' : ''}`}
            onClick={() => onPick(key)}
            aria-label={`${fmtDay(noon(key), { month: 'short', day: 'numeric' })} ${signedYen(amount)}${marks.length ? ` · ${marks.map(k => t(`staffApp.pay.mark_${k}`)).join(', ')}` : ''}`}
          >
            <span className="sa-cal-num">{Number(key.slice(8))}</span>
            <span className="sa-cal-amt">{amount ? `${amount < 0 ? '−' : ''}${shortNum(Math.abs(amount))}` : ''}</span>
            <span className="sa-cal-dots">{marks.map(k => <i key={k} className={`is-${k}`} />)}</span>
          </button>
        )
      })}
    </div>
  )
}

function DaySheet({ t, day, row, fines, att, rate, onClose }) {
  useEffect(() => {
    const onKey = e => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  const fineSum = fines.filter(f => f.status !== 'cancelled').reduce((s, f) => s + (+f.amount || 0), 0)
  const r = row || { hours: 0, hoursPay: 0, commission: 0, sales: 0, tickets: 0 }
  return (
    <div className="sa-sheet-wrap" role="dialog" aria-modal="true" aria-label={fmtDay(noon(day), { weekday: 'long', month: 'long', day: 'numeric' })} onClick={e => { if (e.target === e.currentTarget) onClose() }}>
      <div className="sa-sheet">
        <div className="sa-sheet-grip" />
        <div className="sa-sheet-head">
          <span className="sa-sheet-icon"><Icon name="calendar" size={22} /></span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <h2>{fmtDay(noon(day), { weekday: 'long', month: 'long', day: 'numeric' })}</h2>
            <p>{att ? t(`staffApp.pay.att_${att.status}`, { min: att.lateMinutes || 0 }) : (r.hours > 0 ? t('staffApp.pay.mark_worked') : t('staffApp.pay.noWork'))}</p>
          </div>
          <button type="button" className="sa-icon-btn sa-sheet-x" onClick={onClose} aria-label={t('common.close')}><Icon name="close" size={20} /></button>
        </div>
        <div className="sa-sheet-body">
          <LineItem icon="clock" title={t('staffApp.pay.hoursPay')} meta={t('staffApp.pay.hoursAt', { hours: fmtHours(r.hours), rate: fmtYen(rate) })} value={fmtYen(r.hoursPay)} />
          <LineItem icon="coins" tone="good" title={t('staffApp.pay.commission')} meta={t('staffApp.out.tickets', { n: r.tickets })} value={fmtYen(r.commission)} />
          {fines.map(f => (
            <LineItem key={f.id} icon="fine" tone={f.status === 'cancelled' ? undefined : 'bad'} title={`${t(`fines.type_${f.type}`)}${f.status === 'cancelled' ? ` · ${t('fines.cancelled')}` : ''}`} meta={f.note || ''} value={f.status === 'cancelled' ? <s>{fmtYen(f.amount)}</s> : signedYen(-f.amount)} />
          ))}
          <LineItem icon="salary" strong title={t('staffApp.pay.dayNet')} value={signedYen(r.hoursPay + r.commission - fineSum)} />
          <p className="sa-muted">{t('staffApp.pay.salesThatDay', { amount: fmtYen(r.sales) })}</p>
        </div>
      </div>
    </div>
  )
}

function PaymentsCard({ t, history }) {
  const rows = history.rows
  const chart = rows.map(r => ({ label: monthLabel(r.month, { month: 'short' }), in: r.gross, out: r.taken }))
  return (
    <Card title={t('staffApp.pay.history')} right={<Icon name="chart" size={18} />}>
      {history.loading ? <Note>{t('common.wait')}</Note> : !rows.length ? (
        <Empty icon="salary" title={t('staffApp.pay.noHistory')} hint={t('staffApp.pay.noHistoryHint')} />
      ) : (
        <>
          <InOutChart data={chart} height={150} format={fmtYen} labels={[t('staffApp.pay.gross'), t('staffApp.pay.deductionsShort')]} />
          <div className="sa-paylist">
            {[...rows].reverse().map(r => (
              <div key={r.month} className="sa-payrow">
                <span className="sa-line-icon is-good"><Icon name="ok" size={18} /></span>
                <span className="sa-line-main">
                  <strong>{monthLabel(r.month)}</strong>
                  <small>{r.paidAt ? t('staffApp.pay.paidOn', { date: fmtDay(r.paidAt, { month: 'short', day: 'numeric' }) }) : t(`employee.status_${paymentLabel(r.status)}`)}{r.taken ? ` · ${t('staffApp.pay.minus', { amount: fmtYen(r.taken) })}` : ''}</small>
                </span>
                <b className="sa-line-value">{signedYen(r.net)}</b>
              </div>
            ))}
          </div>
        </>
      )}
    </Card>
  )
}

/**
 * Pay hub: everything about my pay in one place. Net at the top, the breakdown (hours, commission, rewards,
 * fines, advances), a month calendar of what I earned each night, day by day, and my past payments.
 * Sources: /api/bar-staff meEarnings (clock, till, fines, attendance), mePayouts, payroll_my_pack (HQ lines).
 */
export function PayHubScreen({ t, pack: currentPack, missing: currentMissing, competence: current, onBack }) {
  const today = tokyoDateKey()
  const [kind, setKind] = useState('month')
  const [month, setMonth] = useState(current)
  const [custom, setCustom] = useState({ from: today.slice(0, 8) + '01', to: today })
  const [picked, setPicked] = useState(null)
  const range = kind === 'month' ? earningsRange('month', `${month}-01`) : earningsRange(kind, today, custom)
  const packMonth = kind === 'month' ? month : range.to.slice(0, 7)
  const { pack, missing } = usePackFor(packMonth, current, currentPack, currentMissing)
  const { loading, data, err } = useEarnings(range.from, range.to)
  const history = usePaymentHistory(current)

  const lines = statementInRange(pack?.lines || [], range.from, range.to)
  const tot = data?.totals || { hoursPay: 0, commission: 0, sales: 0, hours: 0, tickets: 0 }
  const fines = data?.fines || []
  const finesByDay = useMemo(() => {
    const out = {}
    for (const f of fines) if (f.status !== 'cancelled') out[f.day] = (out[f.day] || 0) + (+f.amount || 0)
    return out
  }, [fines])
  const fineSum = Object.values(finesByDay).reduce((a, b) => a + b, 0)
  const math = payNet({
    hoursPay: tot.hoursPay, commission: tot.commission, rewards: missing ? 0 : lines.rewards,
    fines: fineSum, advances: missing ? 0 : lines.advances, deductions: missing ? 0 : lines.deductions,
  })
  const payout = history.rows.find(r => r.month === month && r.source === 'bar')
  const status = pack?.period?.status || 'draft'
  const closed = kind === 'month' && (payout || ['approved', 'paid'].includes(status))
  const tag = kind === 'month' && payout
    ? t('staffApp.pay.paidOn', { date: fmtDay(payout.paidAt, { month: 'short', day: 'numeric' }) })
    : closed ? t(`employee.status_${paymentLabel(status)}`) : t('staffApp.pay.estimate')
  const active = (data?.days || []).filter(d => d.hours > 0 || d.commission > 0 || finesByDay[d.day]).reverse()
  const absentCount = Object.values(data?.attendance || {}).filter(a => a.status === 'absent').length
  const lateCount = Object.values(data?.attendance || {}).filter(a => a.status === 'late').length
  const pickedRow = picked ? (data?.days || []).find(d => d.day === picked) : null

  return (
    <div className="sa-screen">
      <PageHead t={t} title={t('staffApp.pay.title')} onBack={onBack} />
      <Seg
        label={t('staffApp.pay.period')}
        value={kind}
        onChange={setKind}
        options={[
          { id: 'day', label: t('staffApp.pay.day') },
          { id: 'week', label: t('staffApp.pay.week') },
          { id: 'month', label: t('staffApp.pay.month') },
          { id: 'custom', label: t('staffApp.pay.custom') },
        ]}
      />
      {kind === 'month' && <MonthNav t={t} value={month} onChange={setMonth} />}
      {kind === 'custom' && (
        <div className="sa-range">
          <label><span>{t('staffApp.pay.from')}</span><input type="date" value={custom.from} max={today} onChange={e => e.target.value && setCustom(c => ({ ...c, from: e.target.value }))} /></label>
          <label><span>{t('staffApp.pay.to')}</span><input type="date" value={custom.to} max={today} onChange={e => e.target.value && setCustom(c => ({ ...c, to: e.target.value }))} /></label>
        </div>
      )}

      <section className="sa-earn" aria-live="polite">
        <span className="sa-earn-range">{range.from === range.to ? fmtDay(noon(range.from)) : `${fmtDay(noon(range.from))} – ${fmtDay(noon(range.to))}`}</span>
        <span className="sa-earn-label">{t('staffApp.pay.netLabel')}</span>
        <strong className="sa-earn-total">{loading ? '…' : signedYen(math.net)}</strong>
        <span className={`sa-earn-tag${closed ? ' is-closed' : ''}`}>{tag}</span>
        <div className="sa-earn-split">
          <span><small>{t('staffApp.pay.gross')}</small><b>{fmtYen(math.gross)}</b></span>
          <span><small>{t('staffApp.pay.deductionsShort')}</small><b>{math.taken ? signedYen(-math.taken) : fmtYen(0)}</b></span>
          <span><small>{t('employee.workedHours')}</small><b>{fmtHours(tot.hours)}</b></span>
        </div>
      </section>
      {err && <Note icon="warning">{t('staffApp.pay.unavailable')}</Note>}
      {(absentCount > 0 || lateCount > 0) && (
        <Note icon="warning">{t('staffApp.pay.attendanceNote', { absent: absentCount, late: lateCount })}</Note>
      )}

      <div className="sa-wide">
        <Card title={t('staffApp.pay.breakdown')}>
          <LineItem icon="clock" title={t('staffApp.pay.hoursPay')} meta={data ? t('staffApp.pay.hoursAt', { hours: fmtHours(tot.hours), rate: fmtYen(data.rate) }) : ''} value={fmtYen(tot.hoursPay)} />
          <LineItem icon="coins" tone="good" title={t('staffApp.pay.commission')} meta={t('staffApp.out.tickets', { n: tot.tickets })} value={fmtYen(tot.commission)} />
          {!missing && <LineItem icon="gift" tone="good" title={t('employee.rewards')} value={fmtYen(lines.rewards)} />}
          <LineItem icon="fine" tone={fineSum ? 'bad' : undefined} title={t('staffApp.pay.fines')} meta={fines.length ? t('staffApp.pay.finesCount', { n: fines.filter(f => f.status !== 'cancelled').length }) : t('staffApp.pay.noFines')} value={fineSum ? signedYen(-fineSum) : fmtYen(0)} />
          {!missing && <LineItem icon="hand" tone={lines.advances ? 'bad' : undefined} title={t('employee.advance')} value={lines.advances ? signedYen(-lines.advances) : fmtYen(0)} />}
          {!missing && lines.deductions > 0 && <LineItem icon="minus2" tone="bad" title={t('employee.deductions')} value={signedYen(-lines.deductions)} />}
          <LineItem icon="salary" strong title={t('staffApp.pay.net')} value={signedYen(math.net)} />
          {missing && <Note>{t('staffApp.payrollSoon')}</Note>}
          {data?.monthly > 0 && <Note>{t('staffApp.pay.monthly', { amount: fmtYen(data.monthly) })}</Note>}
          <p className="sa-muted sa-gap">{t('staffApp.pay.salesCredited', { amount: fmtYen(tot.sales) })}</p>
        </Card>

        {kind === 'month' && (
          <Card className="sa-card-cal" title={t('staffApp.pay.calendar')} right={<span className="sa-cal-legend"><i className="is-worked" />{t('staffApp.pay.mark_worked')} <i className="is-absent" />{t('staffApp.pay.mark_absent')} <i className="is-fine" />{t('staffApp.pay.mark_fine')}</span>}>
            <Calendar t={t} month={month} days={data?.days} finesByDay={finesByDay} attendance={data?.attendance} today={today} onPick={setPicked} />
          </Card>
        )}

        {fines.length > 0 && (
          <Card title={t('staffApp.pay.fines')}>
            {fines.map(f => (
              <LineItem
                key={f.id}
                icon={f.type === 'absent' ? 'absent' : f.type === 'late' ? 'timer' : 'fine'}
                tone={f.status === 'cancelled' ? undefined : 'bad'}
                title={`${t(`fines.type_${f.type}`)} · ${fmtDay(noon(f.day))}`}
                meta={[f.note, f.status === 'cancelled' ? t('fines.cancelled') : ''].filter(Boolean).join(' · ')}
                value={f.status === 'cancelled' ? <s>{fmtYen(f.amount)}</s> : signedYen(-f.amount)}
              />
            ))}
          </Card>
        )}

        <Card title={t('staffApp.pay.byDay')}>
          {loading && <Note>{t('common.wait')}</Note>}
          {!loading && !active.length && (
            <Empty icon="clock" title={t('staffApp.pay.noDays')} hint={t('staffApp.pay.noDaysHint')} />
          )}
          {active.map(d => (
            <button key={d.day} type="button" className="sa-dayrow" onClick={() => setPicked(d.day)}>
              <span className="sa-datepill"><small>{fmtDay(noon(d.day), { weekday: 'short' })}</small><b>{Number(d.day.slice(8))}</b></span>
              <span className="sa-line-main">
                <strong>{d.hours > 0 ? fmtHours(d.hours) : t('staffApp.pay.noWork')}{d.open ? ` · ${t('staffApp.onShift')}` : ''}</strong>
                <small>{[d.commission ? `${t('staffApp.perf.commission')} ${fmtYen(d.commission)}` : '', finesByDay[d.day] ? `${t('staffApp.pay.mark_fine')} ${signedYen(-finesByDay[d.day])}` : ''].filter(Boolean).join(' · ') || fmtYen(d.hoursPay)}</small>
              </span>
              <b className={`sa-line-value${dayNet(d, finesByDay) < 0 ? ' is-bad' : ''}`}>{signedYen(dayNet(d, finesByDay))}</b>
              <Icon name="next" size={16} />
            </button>
          ))}
        </Card>

        <PaymentsCard t={t} history={history} />
      </div>
      <p className="sa-muted">{t('staffApp.pay.footnote')}</p>
      {picked && (
        <DaySheet
          t={t}
          day={picked}
          row={pickedRow}
          fines={fines.filter(f => f.day === picked)}
          att={data?.attendance?.[picked]}
          rate={data?.rate || 0}
          onClose={() => setPicked(null)}
        />
      )}
    </div>
  )
}
