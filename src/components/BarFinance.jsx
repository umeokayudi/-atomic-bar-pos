import { useEffect, useState } from 'react'
import { fmtYen, Spinner } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { invalidateBarTeam, loadBarTeam, peekBarTeam } from '../lib/barTeam'
import { fetchHqSnapshot, peekHqSnapshot } from '../lib/hqSnapshot'
import {
  WEEK,
  lastClosedWeek,
  monthBounds,
  paymentAgenda,
  periodReport,
  salaryBoard,
  stillToSell,
} from '../lib/barClose'
import { tokyoNightKey } from '../lib/tokyo'
import { clockLabel, closeSettings } from '../lib/autoClose'
import { monthRange, payrollFromPunches, clockStaff } from '../lib/timeClock'
import StaffPayCards from './StaffPayCards'
import DayStaffBoard from './DayStaffBoard'
import StaffDayReport from './StaffDayReport'
import BarPayPlan from './BarPayPlan'
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'
import { listFines, listPayouts, markSalaryPaid, unmarkSalaryPaid } from '../lib/staffSelfApi'

function money(n) {
  return fmtYen(Math.round(+n || 0))
}

function CloseHours({ goals, busy, onSave }) {
  const { t } = useI18n()
  const cfg = closeSettings(goals)
  function fromClock(value) {
    const [h, m] = String(value || '00:00').split(':')
    return { hour: h, minute: m }
  }
  return (
    <section className="desk-card">
      <h3>{t('portal.close.autoTitle')}</h3>
      <p className="desk-note">{t('portal.close.autoLead')}</p>
      <div className="house-editor">
        <label>
          {t('portal.close.openAt')}
          <input type="time" defaultValue={clockLabel(cfg.abre, 0)} disabled={busy} onBlur={e => onSave({ abre: fromClock(e.target.value).hour })} />
        </label>
        <label>
          {t('portal.close.splitAt')}
          <input type="time" defaultValue={clockLabel(cfg.corta, 0)} disabled={busy} onBlur={e => onSave({ corta: fromClock(e.target.value).hour })} />
        </label>
        <label>
          {t('portal.close.nightAt')}
          <input
            type="time"
            defaultValue={clockLabel(cfg.horaNoite, cfg.minNoite)}
            disabled={busy}
            onBlur={e => {
              const clock = fromClock(e.target.value)
              onSave({ hora_noite: clock.hour, min_noite: clock.minute, auto_noite: true })
            }}
          />
        </label>
        <label>
          {t('portal.close.dayAt')}
          <input
            type="time"
            defaultValue={clockLabel(cfg.horaDia, cfg.minDia)}
            disabled={busy}
            onBlur={e => {
              const clock = fromClock(e.target.value)
              onSave({ hora_dia: clock.hour, min_dia: clock.minute, auto_dia: true })
            }}
          />
        </label>
      </div>
      <div className="goal-modes">
        <button type="button" className={cfg.autoNoite ? 'is-on' : ''} disabled={busy} onClick={() => onSave({ auto_noite: !cfg.autoNoite })}>
          {t('portal.close.autoNight')} · {cfg.autoNoite ? t('portal.close.autoOn') : t('portal.close.autoOff')}
        </button>
        <button type="button" className={cfg.autoDia ? 'is-on' : ''} disabled={busy} onClick={() => onSave({ auto_dia: !cfg.autoDia })}>
          {t('portal.close.autoDay')} · {cfg.autoDia ? t('portal.close.autoOn') : t('portal.close.autoOff')}
        </button>
        <button
          type="button"
          className={goals?.adicional_noturno !== false ? 'is-on' : ''}
          disabled={busy}
          onClick={() => onSave({ adicional_noturno: goals?.adicional_noturno === false })}
        >
          {t('portal.close.nightPremium')} · {goals?.adicional_noturno !== false ? t('portal.close.nightPremiumOn') : t('portal.close.nightPremiumOff')}
        </button>
      </div>
      <p className="desk-note">
        {t('portal.close.autoHint', {
          night: clockLabel(cfg.horaNoite, cfg.minNoite),
          day: clockLabel(cfg.horaDia, cfg.minDia),
        })}
      </p>
    </section>
  )
}

function CloseDoc({ t, current, previous }) {
  const rows = [
    ['sales', current.sales, previous.sales],
    ['cash', current.tender.cash, previous.tender.cash],
    ['card', current.tender.card, previous.tender.card],
    ['paypay', current.tender.paypay, previous.tender.paypay],
    ['vip', current.vip, previous.vip],
    ['fee', current.fee, previous.fee],
    ['comm', current.comm, previous.comm],
    ['costs', current.allocated, previous.allocated],
    ['accountant', current.accountant, previous.accountant],
    ['tax', current.tax, previous.tax],
    ['net', current.net, previous.net],
  ]
  return (
    <table className="close-doc">
      <thead>
        <tr>
          <th />
          <th>{t('portal.close.now')}</th>
          <th>{t('portal.close.before')}</th>
          <th>{t('portal.close.delta')}</th>
        </tr>
      </thead>
      <tbody>
        {rows.map(([key, now, before]) => {
          const delta = Math.round((+now || 0) - (+before || 0))
          return (
            <tr key={key}>
              <td>{t(`portal.close.${key}`)}</td>
              <td>{money(now)}</td>
              <td>{money(before)}</td>
              <td className={delta > 0 ? 'is-up' : delta < 0 ? 'is-down' : ''}>{delta > 0 ? '+' : ''}{money(delta)}</td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

export default function BarFinance({ bar, section = 'fechamento', onTab }) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(() => !(peekBarTeam() && peekHqSnapshot()))
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState('week')
  const [pack, setPack] = useState(null)
  const [days, setDays] = useState({ dia_mes: 1, dia_salario: 25, dia_drink: 10 })
  const [payExtra, setPayExtra] = useState({ fines: [], payouts: [] })
  const [payBusy, setPayBusy] = useState('')

  // Salary board: this month's fines (taken from pay) and who was already marked paid.
  async function loadPayExtra() {
    if (section !== 'salarios') return
    const month = tokyoNightKey().slice(0, 7)
    const [f, p] = await Promise.all([
      listFines(`${month}-01`, `${month}-31`).then(j => j.fines || []).catch(() => []),
      listPayouts(month).then(j => j.payouts || []).catch(() => []),
    ])
    setPayExtra({ fines: f, payouts: p })
  }
  useEffect(() => { loadPayExtra() }, [bar?.id, section]) // eslint-disable-line react-hooks/exhaustive-deps

  async function markPaid(row, month) {
    setPayBusy(row.id); setErr('')
    try {
      await markSalaryPaid({ month, staff_id: row.id, staff_nome: row.nome, pay: row.pay, comm: row.comm, advances: row.advances })
      await loadPayExtra()
    } catch (e) {
      setErr(errText(e))
    } finally {
      setPayBusy('')
    }
  }
  async function unmarkPaid(row) {
    if (!row.paid?.id) return
    setPayBusy(row.id); setErr('')
    try {
      await unmarkSalaryPaid(row.paid.id)
      await loadPayExtra()
    } catch (e) {
      setErr(errText(e))
    } finally {
      setPayBusy('')
    }
  }

  function packFrom(teamRes, hq) {
    const prev = hq?.prev
    return {
      registry: teamRes.registry || [],
      goals: teamRes.goals || {},
      hq,
      tickets: hq?.pos?.history?.length ? hq.pos.history : (hq?.pos?.tickets || []),
      invoices: hq?.jbm?.openInvoices || [],
      prevHq: prev ? { books: prev.books, payroll: prev.payroll, rent: prev.rent, pos: prev.pos } : null,
      clockReady: !!teamRes.clockReady,
      punches: teamRes.punches || [],
      staff: clockStaff(teamRes.staff),
      punched: teamRes.punched || [],
      sheets: teamRes.sheets || [],
    }
  }

  async function load() {
    const cachedTeam = peekBarTeam()
    const cachedHq = peekHqSnapshot()
    if (cachedTeam && cachedHq) setPack(packFrom(cachedTeam, cachedHq))
    const range = monthRange()
    const [teamRes, hq, clockRes] = await Promise.all([
      loadBarTeam(),
      fetchHqSnapshot().catch(() => cachedHq),
      staffFetch(`/api/time-clock?from=${encodeURIComponent(range.from)}&to=${encodeURIComponent(range.to)}`).then(r => r.json()).catch(() => ({ punches: [] })),
    ])
    if (teamRes.error) throw new Error(errText(teamRes.error))
    const nightPremium = teamRes.goals?.adicional_noturno !== false
    teamRes.clockReady = true
    teamRes.punches = clockRes.punches || []
    teamRes.punched = payrollFromPunches(teamRes.punches, teamRes.staff || [], range, { nightPremium })
    setPack(packFrom(teamRes, hq || cachedHq))
  }

  useEffect(() => {
    if (!pack?.goals) return
    setDays({
      dia_mes: pack.goals.dia_mes || 1,
      dia_salario: pack.goals.dia_salario || 25,
      dia_drink: pack.goals.dia_drink || 10,
    })
  }, [pack?.goals?.dia_mes, pack?.goals?.dia_salario, pack?.goals?.dia_drink])

  useEffect(() => {
    let cancelled = false
    if (!peekBarTeam() || !peekHqSnapshot()) setLoading(true)
    load()
      .catch(e => { if (!cancelled) setErr(errText(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [bar?.id])

  async function saveSettings(patch) {
    setBusy(true)
    setErr('')
    invalidateBarTeam()
    try {
      const r = await staffFetch('/api/bar-staff', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'saveCloseSettings', ...patch }),
      })
      const j = await r.json()
      if (!r.ok || j.error) throw new Error(errText(j.error || j))
      setPack(prev => ({ ...prev, goals: { ...(prev?.goals || {}), ...(j.goals || patch) } }))
    } catch (e) {
      setErr(errText(e))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Spinner text={t('portal.close.loading')} />
  if (!pack) return <div className="house-page"><p>{asReactText(err)}</p></div>

  const night = tokyoNightKey()
  const goals = pack.goals || {}
  const nightPremium = goals.adicional_noturno !== false
  const punched = pack.clockReady
    ? payrollFromPunches(pack.punches || [], pack.staff || [], monthRange(), { nightPremium })
    : (pack.punched || [])
  const closeDay = goals.fecha_semana == null ? 0 : +goals.fecha_semana
  const week = lastClosedWeek(night, closeDay)
  const openEnd = night < week.openEnd ? night : week.openEnd
  const month = monthBounds(night)
  const monthEnd = night < month.end ? night : month.end
  const shared = { tickets: pack.tickets, registry: pack.registry, hq: pack.hq }
  const openReport = periodReport({ ...shared, start: week.openStart, end: openEnd, monthKey: night.slice(0, 7) })
  const closedReport = periodReport({ ...shared, start: week.start, end: week.end, monthKey: week.end.slice(0, 7) })
  const monthReport = periodReport({ ...shared, start: month.start, end: monthEnd, monthKey: night.slice(0, 7) })
  const prevReport = periodReport({
    tickets: pack.prevHq?.pos?.tickets || pack.tickets,
    registry: pack.registry,
    hq: pack.prevHq || pack.hq,
    start: month.prevStart,
    end: month.prevEnd,
    monthKey: month.prevStart.slice(0, 7),
  })
  const current = view === 'month' ? monthReport : openReport
  const previous = view === 'month' ? prevReport : closedReport
  const gap = stillToSell(current.sales, view === 'month' ? goals.lucro : goals.semana)
  const agenda = paymentAgenda({
    registry: pack.registry,
    hq: pack.hq,
    invoices: pack.invoices,
    tickets: pack.tickets,
    goals,
    today: night,
  })
  const board = salaryBoard({
    payroll: punched.length ? punched : (pack.hq?.payroll || []),
    tickets: pack.tickets,
    monthKey: night.slice(0, 7),
    fines: payExtra.fines,
    payouts: payExtra.payouts,
  })

  return (
    <div className="house-page goal-page fade-in">
      <h1>{t(`portal.${section === 'fechamento' ? 'close' : section === 'pagamentos' ? 'pay' : 'salary'}.title`)}</h1>
      <p className="house-lead">{t(`portal.${section === 'fechamento' ? 'close' : section === 'pagamentos' ? 'pay' : 'salary'}.lead`)}</p>
      {err && <p className="desk-note">{asReactText(err)}</p>}

      {section === 'fechamento' && (
        <>
          <DayStaffBoard />
          <section className="desk-card">
            <h3>{t('portal.close.weekday')}</h3>
            <div className="goal-modes">
              {WEEK.map((label, i) => (
                <button key={label} type="button" className={closeDay === i ? 'is-on' : ''} disabled={busy} onClick={() => saveSettings({ fecha_semana: i })}>
                  {t(`portal.close.days.${i}`)}
                </button>
              ))}
            </div>
            <label className="house-month">
              {t('portal.close.monthDay')}
              <input
                type="number"
                min="1"
                max="28"
                value={days.dia_mes}
                onChange={e => setDays(d => ({ ...d, dia_mes: e.target.value }))}
                onBlur={() => saveSettings({ dia_mes: days.dia_mes })}
              />
            </label>
            <p className="desk-note">{t('portal.close.monthHint', { day: goals.dia_mes || 1 })}</p>
          </section>

          <CloseHours goals={goals} busy={busy} onSave={saveSettings} />

          <div className="goal-modes">
            <button type="button" className={view === 'week' ? 'is-on' : ''} onClick={() => setView('week')}>{t('portal.close.week')}</button>
            <button type="button" className={view === 'month' ? 'is-on' : ''} onClick={() => setView('month')}>{t('portal.close.month')}</button>
          </div>

          <div className="goal-hero">
            <div>
              <div className="goal-hero-kicker">{current.start} → {current.end}</div>
              <div className="goal-hero-value">{money(current.net)}</div>
              <div className="goal-hero-goal">{t('portal.close.net')}</div>
              <div className="goal-hero-goal">
                {t('portal.close.profit')} {money(current.profit)}
                {' · '}
                {previous.profit === current.profit
                  ? t('portal.close.flat')
                  : t(current.profit > previous.profit ? 'portal.close.up' : 'portal.close.down', { amount: money(Math.abs(current.profit - previous.profit)) })}
              </div>
              {gap != null && (
                <div className="goal-hero-goal">
                  {gap === 0 ? t('portal.close.hit') : t('portal.close.still', { amount: money(gap) })}
                </div>
              )}
            </div>
          </div>

          <section className="desk-card">
            <p className="desk-note">{previous.start} → {previous.end}</p>
            <CloseDoc t={t} current={current} previous={previous} />
            <p className="desk-note">
              {t('portal.close.ticket')} {money(current.ticket)} · {t('portal.close.count')} {current.count}
              {current.card.nome ? ` · ${current.card.nome}` : ''}
              {' · '}
              {t('portal.close.cardRule', { pct: current.card.pct || 0, days: current.card.days || 0 })}
              {' · '}
              {t('portal.close.cardLanded')} {money(current.card.landed)}
              {' · '}
              {t('portal.close.cardWaiting')} {money(current.card.waiting)}
            </p>
          </section>
        </>
      )}

      {section === 'pagamentos' && (
        <BarPayPlan agenda={agenda} goals={goals} today={night} busy={busy} onSave={saveSettings} onTab={onTab} />
      )}

      {section === 'salarios' && (
        <>
          <StaffDayReport staff={pack.staff} tickets={pack.tickets} sheets={pack.sheets} punches={pack.punches} nightPremium={nightPremium} />
          <div className="goal-hero">
            <div>
              <div className="goal-hero-kicker">{t('portal.salary.total')}</div>
              <div className="goal-hero-value">{money(board.net)}</div>
              <div className="goal-hero-goal">
                {t('payBoard.heroSplit', { gross: money(board.gross), fines: money(board.fines), advances: money(board.advances) })}
              </div>
              <div className="goal-hero-goal">
                {board.save > 0
                  ? t('portal.salary.save', { amount: money(board.save) })
                  : t('portal.salary.ok')}
              </div>
            </div>
          </div>
          <div className="goal-modes">
            <button
              type="button"
              className={nightPremium ? 'is-on' : ''}
              disabled={busy}
              onClick={() => saveSettings({ adicional_noturno: !nightPremium })}
            >
              {t('portal.close.nightPremium')} · {nightPremium ? t('portal.close.nightPremiumOn') : t('portal.close.nightPremiumOff')}
            </button>
          </div>
          <section className="desk-card">
            <StaffPayCards rows={board.rows} showPay nightPremium={nightPremium} busyId={payBusy} onMarkPaid={row => markPaid(row, night.slice(0, 7))} onUnmarkPaid={unmarkPaid} />
            <div className="desk-more" style={{ marginTop: 12 }}>
              <button type="button" onClick={() => onTab?.('staff')}>{t('portal.salary.openStaff')}</button>
              <button type="button" onClick={() => onTab?.('ponto')}>{t('nav.portalClock')}</button>
            </div>
          </section>
        </>
      )}
    </div>
  )
}
