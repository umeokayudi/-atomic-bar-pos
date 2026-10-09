import { useEffect, useState } from 'react'
import { fmtYen } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { invalidateBarTeam, loadBarTeam, peekBarTeam } from '../lib/barTeam'
import { buildBarDesk } from '../lib/barDesk'
import { addDays, cardCash, monthBounds, paymentAgenda, periodReport, sameWeekdaySales, stillToSell, tenderOf, weekdayOf } from '../lib/barClose'
import { buildGoalProgress, shiftBand } from '../lib/barGoals'
import { whatWorked } from '../lib/barStrategy'
import { nightKeyOfSale } from '../lib/nightClose'
import { lastDayOfMonth, tokyoHour, tokyoNightKey } from '../lib/tokyo'
import { useI18n } from '../lib/i18n'
import { errText } from '../lib/errText'
import BarOwnerAi from './BarOwnerAi'

const SPANS = ['turno', 'noite', 'semana', 'mes']
const DAY_KEY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

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

function nightsThrough(start, end) {
  const out = []
  let cursor = start
  for (let i = 0; i < 31 && cursor <= end; i += 1) {
    out.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return out
}

function birthdayWithin(aniversario, today, within = 7) {
  const mmdd = String(aniversario || '').slice(5, 10)
  if (!/^\d{2}-\d{2}$/.test(mmdd)) return false
  const year = +String(today).slice(0, 4)
  let date = `${year}-${mmdd}`
  if (date < today) date = `${year + 1}-${mmdd}`
  const [y, m, d] = today.split('-').map(Number)
  const [y2, m2, d2] = date.split('-').map(Number)
  const days = Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y, m - 1, d)) / 86400000)
  return days >= 0 && days <= within
}

export default function BarDesk({ bar, hq, tickets, invoices, openOrders = 0, floor, onTab }) {
  const { t } = useI18n()
  const cachedTeam = peekBarTeam()
  const [registry, setRegistry] = useState(() => cachedTeam?.registry || [])
  const [goals, setGoals] = useState(() => cachedTeam?.goals || {})
  const [staff, setStaff] = useState(() => cachedTeam?.staff || [])
  const [people, setPeople] = useState(() => cachedTeam?.people || [])
  const [span, setSpan] = useState('noite')
  const [band, setBand] = useState(() => shiftBand(tokyoHour(new Date())))
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [busy, setBusy] = useState(false)
  const [ask, setAsk] = useState(false)

  useEffect(() => {
    let cancelled = false
    loadBarTeam()
      .then(j => {
        if (cancelled || j?.error) return
        setRegistry(j.registry || [])
        setGoals(j.goals || {})
        setStaff(j.staff || [])
        setPeople(j.people || [])
      })
      .catch(() => {})
    return () => { cancelled = true }
  }, [bar?.id])

  const desk = buildBarDesk({ tickets, hq, invoices, registry })
  const night = tokyoNightKey()
  const monthKey = night.slice(0, 7)
  const cmp = sameWeekdaySales(tickets, night)
  const drinkPeople = [
    ...(staff || []).filter(p => p.drink_back),
    ...(people || []).filter(p => p.drink_back && !(staff || []).some(s => s.id === p.id)),
  ]
  const progress = buildGoalProgress({ tickets, hq, registry, goals, people: drinkPeople, nightKey: night })
  const activeBand = progress.bands?.[band] || progress.bands?.noite
  const view = span === 'turno'
    ? { sales: activeBand?.sales || 0, goal: activeBand?.goal || 0 }
    : span === 'semana' ? progress.semana
      : span === 'mes' ? progress.mes
        : progress.noite
  const gap = stillToSell(view.sales, view.goal)
  const pct = view.goal > 0 ? Math.round((view.sales / view.goal) * 100) : null
  const dim = lastDayOfMonth(+night.slice(0, 4), +night.slice(5, 7)) || 30
  const monthLine = progress.mes.goal > 0 ? Math.round(progress.mes.goal / dim) : 0
  const monthSales = new Map()
  for (const s of tickets || []) {
    const key = nightKeyOfSale(s)
    if (!key || !key.startsWith(monthKey) || key > night) continue
    monthSales.set(key, (monthSales.get(key) || 0) + (+s.total || 0))
  }
  const chart = span === 'semana'
    ? progress.semana.days.map(d => ({ key: d.date, label: t(`house.day.${DAY_KEY[weekdayOf(d.date)]}`), sales: d.sales }))
    : span === 'mes'
      ? nightsThrough(`${monthKey}-01`, night).map(date => ({ key: date, label: date.slice(8), sales: monthSales.get(date) || 0 }))
      : progress.hora.series.map(h => ({ key: h.hour, label: String(h.hour).padStart(2, '0'), sales: h.sales }))
  const chartGoal = span === 'semana' ? (progress.noite.goal || 0)
    : span === 'mes' ? monthLine
      : (progress.hora.goal || 0)
  const bounds = monthBounds(night)
  const monthNet = periodReport({
    tickets,
    registry,
    hq,
    start: bounds.start,
    end: night < bounds.end ? night : bounds.end,
    monthKey,
  })
  const profitGap = stillToSell(monthNet.net, progress.lucro.goal)
  const agenda = paymentAgenda({ registry, hq, invoices, tickets, goals, today: night })
  const bills = agenda.filter(a => !a.inflow)
  const incoming = agenda.filter(a => a.inflow).slice(0, 3)
  const lateBills = bills.filter(a => a.days < 0)
  const nextBills = bills.filter(a => a.days >= 0).slice(0, 5)
  const lateTotal = lateBills.reduce((sum, a) => sum + (+a.amount || 0), 0)
  const monthTickets = (tickets || []).filter(s => {
    const key = nightKeyOfSale(s)
    return key && key.startsWith(monthKey)
  })
  const tender = tenderOf(monthTickets)
  const card = cardCash({ tickets: monthTickets, registry, today: night })
  const inHand = tender.cash + tender.paypay + card.landed
  const toPay = bills.filter(a => a.days <= 7).reduce((sum, a) => sum + (+a.amount || 0), 0)
  const worked = whatWorked(tickets)
  const peak = worked.peakHours?.[0]
  const birthdays = new Map()
  for (const p of [...(staff || []), ...(people || [])]) {
    if (p?.id && p.aniversario) birthdays.set(p.id, p.aniversario)
  }
  const commById = new Map(desk.cast.map(c => [c.id, c]))
  const commByName = new Map(desk.cast.map(c => [String(c.name || '').trim().toLowerCase(), c]))
  const castRows = progress.pessoas.length
    ? progress.pessoas.map(p => {
      const hit = commById.get(p.id) || commByName.get(String(p.nome || '').trim().toLowerCase())
      return {
        id: p.id,
        name: p.nome,
        sales: p.noite,
        pct: p.noitePct,
        commission: hit?.commission || 0,
        birthday: birthdayWithin(birthdays.get(p.id), night),
      }
    })
    : desk.cast.map(c => ({ ...c, pct: null, birthday: birthdayWithin(birthdays.get(c.id), night) }))
  const onClock = (hq?.payroll || []).filter(r => r.open)

  function whenLabel(date) {
    const day = +String(date || '').slice(8, 10)
    const key = DAY_KEY[weekdayOf(date)] || 'sun'
    return `${t(`house.day.${key}`)} ${day || ''}`
  }

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
        {span === 'turno' ? (
          <div className="goal-modes">
            {['noite', 'dia'].map(id => {
              const row = progress.bands?.[id]
              return (
                <button key={id} type="button" className={band === id ? 'is-on' : ''} onClick={() => setBand(id)}>
                  {t(id === 'noite' ? 'portal.desk.nightShift' : 'portal.desk.dayShift')}
                  {row ? ` · ${money(row.sales)}` : ''}
                </button>
              )
            })}
          </div>
        ) : (
          <GoalChart rows={chart} goal={chartGoal} />
        )}
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
        {span === 'mes' && progress.lucro.goal > 0 && (
          <p className="desk-note">
            {t('portal.desk.netLine', {
              profit: money(monthNet.net),
              goal: money(progress.lucro.goal),
              left: profitGap == null ? '' : money(profitGap),
            })}
          </p>
        )}
        {span === 'turno' && (
          <p className="desk-note">
            {activeBand?.count
              ? t('portal.desk.tillSource', {
                count: activeBand.count,
                detail: (activeBand.hours || []).map(h => `${h.label} ${money(h.sales)}`).join(' · ') || money(activeBand.sales),
              })
              : t('portal.desk.tillEmpty')}
            {' '}
            {t('portal.desk.tillNote')}
          </p>
        )}
        {span !== 'turno' && peak && (
          <p className="desk-ai-line">
            {t('portal.desk.aiLine', { hour: peak.label || String(peak.hour || ''), amount: money(peak.total) })}
          </p>
        )}
        <button type="button" className="house-text" onClick={() => setAsk(v => !v)}>{t('portal.desk.ask')}</button>
      </section>

      {ask && <BarOwnerAi bar={bar} hq={hq} />}

      {(hq?.jbm?.billCheck?.status === 'off' || hq?.jbm?.billCheck?.status === 'paid-gap') && (
        <button type="button" className="desk-alarm" onClick={() => onTab?.('faturas')}>
          <strong>{t(hq.jbm.billCheck.status === 'paid-gap' ? 'notifications.paidGapTitle' : 'notifications.mismatchTitle')}</strong>
          <em>{t(hq.jbm.billCheck.status === 'paid-gap' ? 'notifications.paidGapBody' : 'notifications.mismatchBody', {
            from: hq.jbm.billCheck.start || '—',
            to: hq.jbm.billCheck.end || '—',
            orders: money(hq.jbm.billCheck.orders || 0),
            invoice: money(hq.jbm.billCheck.invoice || 0),
            amount: money(hq.jbm.billCheck.gapPaid || Math.abs(hq.jbm.billCheck.delta || 0)),
          })}</em>
        </button>
      )}

      <section className="desk-card">
        <h3>{t('portal.desk.alerts')}</h3>
        {!!lateBills.length && (
          <div className="pay-late">
            <strong>{t('portal.desk.lateAlert', { count: lateBills.length })}</strong>
            <b>{money(lateTotal)}</b>
          </div>
        )}
        {!lateBills.length && !nextBills.length && !incoming.length && <div className="desk-empty">{t('portal.desk.noAlerts')}</div>}
        {lateBills.map(a => (
          <button key={a.id} type="button" className="desk-alert is-bad" onClick={() => onTab?.(a.tab)}>
            <span>
              <strong>{a.title || t(`portal.pay.kind.${a.kind}`)}</strong>
              <em>{whenLabel(a.date)} · {t('portal.desk.overdue', { days: Math.abs(a.days) })}</em>
            </span>
            <b>{money(a.amount)}</b>
          </button>
        ))}
        {nextBills.map(a => (
          <button key={a.id} type="button" className={`desk-alert ${a.days === 0 || a.days <= 7 ? 'is-soon' : ''}`} onClick={() => onTab?.(a.tab)}>
            <span>
              <strong>{a.title || t(`portal.pay.kind.${a.kind}`)}</strong>
              <em>{whenLabel(a.date)}</em>
            </span>
            <b>{money(a.amount)}</b>
          </button>
        ))}
        {!!incoming.length && (
          <div>
            <div className="desk-pay-label">{t('portal.desk.pay.in')}</div>
            {incoming.map(a => (
              <button key={a.id} type="button" className="desk-alert is-in" onClick={() => onTab?.(a.tab)}>
                <span>
                  <strong>{a.title || t(`portal.pay.kind.${a.kind}`)}</strong>
                  <em>{whenLabel(a.date)}</em>
                </span>
                <b>+{money(a.amount)}</b>
              </button>
            ))}
          </div>
        )}
        <button type="button" className="house-text" onClick={() => onTab?.('pagamentos')}>{t('portal.desk.seeAll')}</button>
      </section>

      <section className="desk-card">
        <h3>{t('portal.desk.cash')}</h3>
        <div className="desk-cash">
          <div><span>{t('portal.desk.inHand')}</span><strong>{money(inHand)}</strong></div>
          <div><span>{t('portal.desk.toReceive')}</span><strong>{money(card.waiting)}</strong></div>
          <div><span>{t('portal.desk.toPay7')}</span><strong>{money(toPay)}</strong></div>
        </div>
      </section>

      <section className="desk-card">
        <h3>{t('portal.desk.cast')}</h3>
        {!castRows.length && <div className="desk-empty">{t('portal.desk.emptyCast')}</div>}
        {castRows.map(c => (
          <div key={c.id} className="desk-row">
            <div>
              <strong>
                {c.name}
                {c.birthday && <span className="desk-bday">{t('portal.desk.bday')}</span>}
              </strong>
              {c.pct != null && (
                <div className="goal-meter">
                  <span>{c.pct}%</span>
                  <i><b style={{ width: `${Math.max(0, Math.min(c.pct, 100))}%` }} className={c.pct >= 100 ? 'is-hit' : ''} /></i>
                </div>
              )}
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
        {!onClock.length && <div className="desk-empty">{t('portal.desk.emptyClock')}</div>}
        {onClock.map(r => (
          <div key={r.staff_id} className="desk-row">
            <div>
              <strong>{r.nome}</strong>
              <em>{t('portal.desk.perHour', { amount: money(r.salario_hora || 0) })}</em>
            </div>
            <b>{t('portal.desk.onClock')}</b>
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
    </div>
  )
}
