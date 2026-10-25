/**
 * One employee's night and earnings from data that already exists (till tickets, time-clock punches, pay
 * fields). Pure: the server and the staff app share it. Nothing here writes.
 *
 * Sales credit uses the shared rule in saleCredit.js (people marked on the ticket share it equally, else
 * the drink-back agent, else whoever rang it up), so the staff app, the day report and payroll agree.
 */

import { calcPayWithLateNight, pairPunches, lateNightHoursBetween } from './timeClock.js'
import { nightKeyOfSale, saleNet, saleStamp } from './nightClose.js'
import { creditFor, staffAliases } from './saleCredit.js'
import { tokyoDateKey } from './tokyo.js'

/** My part of a ticket: { amount, commission, share } or null (see saleCredit.creditFor). */
export function myCredit(sale, me, aliases) {
  return creditFor(sale, me, { aliases })
}

function lineName(it) {
  return String(it?.nome || it?.drink_nome || it?.produto_nome || '').trim() || '—'
}

function isForCast(it) {
  return !!(it?.forCast || it?.for_cast) && !it?.produto_id
}

function tally(lines) {
  const map = new Map()
  for (const it of lines) {
    const k = lineName(it)
    map.set(k, (map.get(k) || 0) + Math.max(0, +it.qtd || 0))
  }
  return [...map.entries()].map(([nome, qtd]) => ({ nome, qtd })).sort((a, b) => b.qtd - a.qtd || a.nome.localeCompare(b.nome))
}

/**
 * What I sold and drank on one night.
 * sales: till tickets (pos_vendas) · items: their lines (pos_vendas_itens) · me: { id, nome } · night: 'YYYY-MM-DD'
 */
export function myNightSummary({ sales = [], items = [], me, night, agents = [] }) {
  const aliases = staffAliases(agents)
  const mine = []
  for (const s of sales || []) {
    if (night && nightKeyOfSale(s) !== night) continue
    const hit = myCredit(s, me, aliases)
    if (hit) mine.push({ sale: s, ...hit })
  }
  const ids = new Set(mine.map(r => r.sale.id))
  const lines = (items || []).filter(it => ids.has(it.pos_venda_id || it.venda_id))
  const drinks = lines.filter(isForCast)
  return {
    night: night || '',
    tickets: mine.length,
    sales: mine.reduce((a, r) => a + r.amount, 0),
    commission: mine.reduce((a, r) => a + r.commission, 0),
    shared: mine.filter(r => r.share < 1).length,
    sold: tally(lines.filter(it => !isForCast(it))).slice(0, 12),
    drinkBacks: tally(drinks).slice(0, 12),
    drinkBackCount: drinks.reduce((a, it) => a + Math.max(0, +it.qtd || 0), 0),
  }
}

/** Night goal for me: my personal target from the goals screen, else none. Missed = target set and not reached. */
export function myGoalStatus({ goals, meId, mySales = 0 }) {
  const mine = (goals?.pessoas || []).find(p => p.id === meId) || null
  const target = Math.max(0, Math.round(+mine?.noite || 0))
  return {
    target,
    week: Math.max(0, Math.round(+mine?.semana || 0)),
    reached: target > 0 ? mySales >= target : null,
    missed: target > 0 && mySales < target,
    pct: target > 0 ? Math.min(100, Math.round((mySales / target) * 100)) : null,
  }
}

function addDaysKey(key, n) {
  const [y, m, d] = key.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + n))
  return dt.toISOString().slice(0, 10)
}

/** Every 'YYYY-MM-DD' from `from` to `to` (inclusive), at most 400. */
export function daysBetween(from, to) {
  const out = []
  if (!/^\d{4}-\d{2}-\d{2}$/.test(from || '') || !/^\d{4}-\d{2}-\d{2}$/.test(to || '') || from > to) return out
  for (let k = from; k <= to && out.length < 400; k = addDaysKey(k, 1)) out.push(k)
  return out
}

/** Day / Week / Month / custom → { from, to } day keys (Tokyo). Week starts on Monday. */
export function earningsRange(kind, today = tokyoDateKey(), custom = {}) {
  if (kind === 'day') return { from: today, to: today }
  if (kind === 'week') {
    const [y, m, d] = today.split('-').map(Number)
    const dow = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() + 6) % 7
    return { from: addDaysKey(today, -dow), to: addDaysKey(today, 6 - dow) }
  }
  if (kind === 'month') {
    const [y, m] = today.split('-').map(Number)
    const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
    return { from: `${today.slice(0, 7)}-01`, to: `${y}-${String(m).padStart(2, '0')}-${String(last).padStart(2, '0')}` }
  }
  const from = custom.from || today
  const to = custom.to && custom.to >= from ? custom.to : from
  return { from, to }
}

/**
 * Earnings per bar night (like a driver app): hours pay from my punches at my rate (late-night premium as
 * the clock pays it), commission from my tickets, sales credited to me. Payroll lines (rewards, advances,
 * deductions) are added by the caller from the pay statement.
 */
export function earningsByDay({ punches = [], sales = [], me, rate = 0, nightPremium = true, from, to, now = new Date(), agents = [] }) {
  const aliases = staffAliases(agents)
  const days = daysBetween(from, to)
  const byDay = Object.fromEntries(days.map(k => [k, { day: k, hours: 0, lateHours: 0, hoursPay: 0, sales: 0, commission: 0, tickets: 0, barSales: 0, open: false }]))
  const mine = (punches || []).filter(p => p && p.staff_id === me?.id)
  // My time at the bar: clock-in to clock-out (an open shift up to now), to count the whole bar's sales in it.
  const windows = []
  for (const sh of pairPunches(mine)) {
    const inAt = sh.clockIn?.punched_at
    if (!inAt) continue
    const key = nightKeyOfSale({ criado_em: inAt })
    const row = byDay[key]
    if (!row) continue
    const outAt = sh.clockOut?.punched_at || (sh.open ? (now instanceof Date ? now : new Date(now)).toISOString() : null)
    if (outAt) windows.push({ from: Date.parse(inAt), to: Date.parse(outAt), row })
    let hours = sh.hours || 0
    let late = sh.lateHours || 0
    if (sh.open) {
      const end = (now instanceof Date ? now : new Date(now)).toISOString()
      hours = Math.max(0, Math.round(((Date.parse(end) - Date.parse(inAt)) / 3600000) * 100) / 100)
      late = lateNightHoursBetween(inAt, end)
      row.open = true
    }
    row.hours = Math.round((row.hours + hours) * 100) / 100
    row.lateHours = Math.round((row.lateHours + late) * 100) / 100
    row.hoursPay += calcPayWithLateNight(hours, late, rate, nightPremium)
  }
  for (const s of sales || []) {
    const at = saleStamp(s)?.getTime()
    const w = at != null && nightKeyOfSale(s) ? windows.find(x => at >= x.from && at <= x.to) : null
    if (w) w.row.barSales += saleNet(s)
    const row = byDay[nightKeyOfSale(s)]
    if (!row) continue
    const hit = myCredit(s, me, aliases)
    if (!hit) continue
    row.sales += hit.amount
    row.commission += hit.commission
    row.tickets += 1
  }
  const list = days.map(k => byDay[k])
  const totals = list.reduce((a, r) => ({
    hours: Math.round((a.hours + r.hours) * 100) / 100,
    hoursPay: a.hoursPay + r.hoursPay,
    sales: a.sales + r.sales,
    commission: a.commission + r.commission,
    tickets: a.tickets + r.tickets,
    barSales: a.barSales + r.barSales,
  }), { hours: 0, hoursPay: 0, sales: 0, commission: 0, tickets: 0, barSales: 0 })
  return { days: list, totals: { ...totals, earned: totals.hoursPay + totals.commission } }
}

/** Payroll statement lines inside a range → rewards / bonus (add) and advances / deductions (take). */
export function statementInRange(lines = [], from, to) {
  const inside = (lines || []).filter(l => {
    const k = String(l.created_at || l.criado_em || l.date || '').slice(0, 10)
    return !k || (k >= from && k <= to)
  })
  let rewards = 0
  let advances = 0
  let deductions = 0
  for (const l of inside) {
    const v = Math.round(+l.amount || 0)
    if (l.type === 'reward' || l.type === 'bonus') rewards += v
    else if (l.type === 'advance') advances += Math.abs(v)
    else if (l.type === 'deduction' || (l.type === 'adjustment' && v < 0)) deductions += Math.abs(v)
  }
  return { rewards, advances, deductions }
}
