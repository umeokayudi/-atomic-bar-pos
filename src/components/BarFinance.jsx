import { useEffect, useState } from 'react'
import { fmtYen, Spinner } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { fetchHqSnapshot } from '../lib/hqSnapshot'
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
import { useI18n } from '../lib/i18n'
import { asReactText, errText } from '../lib/errText'

function money(n) {
  return fmtYen(Math.round(+n || 0))
}

function Bars({ rows }) {
  const max = Math.max(1, ...rows.map(r => r.sales || 0))
  return (
    <div className="desk-bars">
      {rows.map(r => (
        <div key={r.date} className="desk-bar" title={`${r.date} ${money(r.sales)}`}>
          <i style={{ height: `${Math.max(r.sales ? 8 : 0, (r.sales / max) * 100)}%` }} />
          <span>{r.label}</span>
        </div>
      ))}
    </div>
  )
}

function Stat({ label, value, tone }) {
  return (
    <div className={tone || ''}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  )
}

export default function BarFinance({ bar, section = 'fechamento', onTab }) {
  const { t } = useI18n()
  const [loading, setLoading] = useState(true)
  const [err, setErr] = useState('')
  const [busy, setBusy] = useState(false)
  const [view, setView] = useState('week')
  const [pack, setPack] = useState(null)
  const [days, setDays] = useState({ dia_mes: 1, dia_salario: 25, dia_drink: 10 })

  async function load() {
    const night = tokyoNightKey()
    const prevKey = monthBounds(night).prevStart.slice(0, 7)
    const [teamRes, hq, prevHq] = await Promise.all([
      staffFetch('/api/bar-staff').then(r => r.json()),
      fetchHqSnapshot().catch(() => null),
      fetchHqSnapshot(prevKey).catch(() => null),
    ])
    if (teamRes.error) throw new Error(errText(teamRes.error))
    setPack({
      registry: teamRes.registry || [],
      goals: teamRes.goals || {},
      hq,
      tickets: hq?.pos?.history?.length ? hq.pos.history : (hq?.pos?.tickets || []),
      invoices: hq?.jbm?.openInvoices || [],
      prevHq,
    })
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
    setLoading(true)
    load()
      .catch(e => { if (!cancelled) setErr(errText(e)) })
      .finally(() => { if (!cancelled) setLoading(false) })
    return () => { cancelled = true }
  }, [bar?.id])

  async function saveSettings(patch) {
    setBusy(true)
    setErr('')
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
    tickets: pack.prevHq?.pos?.history?.length ? pack.prevHq.pos.history : (pack.prevHq?.pos?.tickets || pack.tickets),
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
              <div className="goal-hero-value">{money(current.profit)}</div>
              <div className="goal-hero-goal">
                {t('portal.close.profit')}
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
            <div className="desk-cash">
              <Stat label={t('portal.close.sales')} value={money(current.sales)} />
              <Stat label={t('portal.close.ticket')} value={money(current.ticket)} />
              <Stat label={t('portal.close.count')} value={String(current.count)} />
            </div>
            <div className="desk-cash" style={{ marginTop: 8 }}>
              <Stat label={t('portal.close.cash')} value={money(current.tender.cash)} />
              <Stat label={t('portal.close.card')} value={money(current.tender.card)} />
              <Stat label={t('portal.close.paypay')} value={money(current.tender.paypay)} />
            </div>
            <div className="desk-lines">
              <div><span>{t('portal.close.vip')}</span><b>{money(current.vip)}</b></div>
              <div><span>{t('portal.close.fee')}</span><b>−{money(current.fee)}</b></div>
              <div><span>{t('portal.close.comm')}</span><b>−{money(current.comm)}</b></div>
              <div><span>{t('portal.close.costs')}</span><b>−{money(current.allocated)}</b></div>
              <div><span>{t('portal.close.rent')}</span><b>{money(current.costs.rent)}</b></div>
            </div>
          </section>

          <section className="desk-card">
            <h3>{t('portal.close.nights')}</h3>
            <Bars rows={current.byNight} />
          </section>

          <section className="desk-card">
            <h3>{view === 'month' ? t('portal.close.prevMonth') : t('portal.close.prevWeek')}</h3>
            <p className="desk-note">{previous.start} → {previous.end}</p>
            <div className="desk-cash">
              <Stat label={t('portal.close.sales')} value={money(previous.sales)} />
              <Stat label={t('portal.close.profit')} value={money(previous.profit)} tone={previous.profit >= 0 ? 'is-up' : 'is-down'} />
            </div>
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
          <section className="desk-card">
            {!agenda.length && <div className="desk-empty">{t('portal.pay.empty')}</div>}
            {agenda.map(item => (
              <button key={item.id} type="button" className={`desk-alert ${item.days < 0 ? 'is-bad' : item.days <= 7 ? 'is-soon' : ''}`} onClick={() => onTab?.(item.tab)}>
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
                <b>{money(item.amount)}</b>
              </button>
            ))}
          </section>
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
