/** Goal pace for the bar: night, hour, week, shift, profit, and drink-back cast. */

import { nightKeyOfSale } from './nightClose.js'
import { readTicketMeta } from './nightTicket.js'
import { orderCastFromObs, orderCastIdFromObs } from './orderMeta.js'
import { lastDayOfMonth, tokyoHour, tokyoNightKey } from './tokyo.js'

export function goalPct(value, goal) {
  const g = +goal || 0
  if (g <= 0) return null
  return Math.round((+value || 0) / g * 100)
}

export function openHours(abre = 20, fecha = 5) {
  const hours = []
  let h = ((+abre % 24) + 24) % 24
  const end = ((+fecha % 24) + 24) % 24
  for (let i = 0; i < 24; i += 1) {
    hours.push(h)
    if (h === end) break
    h = (h + 1) % 24
  }
  return hours
}

/** Night window is open→close (default 20:00–05:00). Everything else that night is the day shift. */
export function shiftBand(hour, abre = 20, fecha = 5) {
  if (hour == null || Number.isNaN(+hour)) return 'noite'
  const h = ((+hour % 24) + 24) % 24
  return openHours(abre, fecha).includes(h) ? 'noite' : 'dia'
}

export function shiftOf(hour, abre = 20, corta = 0) {
  if (hour == null) return 0
  const first = []
  let h = ((+abre % 24) + 24) % 24
  const cut = ((+corta % 24) + 24) % 24
  for (let i = 0; i < 24; i += 1) {
    if (h === cut) break
    first.push(h)
    h = (h + 1) % 24
  }
  return first.includes(hour) ? 1 : 2
}

function dateKeyAdd(key, days) {
  const [y, m, d] = String(key).slice(0, 10).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  const yy = dt.getUTCFullYear()
  const mm = String(dt.getUTCMonth() + 1).padStart(2, '0')
  const dd = String(dt.getUTCDate()).padStart(2, '0')
  return `${yy}-${mm}-${dd}`
}

export function weekNightKeys(nightKey) {
  const [y, m, d] = String(nightKey).slice(0, 10).split('-').map(Number)
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay()
  const mondayOffset = dow === 0 ? -6 : 1 - dow
  const start = dateKeyAdd(nightKey, mondayOffset)
  return Array.from({ length: 7 }, (_, i) => dateKeyAdd(start, i))
}

function nightOf(sale) {
  return nightKeyOfSale(sale)
}

function hourOf(sale) {
  const ts = sale?.criado_em || sale?.created_at
  if (!ts) return null
  const d = new Date(ts)
  if (Number.isNaN(d.getTime())) return null
  return tokyoHour(d)
}

function sumSales(rows) {
  return (rows || []).reduce((a, s) => a + (+s.total || 0), 0)
}

function commissionOf(rows) {
  return (rows || []).reduce((a, s) => a + (readTicketMeta(s.obs).commission || 0), 0)
}

function belongsTo(sale, person) {
  const name = orderCastFromObs(sale.obs).trim().toLowerCase()
  const id = orderCastIdFromObs(sale.obs) || sale.drink_back_agent_id || ''
  if (id && (id === person.id)) return true
  if (name && name === String(person.nome || '').trim().toLowerCase()) return true
  return false
}

function monthCost(hq, registry, monthKey) {
  const wages = Math.round(+hq?.books?.staff?.amount || (hq?.payroll || []).reduce((a, r) => a + (+r.pay || 0), 0))
  const reg = (kind) => (registry || []).reduce((a, r) => {
    if (r.kind !== kind) return a
    if (kind === 'variavel' && r.month_key && r.month_key !== monthKey) return a
    return a + Math.round(+r.amount || 0)
  }, 0)
  const rent = reg('aluguel') || Math.round(+hq?.books?.rent?.amount || hq?.rent?.amount || 0)
  const jbm = Math.round(+hq?.books?.jbm?.amount || 0)
  return wages + rent + reg('energia') + reg('fixo') + reg('variavel') + jbm
}

export function buildGoalProgress({
  tickets = [],
  hq = null,
  registry = [],
  goals = null,
  people = [],
  nightKey = tokyoNightKey(),
} = {}) {
  const g = goals || {}
  const abre = g.abre == null ? 20 : g.abre
  const fecha = g.fecha == null ? 5 : g.fecha
  const corta = g.corta == null ? 0 : g.corta
  const monthKey = String(nightKey).slice(0, 7)
  const monthTickets = (tickets || []).filter(s => nightOf(s).startsWith(monthKey) || String(s.data || '').startsWith(monthKey))
  const tonight = monthTickets.filter(s => nightOf(s) === nightKey)
  const weekKeys = weekNightKeys(nightKey)
  const weekRows = monthTickets.filter(s => weekKeys.includes(nightOf(s)))
  const hours = openHours(abre, fecha)
  const nowHour = tokyoHour(new Date())
  const hourRows = tonight.filter(s => hourOf(s) === nowHour)
  const series = hours.map(hour => ({
    hour,
    label: `${String(hour).padStart(2, '0')}:00`,
    sales: sumSales(tonight.filter(s => hourOf(s) === hour)),
    goal: +g.hora || 0,
  }))
  const turnos = [1, 2].map(id => ({
    id,
    sales: sumSales(tonight.filter(s => shiftOf(hourOf(s), abre, corta) === id)),
    goal: +g.turno || 0,
    pct: goalPct(sumSales(tonight.filter(s => shiftOf(hourOf(s), abre, corta) === id)), g.turno),
  }))
  function bandOf(id) {
    const rows = tonight.filter(s => shiftBand(hourOf(s), abre, fecha) === id)
    const byHour = new Map()
    for (const s of rows) {
      const h = hourOf(s)
      if (h == null) continue
      const prev = byHour.get(h) || { hour: h, label: `${String(h).padStart(2, '0')}:00`, sales: 0, count: 0 }
      prev.sales += +s.total || 0
      prev.count += 1
      byHour.set(h, prev)
    }
    const hours = [...byHour.values()].filter(h => h.sales > 0).sort((a, b) => a.hour - b.hour)
    const sales = sumSales(rows)
    return {
      id,
      sales,
      count: rows.length,
      goal: +g.turno || 0,
      pct: goalPct(sales, g.turno),
      hours,
    }
  }
  const bands = { noite: bandOf('noite'), dia: bandOf('dia') }
  const weekDays = weekKeys.map(date => ({
    date,
    sales: sumSales(monthTickets.filter(s => nightOf(s) === date)),
    goal: +g.noite || 0,
  }))
  const salesMonth = Math.round(+hq?.books?.pos?.amount || sumSales(monthTickets))
  const cost = monthCost(hq, registry, monthKey)
  const commMonth = commissionOf(monthTickets)
  const profit = salesMonth - cost - commMonth
  const dayNum = +String(nightKey).slice(8, 10)
  const [yy, mm] = monthKey.split('-').map(Number)
  const dim = lastDayOfMonth(yy, mm) || 30
  const pace = (+g.lucro || 0) > 0 ? Math.round((+g.lucro * dayNum) / dim) : 0
  const nightShare = dim > 0 ? 1 / dim : 0
  const nightProfit = sumSales(tonight) - Math.round(cost * nightShare) - commissionOf(tonight)
  const nightProfitGoal = Math.round((+g.lucro || 0) * nightShare)
  const savedPeople = new Map((g.pessoas || []).map(p => [p.id, p]))
  const cast = (people || []).filter(p => p.drink_back).map(p => {
    const saved = savedPeople.get(p.id) || {}
    const mine = monthTickets.filter(s => belongsTo(s, p))
    const mineNight = mine.filter(s => nightOf(s) === nightKey)
    const mineWeek = mine.filter(s => weekKeys.includes(nightOf(s)))
    return {
      id: p.id,
      nome: p.nome,
      noite: sumSales(mineNight),
      semana: sumSales(mineWeek),
      noiteGoal: +saved.noite || 0,
      semanaGoal: +saved.semana || 0,
      noitePct: goalPct(sumSales(mineNight), saved.noite),
      semanaPct: goalPct(sumSales(mineWeek), saved.semana),
    }
  })

  return {
    nightKey,
    monthKey,
    abre,
    fecha,
    corta,
    noite: { sales: sumSales(tonight), goal: +g.noite || 0, pct: goalPct(sumSales(tonight), g.noite) },
    mes: { sales: salesMonth, goal: +g.mes || 0, pct: goalPct(salesMonth, g.mes) },
    hora: {
      hour: nowHour,
      sales: sumSales(hourRows),
      goal: +g.hora || 0,
      pct: goalPct(sumSales(hourRows), g.hora),
      series,
    },
    semana: {
      sales: sumSales(weekRows),
      goal: +g.semana || 0,
      pct: goalPct(sumSales(weekRows), g.semana),
      days: weekDays,
    },
    turnos,
    bands,
    lucro: {
      sales: salesMonth,
      cost: cost + commMonth,
      profit,
      goal: +g.lucro || 0,
      pct: goalPct(profit, g.lucro),
      pace,
      pacePct: goalPct(profit, pace),
      gap: Math.max(0, Math.round((+g.lucro || 0) - profit)),
      nightProfit,
      nightGoal: nightProfitGoal,
      nightPct: goalPct(nightProfit, nightProfitGoal),
    },
    pessoas: cast,
  }
}
