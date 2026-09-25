import { useEffect, useState } from 'react'
import { fmtYen, Spinner } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { invalidateBarTeam, loadBarTeam, peekBarTeam } from '../lib/barTeam'
import { fetchHqSnapshot, peekHqSnapshot } from '../lib/hqSnapshot'
import {
  WEEK,
  addDays,
  lastClosedWeek,
  monthBounds,
  paymentAgenda,
  periodReport,
  salaryBoard,
  stillToSell,
  weekdayOf,
} from '../lib/barClose'
import { tokyoNightKey } from '../lib/tokyo'
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'

function money(n) {
  return fmtYen(Math.round(+n || 0))
}

function mondayOf(date) {
  const wd = weekdayOf(date)
  return addDays(date, wd === 0 ? -6 : 1 - wd)
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

  function packFrom(teamRes, hq) {
    const prev = hq?.prev
    return {
      registry: teamRes.registry || [],
      goals: teamRes.goals || {},
      hq,
      tickets: hq?.pos?.history?.length ? hq.pos.history : (hq?.pos?.tickets || []),
      invoices: hq?.jbm?.openInvoices || [],
      prevHq: prev ? { books: prev.books, payroll: prev.payroll, rent: prev.rent, pos: prev.pos } : null,
    }
  }

  async function load() {
    const cachedTeam = peekBarTeam()
    const cachedHq = peekHqSnapshot()
    if (cachedTeam && cachedHq) setPack(packFrom(cachedTeam, cachedHq))
    const [teamRes, hq] = await Promise.all([
      loadBarTeam(),
      fetchHqSnapshot().catch(() => cachedHq),
    ])
    if (teamRes.error) throw new Error(errText(teamRes.error))
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
    payroll: pack.hq?.payroll || [],
    tickets: pack.tickets,
    monthKey: night.slice(0, 7),
  })

  return (
    <div className="house-page goal-page fade-in">
      <h1>{t(`portal.${section === 'fechamento' ? 'close' : section === 'pagamentos' ? 'pay' : 'salary'}.title`)}</h1>
      <p className="house-lead">{t(`portal.${section === 'fechamento' ? 'close' : section === 'pagamentos' ? 'pay' : 'salary'}.lead`)}</p>
      {err && <p className="desk-note">{asReactText(err)}</p>}

      {section === 'fechamento' && (
        <>
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
        <>
          <section className="desk-card">
            <div className="house-editor">
              <label>
                {t('portal.pay.salaryDay')}
                <input type="number" min="1" max="28" value={days.dia_salario} onChange={e => setDays(d => ({ ...d, dia_salario: e.target.value }))} onBlur={() => saveSettings({ dia_salario: days.dia_salario })} />
              </label>
              <label>
                {t('portal.pay.drinkDay')}
                <input type="number" min="1" max="28" value={days.dia_drink} onChange={e => setDays(d => ({ ...d, dia_drink: e.target.value }))} onBlur={() => saveSettings({ dia_drink: days.dia_drink })} />
              </label>
            </div>
          </section>
          {!agenda.length && <div className="desk-empty">{t('portal.pay.empty')}</div>}
          {[...agenda.reduce((map, item) => {
            const start = mondayOf(item.date)
            const list = map.get(start) || []
            list.push(item)
            map.set(start, list)
            return map
          }, new Map()).entries()].sort((a, b) => a[0] < b[0] ? -1 : 1).map(([start, items]) => (
            <section key={start} className="desk-card">
              <h3>{t('portal.pay.weekOf', { date: start })}</h3>
              {items.map(item => (
                <button key={item.id} type="button" className={`desk-alert ${item.inflow ? 'is-in' : item.days < 0 ? 'is-bad' : item.days <= 7 ? 'is-soon' : ''}`} onClick={() => onTab?.(item.tab)}>
                  <span>
                    <strong>{item.title || t(`portal.pay.kind.${item.kind}`)}</strong>
                    <em>
                      {item.date}
                      {' · '}
                      {item.days < 0 && t('portal.desk.overdue', { days: Math.abs(item.days) })}
                      {item.days === 0 && t('portal.desk.dueToday')}
                      {item.days > 0 && t('portal.desk.dueSoon', { days: item.days })}
                    </em>
                  </span>
                  <b>{item.inflow ? '+' : ''}{money(item.amount)}</b>
                </button>
              ))}
            </section>
          ))}
        </>
      )}

      {section === 'salarios' && (
        <>
          <div className="goal-hero">
            <div>
              <div className="goal-hero-kicker">{t('portal.salary.total')}</div>
              <div className="goal-hero-value">{money(board.total)}</div>
              <div className="goal-hero-goal">
                {board.save > 0
                  ? t('portal.salary.save', { amount: money(board.save) })
                  : t('portal.salary.ok')}
              </div>
            </div>
          </div>
          <section className="desk-card">
            {!board.rows.length && <div className="desk-empty">{t('portal.salary.empty')}</div>}
            {board.rows.map(row => (
              <div key={row.id || row.nome} className="desk-row">
                <div>
                  <strong>{row.nome}</strong>
                  <em>
                    {row.hours}h · {money(row.perHour)}/h · {t('portal.salary.sales')} {money(row.sales)}
                    {row.comm ? ` · ${t('portal.desk.commission')} ${money(row.comm)}` : ''}
                  </em>
                  <em className={`salary-hint is-${row.hint}`}>{t(`portal.salary.hint.${row.hint}`, { cover: row.cover ? row.cover.toFixed(1) : '0' })}</em>
                </div>
                <b>{money(row.pay)}</b>
              </div>
            ))}
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
