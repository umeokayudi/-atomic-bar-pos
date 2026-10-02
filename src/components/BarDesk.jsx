import { useEffect, useState } from 'react'
import { fmtYen } from './utils'
import { staffFetch } from '../lib/apiAuth'
import { invalidateBarTeam, loadBarTeam, peekBarTeam } from '../lib/barTeam'
import { buildBarDesk } from '../lib/barDesk'
import { addDays, cardCash, monthBounds, paymentAgenda, periodReport, sameWeekdaySales, stillToSell, tenderOf, weekdayOf } from '../lib/barClose'
import { buildGoalProgress, openHours, shiftBand } from '../lib/barGoals'
import { whatWorked } from '../lib/barStrategy'
import { nightKeyOfSale } from '../lib/nightClose'
import { hourOfSale } from '../lib/nightClose'
import { lastDayOfMonth, tokyoHour, tokyoNightKey } from '../lib/tokyo'
import { useI18n } from '../lib/i18n'
import { isLocalDemo } from '../lib/supabase'
import { errText } from '../lib/errText'
import BarOwnerAi from './BarOwnerAi'
import { InsightCard, MetricSwitch } from './ui/ops'
import { DashboardHeader, METRIC_STATUS, OperationalStatus, Panel, QuickAction, StatusBadge } from './ui/executive'
import ManagerPro from './ManagerPro'
import OwnerView from './OwnerView'
import { DemoToday } from './demo/DemoOperations'
import ReportsStudio from './ReportsStudio'
import ApprovalCenter from './ApprovalCenter'

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
    <svg viewBox={`0 0 ${w} ${h}`} className="goal-chart" role="img" style={{ color: 'var(--text2)' }}>
      {goal > 0 && <line x1={pad} x2={w - pad} y1={y(goal)} y2={y(goal)} stroke="currentColor" strokeDasharray="5 4" strokeWidth="2" />}
      {rows.map((r, i) => {
        const top = y(r.sales || 0)
        const height = Math.max(0, h - 22 - top)
        const hit = goal > 0 && r.sales >= goal
        return (
          <g key={r.key || i}>
            <rect x={pad + i * bw + 6} y={top} width={Math.max(8, bw - 12)} height={height} rx="4" fill={hit ? 'var(--green)' : 'var(--blue)'} />
            <text x={pad + i * bw + bw / 2} y={h - 6} textAnchor="middle" fill="currentColor" fontSize="11">{r.label}</text>
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
  const [mode, setMode] = useState(() => {
    try { return sessionStorage.getItem('atomic-bar-desk-mode') === 'manager' ? 'manager' : 'owner' }
    catch { return 'owner' }
  })
  const [section, setSection] = useState('analytics')
  const [hourMetric, setHourMetric] = useState('sales')

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
  const tonightRows = (tickets || []).filter(s => nightKeyOfSale(s) === night)
  const tonightCount = tonightRows.length
  const tonightSum = tonightRows.reduce((sum, s) => sum + (+s.total || 0), 0)
  const tonightAvg = tonightCount ? Math.round(tonightSum / tonightCount) : null
  const guestCount = new Set(tonightRows.map(s => s.guest_id).filter(Boolean)).size
  const hourSeries = progress.hora?.series || []
  const buckets = new Map()
  for (const sale of tonightRows) {
    const hour = hourOfSale(sale)
    if (hour == null) continue
    const prev = buckets.get(hour) || { sales: 0, orders: 0 }
    prev.sales += +sale.total || 0
    prev.orders += 1
    buckets.set(hour, prev)
  }
  const hourView = hourSeries.map(row => {
    const hit = buckets.get(row.hour) || { sales: row.sales || 0, orders: 0 }
    const sales = hit.sales || 0
    const orders = hit.orders || 0
    const ticket = orders > 0 ? Math.round(sales / orders) : null
    const value = hourMetric === 'orders' ? orders : hourMetric === 'ticket' ? (ticket || 0) : sales
    return { ...row, sales, orders, ticket, value }
  })
  const ranked = hourView.filter(row => (hourMetric === 'orders' ? row.orders > 0 : hourMetric === 'ticket' ? row.ticket != null : row.sales > 0))
  const bestHour = ranked.reduce((best, row) => (row.value > (best?.value || 0) ? row : best), null)
  const quietHour = ranked.length >= 2
    ? ranked.reduce((quiet, row) => (row.value < quiet.value ? row : quiet))
    : null
  const tonightSales = progress.noite.sales || 0
  const bestShare = bestHour && hourMetric === 'sales' && tonightSales > 0 ? Math.round((bestHour.sales / tonightSales) * 100) : null
  const hourMax = Math.max(1, ...hourView.map(row => +row.value || 0))
  const lucro = progress.lucro || {}
  const open = openHours(progress.abre, progress.fecha)
  const nowHour = tokyoHour(new Date())
  const nowIndex = open.indexOf(nowHour)
  const elapsedHours = nowIndex >= 0 ? nowIndex + 1 : 0
  const hoursLeft = nowIndex >= 0 ? Math.max(0, open.length - nowIndex - 1) : 0
  const currentPace = elapsedHours > 0 && tonightSum > 0 ? Math.round(tonightSum / elapsedHours) : null
  const nightLeft = stillToSell(tonightSum, progress.noite.goal)
  const requiredPace = nightLeft != null && hoursLeft > 0 ? Math.round(nightLeft / hoursLeft) : null
  const monthSum = monthTickets.reduce((sum, sale) => sum + (+sale.total || 0), 0)
  const dayNum = +night.slice(8, 10) || 0
  const projected = dayNum > 0 && monthSum > 0 ? Math.round((monthSum / dayNum) * dim) : null
  function hourText(row) {
    if (!row) return t('portal.desk.insufficient')
    if (hourMetric === 'orders') return `${row.label} · ${row.orders}`
    if (hourMetric === 'ticket') return row.ticket == null ? t('portal.desk.insufficient') : `${row.label} · ${money(row.ticket)}`
    return `${row.label} · ${money(row.sales)}${bestShare != null && row === bestHour ? ` · ${t('portal.desk.share', { pct: bestShare })}` : ''}`
  }
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

  const salesStatus = tonightCount > 0 ? METRIC_STATUS.AVAILABLE : METRIC_STATUS.INSUFFICIENT
  const marginReady = lucro.cost > 0 && lucro.sales > 0
  const profitStatus = marginReady ? METRIC_STATUS.AVAILABLE : METRIC_STATUS.INSUFFICIENT
  const marginPct = marginReady ? Math.round((lucro.profit / lucro.sales) * 100) : null
  const ticketStatus = tonightAvg == null ? METRIC_STATUS.INSUFFICIENT : METRIC_STATUS.AVAILABLE
  const guestStatus = tonightCount > 0 ? METRIC_STATUS.AVAILABLE : METRIC_STATUS.INSUFFICIENT
  const chartHasSales = chart.some(row => row.sales > 0)
  const priorWeek = span === 'noite' && cmp.before > 0
  const shiftKnown = Array.isArray(hq?.payroll)
  const floorKnown = floor && (floor.seated != null || floor.free != null)
  const cashKnown = monthTickets.length > 0

  const stockKnown = Array.isArray(hq?.jbm?.estoqueBaixo) || Number.isFinite(hq?.sources?.inventory?.low)
  const stockLow = Array.isArray(hq?.jbm?.estoqueBaixo)
    ? hq.jbm.estoqueBaixo.length
    : (Number.isFinite(hq?.sources?.inventory?.low) ? hq.sources.inventory.low : null)
  const noSalesCopy = isLocalDemo
    ? 'No sales recorded in this demo session.'
    : 'No completed sales for this period'

  return (
    <div className="executive-dashboard command-center">
      <DashboardHeader
        kicker={bar?.nome || 'Bar operations'}
        title={mode === 'owner' ? 'Owner' : 'Manager Pro'}
        subtitle={`${night} · Asia/Tokyo · ${isLocalDemo ? 'Local demo. No remote sync.' : 'Connected register.'}`}
      >
        <div className="goal-modes">
          <button type="button" className={mode === 'owner' ? 'is-on' : ''} onClick={() => { setMode('owner'); try { sessionStorage.setItem('atomic-bar-desk-mode', 'owner') } catch { /* ignore */ } }}>Owner</button>
          <button type="button" className={mode === 'manager' ? 'is-on' : ''} onClick={() => { setMode('manager'); try { sessionStorage.setItem('atomic-bar-desk-mode', 'manager') } catch { /* ignore */ } }}>Manager Pro</button>
        </div>
        <QuickAction primary icon="ia" onClick={() => onTab?.('ia')}>Ask AI</QuickAction>
      </DashboardHeader>

      {mode === 'owner' && (
        <OwnerView
          bar={bar}
          tickets={tickets}
          people={[...(staff || []), ...(people || [])].filter((person, index, list) => person?.id && list.findIndex(item => item.id === person.id) === index)}
          goals={goals}
          registry={registry}
          payroll={hq?.payroll}
          onTab={onTab}
          onManage={() => { setMode('manager'); try { sessionStorage.setItem('atomic-bar-desk-mode', 'manager') } catch { /* ignore */ } }}
        />
      )}
      {mode === 'manager' && (
        <>
          <div className="goal-modes">
            <button type="button" className={section === 'analytics' ? 'is-on' : ''} onClick={() => setSection('analytics')}>Analytics</button>
            <button type="button" className={section === 'reports' ? 'is-on' : ''} onClick={() => setSection('reports')}>Reports</button>
            <button type="button" className={section === 'approvals' ? 'is-on' : ''} onClick={() => setSection('approvals')}>Approvals</button>
            <button type="button" onClick={() => onTab?.('ia')}>AI Operations</button>
            <button type="button" onClick={() => onTab?.('fechamento')}>Cash closing</button>
            <button type="button" onClick={() => onTab?.('estoque')}>Inventory</button>
            <button type="button" onClick={() => onTab?.('staff')}>Employees</button>
          </div>
          {section === 'analytics' && isLocalDemo && <DemoToday onTab={onTab} venue={bar?.nome} />}
          {section === 'analytics' && !isLocalDemo && (
            <ManagerPro
              bar={bar}
              tickets={tickets}
              people={[...(staff || []), ...(people || [])].filter((person, index, list) => person?.id && list.findIndex(item => item.id === person.id) === index)}
              goals={goals}
              registry={registry}
              payroll={hq?.payroll}
            />
          )}
          {section === 'reports' && (
            <ReportsStudio bar={bar} tickets={tickets} people={[...(staff || []), ...(people || [])].filter((person, index, list) => person?.id && list.findIndex(item => item.id === person.id) === index)} registry={registry} payroll={hq?.payroll} />
          )}
          {section === 'approvals' && <ApprovalCenter onTab={onTab} />}
        </>
      )}

      {(onClock.length > 0 || cashKnown || lateBills.length > 0 || nextBills.length > 0 || (stockKnown && stockLow > 0)) && <div className="command-grid">
        <aside className="command-side">
          <Panel title="Shift overview">
            {!shiftKnown && <p className="metric-detail">Shift status is unavailable without the live register.</p>}
            {shiftKnown && !onClock.length && <p className="metric-detail">{t('portal.desk.emptyClock')}</p>}
            {onClock.map(r => (
              <div key={r.staff_id} className="desk-row">
                <div>
                  <strong>{r.nome}</strong>
                  <em>{t('portal.desk.onClock')}</em>
                </div>
              </div>
            ))}
            {span === 'turno' && (
              <div className="goal-modes">
                {['noite', 'dia'].map(id => (
                  <button key={id} type="button" className={band === id ? 'is-on' : ''} onClick={() => setBand(id)}>
                    {t(id === 'noite' ? 'portal.desk.nightShift' : 'portal.desk.dayShift')}
                  </button>
                ))}
              </div>
            )}
            <OperationalStatus
              label="Cash register"
              status={cashKnown ? METRIC_STATUS.AVAILABLE : METRIC_STATUS.INSUFFICIENT}
              value={cashKnown ? money(inHand) : '—'}
              detail={cashKnown ? t('portal.desk.inHand') : 'Needs completed till tickets'}
            />
            <OperationalStatus
              label="Orders pending"
              status={METRIC_STATUS.AVAILABLE}
              value={String(openOrders || 0)}
              detail={openOrders > 0 ? 'Open drink orders' : 'No open orders'}
            />
            <div className="ops-status-row">
              <div>
                <div className="ops-status-label">Floor occupancy</div>
                {!floorKnown && <div className="metric-detail">Floor status is unavailable.</div>}
              </div>
            </div>
            {floorKnown && (
              <ul className="floor-snapshot">
                <li><StatusBadge tone="occupied">Occupied</StatusBadge><strong>{floor.seated || 0}</strong></li>
                <li><StatusBadge tone="reserved">Reserved</StatusBadge><strong>{floor.reserved || 0}</strong></li>
                <li><StatusBadge tone="available">Available</StatusBadge><strong>{floor.free || 0}</strong></li>
              </ul>
            )}
            {openOrders > 0 && (
              <button type="button" className="house-text" onClick={() => onTab?.('pedidos')}>
                {openOrders} open {openOrders === 1 ? 'order' : 'orders'}
              </button>
            )}
          </Panel>

          <Panel title="Operational alerts">
            {stockKnown && (
              <OperationalStatus
                label="Low stock"
                status={stockLow > 0 ? METRIC_STATUS.AVAILABLE : METRIC_STATUS.EMPTY}
                value={String(stockLow)}
                detail={stockLow > 0 ? 'Items at or below minimum' : 'No items below minimum'}
              />
            )}
            {!stockKnown && (
              <p className="metric-detail">
                {isLocalDemo ? 'Inventory data is unavailable in local mode.' : 'Low stock is unavailable without the inventory ledger.'}
              </p>
            )}
            {!lateBills.length && !nextBills.length && !incoming.length && (
              <p className="metric-detail">No payment alerts from the current books.</p>
            )}
            {lateBills.map(a => (
              <button key={a.id} type="button" className="desk-alert is-bad" onClick={() => onTab?.(a.tab)}>
                <span>
                  <strong>{a.title || t(`portal.pay.kind.${a.kind}`)}</strong>
                  <em>{whenLabel(a.date)}</em>
                </span>
                <b>{money(a.amount)}</b>
              </button>
            ))}
            {nextBills.slice(0, 3).map(a => (
              <button key={a.id} type="button" className="desk-alert" onClick={() => onTab?.(a.tab)}>
                <span>
                  <strong>{a.title || t(`portal.pay.kind.${a.kind}`)}</strong>
                  <em>{whenLabel(a.date)}</em>
                </span>
                <b>{money(a.amount)}</b>
              </button>
            ))}
            {cashKnown && (
              <OperationalStatus
                label={t('portal.desk.toPay7')}
                status={METRIC_STATUS.AVAILABLE}
                value={money(toPay)}
                detail="Due within 7 days"
              />
            )}
            <button type="button" className="house-text" onClick={() => onTab?.('pagamentos')}>{t('portal.desk.seeAll')}</button>
          </Panel>
        </aside>
      </div>}
    </div>
  )
}
