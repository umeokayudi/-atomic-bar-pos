import { useEffect, useState } from 'react'
import { fmtYen } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { invalidateBarTeam, loadBarTeam, peekBarTeam } from '../lib/barTeam'
import { buildBarDesk } from '../lib/barDesk'
import { paymentAgenda, sameWeekdaySales, stillToSell, weekdayOf } from '../lib/barClose'
import { buildGoalProgress, shiftOf } from '../lib/barGoals'
import { lastDayOfMonth, tokyoHour, tokyoNightKey } from '../lib/tokyo'
import { useI18n } from '../lib/i18n'
import { errText } from '../lib/errText'
import BarOwnerAi from './BarOwnerAi'

const SPANS = ['turno', 'noite', 'semana', 'mes']

function GoalChart({ rows, goal }) {
  const max = Math.max(1, goal || 0, ...rows.map(r => r.sales || 0))
  const w = 720
  const h = 168
  const pad = 18
  const n = Math.max(rows.length, 1)
  const bw = (w - pad * 2) / n
  const y = v => h - 22 - (v / max) * (h - 40)
  return (
    <svg viewBox={`0 0 ${w} ${h}`} className="goal-chart" role="img">
      {goal > 0 && <line x1={pad} x2={w - pad} y1={y(goal)} y2={y(goal)} stroke="#c19c56" strokeDasharray="5 4" strokeWidth="2" />}
      {rows.map((r, i) => {
        const top = y(r.sales || 0)
        const height = Math.max(0, h - 22 - top)
        const hit = goal > 0 && r.sales >= goal
        return (
          <g key={r.key || i}>
            <rect x={pad + i * bw + 6} y={top} width={Math.max(8, bw - 12)} height={height} rx="5" fill={hit ? '#34c759' : '#8eb7ff'} />
            <text x={pad + i * bw + bw / 2} y={h - 6} textAnchor="middle" fill="rgba(255,255,255,0.72)" fontSize="11">{r.label}</text>
          </g>
        )
      })}
    </svg>
  )
}

function money(n) {
  return fmtYen(Math.round(+n || 0))
}

export default function BarDesk({ bar, hq, tickets, invoices, openOrders = 0, floor, onTab }) {
  const { t } = useI18n()
  const cachedTeam = peekBarTeam()
  const [registry, setRegistry] = useState(() => cachedTeam?.registry || [])
  const [goals, setGoals] = useState(() => cachedTeam?.goals || {})
  const [span, setSpan] = useState('noite')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadBarTeam()
      .then(j => {
        if (cancelled || j?.error) return
        setRegistry(j.registry || [])
        setGoals(j.goals || {})
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [bar?.id])

  const desk = buildBarDesk({ tickets, hq, invoices, registry })
  const night = tokyoNightKey()
  const cmp = sameWeekdaySales(tickets, night)
  const progress = buildGoalProgress({ tickets, hq, registry, goals, nightKey: night })
  const hourNow = tokyoHour(new Date())
  const shiftId = shiftOf(hourNow, goals.abre ?? 20, goals.corta ?? 0)
  const shift = progress.turnos.find(s => s.id === shiftId) || progress.turnos[0]
  const view = span === 'turno'
    ? { sales: shift?.sales || 0, goal: shift?.goal || 0 }
    : span === 'semana' ? progress.semana
      : span === 'mes' ? progress.mes
        : progress.noite
  const gap = stillToSell(view.sales, view.goal)
  const pct = view.goal > 0 ? Math.round((view.sales / view.goal) * 100) : null
  const dim = lastDayOfMonth(+night.slice(0, 4), +night.slice(5, 7)) || 30
  const monthLine = progress.mes.goal > 0 ? Math.round(progress.mes.goal / dim) : 0
  const chart = span === 'turno'
    ? progress.turnos.map(s => ({ key: s.id, label: s.id === 1 ? t('portal.goals.shift1') : t('portal.goals.shift2'), sales: s.sales }))
    : span === 'semana'
      ? progress.semana.days.map(d => ({ key: d.date, label: d.date.slice(8), sales: d.sales }))
      : span === 'mes'
        ? desk.days.map(d => ({ key: d.date, label: d.date.slice(8), sales: d.total }))
        : progress.hora.series.map(h => ({ key: h.hour, label: String(h.hour).padStart(2, '0'), sales: h.sales }))
  const chartGoal = span === 'turno' ? (shift?.goal || 0)
    : span === 'semana' ? (progress.noite.goal || 0)
      : span === 'mes' ? monthLine
        : (progress.hora.goal || 0)
  const agenda = paymentAgenda({ registry, hq, invoices, tickets, goals, today: night })
  const bills = agenda.filter(a => !a.inflow)
  const incoming = agenda.filter(a => a.inflow)
  const payGroups = [
    { id: 'late', items: bills.filter(a => a.days < 0) },
    { id: 'today', items: bills.filter(a => a.days === 0) },
    { id: 'week', items: bills.filter(a => a.days > 0 && a.days <= 7) },
    { id: 'later', items: bills.filter(a => a.days > 7).slice(0, 8) },
  ].filter(g => g.items.length)
  const maxDay = Math.max(...desk.days.map(d => d.total), 1)
  const maxHour = Math.max(...desk.hourly.map(h => h.total), 1)

  async function saveSpanGoal() {
    setBusy(true)
    const field = span === 'noite' ? 'noite' : span
    const next = { ...goals, [field]: Math.max(0, Math.round(+draft || 0)) }
    const res = await staffFetch('/api/bar-staff', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: 'saveGoals',
        noite: next.noite || 0,
        hora: next.hora || 0,
        semana: next.semana || 0,
        turno: next.turno || 0,
        lucro: next.lucro || 0,
        mes: next.mes || 0,
        abre: next.abre ?? 20,
        fecha: next.fecha ?? 5,
        corta: next.corta ?? 0,
        pessoas: next.pessoas || [],
        fecha_semana: next.fecha_semana,
        dia_salario: next.dia_salario,
        dia_drink: next.dia_drink,
        dia_mes: next.dia_mes,
      }),
    })
    const json = await res.json().catch(() => ({}))
    if (res.ok && !json.error) {
      invalidateBarTeam()
      setGoals(json.goals || next)
      setEditing(false)
    }
    setBusy(false)
    return json.error ? errText(json.error) : ''
  }

  return (
    <div className="desk">
      <section className="goal-hero desk-goal">
        <div className="goal-modes">
          {SPANS.map(id => (
            <button key={id} type="button" className={span === id ? 'is-on' : ''} onClick={() => { setSpan(id); setEditing(false) }}>
              {t(`portal.desk.span.${id}`)}
            </button>
          ))}
        </div>
        <div className="goal-hero-kicker">{t(`portal.desk.span.${span}`)} · {pct == null ? t('portal.goals.noGoal') : t('portal.goals.hit', { pct })}</div>
        <div className="goal-hero-value">
          {gap == null ? t('portal.goals.noGoal') : gap === 0 ? t('portal.desk.goalHit') : t('portal.desk.stillPeriod', { amount: money(gap) })}
        </div>
        <div className="goal-hero-goal">
          {t('portal.desk.sold', { amount: money(view.sales) })}
          {view.goal > 0 ? ` · ${t('portal.desk.goalOf', { amount: money(view.goal) })}` : ''}
        </div>
        {view.goal > 0 && (
          <div className="goal-meter desk-goal-meter">
            <i><b style={{ width: `${Math.max(0, Math.min(pct || 0, 100))}%` }} className={pct >= 100 ? 'is-hit' : ''} /></i>
          </div>
        )}
        {editing ? (
          <div className="desk-goal-edit">
            <input type="number" min="0" value={draft} onChange={e => setDraft(e.target.value)} />
            <button type="button" className="btn-primary" disabled={busy} onClick={saveSpanGoal}>{t('portal.goals.save')}</button>
            <button type="button" className="house-text" onClick={() => setEditing(false)}>{t('house.cancel')}</button>
          </div>
        ) : (
          <button type="button" className="house-text" onClick={() => { setDraft(String(view.goal || '')); setEditing(true) }}>{t('portal.desk.changeGoal')}</button>
        )}
        <GoalChart rows={chart} goal={chartGoal} />
        {span === 'noite' && (
          <p className="desk-note">
            {t('portal.desk.vsWeek', {
              day: t(`portal.close.days.${weekdayOf(night)}`),
              now: money(cmp.now),
              before: money(cmp.before),
              delta: `${cmp.delta >= 0 ? '+' : '−'}${money(Math.abs(cmp.delta))}`,
            })}
          </p>
        )}
      </section>

      <section className="desk-card">
        <h3>{t('portal.desk.alerts')}</h3>
        {!payGroups.length && !incoming.length && <div className="desk-empty">{t('portal.desk.noAlerts')}</div>}
        {payGroups.map(group => (
          <div key={group.id}>
            <div className="desk-pay-label">{t(`portal.desk.pay.${group.id}`)}</div>
            {group.items.map(a => (
              <button key={a.id} type="button" className={`desk-alert ${a.days < 0 ? 'is-bad' : a.days <= 7 ? 'is-soon' : ''}`} onClick={() => onTab?.(a.tab)}>
                <span>
                  <strong>{a.title || t(`portal.pay.kind.${a.kind}`)}</strong>
                  <em>
                    {a.date}
                    {' · '}
                    {a.days < 0 && t('portal.desk.overdue', { days: Math.abs(a.days) })}
                    {a.days === 0 && t('portal.desk.dueToday')}
                    {a.days > 0 && t('portal.desk.dueSoon', { days: a.days })}
                  </em>
                </span>
                <b>{money(a.amount)}</b>
              </button>
            ))}
          </div>
        ))}
        {!!incoming.length && (
          <div>
            <div className="desk-pay-label">{t('portal.desk.pay.in')}</div>
            {incoming.slice(0, 6).map(a => (
              <button key={a.id} type="button" className="desk-alert is-in" onClick={() => onTab?.(a.tab)}>
                <span>
                  <strong>{a.title || t(`portal.pay.kind.${a.kind}`)}</strong>
                  <em>{a.date} · {a.days === 0 ? t('portal.desk.dueToday') : t('portal.desk.dueSoon', { days: a.days })}</em>
                </span>
                <b>+{money(a.amount)}</b>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="desk-card">
        <h3>{t('portal.desk.cash')}</h3>
        <div className="desk-cash">
          <div><span>{t('portal.desk.cashIn')}</span><strong>{money(desk.cash.inn)}</strong></div>
          <div><span>{t('portal.desk.cashOut')}</span><strong>{money(desk.cash.out)}</strong></div>
          <div className={desk.cash.net >= 0 ? 'is-up' : 'is-down'}><span>{t('portal.desk.cashNet')}</span><strong>{money(desk.cash.net)}</strong></div>
        </div>
        {desk.cardWaiting > 0 && (
          <p className="desk-note">{t('portal.desk.cardWait', { amount: money(desk.cardWaiting), days: desk.cardDays })}</p>
        )}
        <div className="desk-lines">
          {desk.cash.lines.map(l => (
            <div key={l.key}>
              <span>{t(`portal.desk.${l.key}`)}</span>
              <b>{l.sign < 0 ? '−' : ''}{money(l.amount)}</b>
            </div>
          ))}
        </div>
      </section>

      <section className="desk-card">
        <h3>{t('portal.desk.daily')}</h3>
        <div className="desk-bars">
          {desk.days.map(d => (
            <div key={d.date} className="desk-bar" title={`${d.date} ${money(d.total)}`}>
              <i style={{ height: `${Math.max(d.total ? 8 : 0, (d.total / maxDay) * 100)}%` }} />
              <span>{d.date.slice(8)}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="desk-card">
        <h3>{t('portal.desk.hourly')} · {desk.hourNight}</h3>
        {desk.peak && <p className="desk-note">{t('portal.desk.peak', { hour: desk.peak.label, amount: money(desk.peak.total) })}</p>}
        <div className="desk-bars is-hour">
          {desk.hourly.map(h => (
            <div key={h.hour} className="desk-bar" title={`${h.label} ${money(h.total)}`}>
              <i style={{ height: `${Math.max(h.total ? 8 : 0, (h.total / maxHour) * 100)}%` }} />
              <span>{String(h.hour).padStart(2, '0')}</span>
            </div>
          ))}
        </div>
      </section>

      <section className="desk-card">
        <h3>{t('portal.desk.cast')}</h3>
        {!desk.cast.length && <div className="desk-empty">{t('portal.desk.emptyCast')}</div>}
        {desk.cast.map(c => (
          <div key={c.id} className="desk-row">
            <div>
              <strong>{c.name}</strong>
              <em>{t('portal.desk.tickets', { count: c.tickets })}</em>
            </div>
            <div className="desk-row-money">
              <b>{money(c.sales)}</b>
              <em>{t('portal.desk.commission')} {money(c.commission)}</em>
            </div>
          </div>
        ))}
      </section>

      <section className="desk-card">
        <h3>{t('portal.desk.labor')}</h3>
        <div className="desk-cash">
          <div><span>{t('portal.desk.labor')}</span><strong>{money(desk.labor.total)}</strong></div>
          <div><span>{t('portal.desk.hours')}</span><strong>{desk.labor.hours}h</strong></div>
        </div>
        {!desk.labor.rows.length && <div className="desk-empty">{t('portal.desk.emptyLabor')}</div>}
        {desk.labor.rows.map(r => (
          <div key={r.staff_id} className="desk-row">
            <div>
              <strong>{r.nome}</strong>
              <em>{r.hours}h{r.cargo ? ` · ${r.cargo}` : ''}</em>
            </div>
            <b>{money(r.pay)}</b>
          </div>
        ))}
      </section>

      <section className="desk-card">
        <h3>{t('portal.desk.more')}</h3>
        <div className="desk-more">
          <button type="button" onClick={() => onTab?.('pedidos')}>{t('portal.desk.orders')} · {openOrders}</button>
          <button type="button" onClick={() => onTab?.('espacos')}>{t('portal.desk.floor')} · {floor?.seated || 0}</button>
          <button type="button" onClick={() => onTab?.('custos')}>{t('portal.desk.books')}</button>
          <button type="button" onClick={() => onTab?.('pos')}>{t('portal.desk.till')}</button>
          <button type="button" onClick={() => onTab?.('metas')}>{t('nav.portalGoals')}</button>
          <button type="button" onClick={() => onTab?.('fechamento')}>{t('nav.portalClose')}</button>
          <button type="button" onClick={() => onTab?.('pagamentos')}>{t('nav.portalPay')}</button>
          <button type="button" onClick={() => onTab?.('salarios')}>{t('nav.portalSalary')}</button>
        </div>
      </section>

      <BarOwnerAi bar={bar} hq={hq} />
    </div>
  )
}
