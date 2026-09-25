/** Weekly and monthly close, payment dates, and salary vs what each person sold. */

import { faturaRemaining } from './barPortal.js'
import { nightKeyOfSale, paySplitFromObs, prevTokyoDateKey } from './nightClose.js'
import { readTicketMeta } from './nightTicket.js'
import { orderCastFromObs } from './orderMeta.js'
import { lastDayOfMonth, tokyoNightKey } from './tokyo.js'

export const WEEK = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb']

export function weekdayOf(dateKey) {
  const [y, m, d] = String(dateKey).slice(0, 10).split('-').map(Number)
  if (!y) return 0
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

export function addDays(dateKey, days) {
  const [y, m, d] = String(dateKey).slice(0, 10).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, '0')}-${String(dt.getUTCDate()).padStart(2, '0')}`
}

function nightsBetween(start, end) {
  const out = []
  let cursor = start
  for (let i = 0; i < 40 && cursor <= end; i += 1) {
    out.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return out
}

export function lastClosedWeek(nightKey, closeWeekday = 0) {
  const cut = ((+closeWeekday % 7) + 7) % 7
  let end = nightKey
  for (let i = 0; i < 7; i += 1) {
    if (weekdayOf(end) === cut) break
    end = prevTokyoDateKey(end)
  }
  if (end === nightKey && weekdayOf(nightKey) !== cut) end = prevTokyoDateKey(end)
  const start = addDays(end, -6)
  const openStart = addDays(end, 1)
  return { start, end, openStart, openEnd: addDays(openStart, 6) }
}

export function monthBounds(nightKey) {
  const month = String(nightKey).slice(0, 7)
  const [y, m] = month.split('-').map(Number)
  const dim = lastDayOfMonth(y, m)
  const prevM = m === 1 ? 12 : m - 1
  const prevY = m === 1 ? y - 1 : y
  const prevDim = lastDayOfMonth(prevY, prevM)
  const pad = n => String(n).padStart(2, '0')
  return {
    start: `${month}-01`,
    end: `${month}-${pad(dim)}`,
    prevStart: `${prevY}-${pad(prevM)}-01`,
    prevEnd: `${prevY}-${pad(prevM)}-${pad(prevDim)}`,
  }
}

function inRange(key, start, end) {
  return key >= start && key <= end
}

function rowsIn(tickets, start, end) {
  return (tickets || []).filter(s => inRange(nightKeyOfSale(s), start, end))
}

export function tenderOf(tickets) {
  const pay = { cash: 0, card: 0, paypay: 0, other: 0 }
  for (const s of tickets || []) {
    const split = paySplitFromObs(s.obs)
    const total = +s.total || 0
    if (split) {
      pay.cash += split.Cash
      pay[split.otherBucket] += split.other
      continue
    }
    const method = String(s.metodo_pagamento || '')
    if (/paypay|ペイペイ/i.test(method)) pay.paypay += total
    else if (/card|credit|debit|visa|クレジット/i.test(method)) pay.card += total
    else if (/cash|現金/i.test(method) || !method) pay.cash += total
    else pay.other += total
  }
  return pay
}

export function vipOf(tickets) {
  return (tickets || []).reduce((a, s) => a + (readTicketMeta(s.obs).roomMin || 0), 0)
}

export function commissionOf(tickets) {
  return (tickets || []).reduce((a, s) => a + (readTicketMeta(s.obs).commission || 0), 0)
}

export function primaryCard(registry) {
  const rows = (registry || []).filter(r => r.kind === 'cartao')
  if (!rows.length) return { pct: 0, days: 0, nome: '', due: 0 }
  const ranked = rows.slice().sort((a, b) => (+b.pct || 0) - (+a.pct || 0))
  const row = ranked[0]
  return {
    pct: +row.pct || 0,
    days: Math.max(0, Math.min(90, Math.round(+row.prazo_dias || 0))),
    nome: row.nome || '',
    due: Math.max(0, Math.min(31, Math.round(+row.vence_dia || 0))),
  }
}

function cardPct(registry) {
  return primaryCard(registry).pct
}

function taxRate(registry) {
  return (registry || []).reduce((a, r) => (r.kind === 'imposto' ? a + (+r.pct || 0) : a), 0)
}

export function fixedMonthCost(registry, hq, monthKey) {
  const sum = (kind) => (registry || []).reduce((a, r) => {
    if (r.kind !== kind) return a
    if (kind === 'variavel' && r.month_key && r.month_key !== monthKey) return a
    return a + Math.round(+r.amount || 0)
  }, 0)
  const rentReg = sum('aluguel')
  const rent = rentReg || Math.round(+hq?.books?.rent?.amount || hq?.rent?.amount || 0)
  return {
    rent,
    rentFrom: rentReg ? 'cadastro' : 'livro',
    energy: sum('energia'),
    fixed: sum('fixo'),
    variable: sum('variavel'),
    jbm: Math.round(+hq?.books?.jbm?.amount || 0),
    wages: Math.round(+hq?.books?.staff?.amount || (hq?.payroll || []).reduce((a, r) => a + (+r.pay || 0), 0)),
    accountant: sum('contador'),
    taxFixed: sum('imposto'),
  }
}

export function cardCash({ tickets = [], registry = [], today = tokyoNightKey() } = {}) {
  const plan = primaryCard(registry)
  let waiting = 0
  let landed = 0
  let grossWaiting = 0
  const deposits = new Map()
  for (const s of tickets || []) {
    const card = tenderOf([s]).card
    if (!card) continue
    const land = addDays(nightKeyOfSale(s), plan.days)
    const net = Math.round(card * (1 - plan.pct / 100))
    if (land > today) {
      waiting += net
      grossWaiting += card
      deposits.set(land, (deposits.get(land) || 0) + net)
    } else {
      landed += net
    }
  }
  const upcoming = [...deposits.entries()]
    .map(([date, amount]) => ({ date, amount, days: daysUntil(today, date) }))
    .filter(row => row.days >= 0 && row.days <= 45)
    .sort((a, b) => a.days - b.days)
  return { ...plan, waiting, landed, grossWaiting, upcoming }
}

function share(nights, dim) {
  if (!dim) return 0
  return nights / dim
}

export function periodReport({ tickets, start, end, registry, hq, monthKey }) {
  const rows = rowsIn(tickets, start, end)
  const nights = nightsBetween(start, end).length
  const [y, m] = String(monthKey || start).slice(0, 7).split('-').map(Number)
  const dim = lastDayOfMonth(y, m) || 30
  const costs = fixedMonthCost(registry, hq, String(monthKey || start).slice(0, 7))
  const sales = rows.reduce((a, s) => a + (+s.total || 0), 0)
  const comm = commissionOf(rows)
  const tender = tenderOf(rows)
  const fee = Math.round(tender.card * cardPct(registry) / 100)
  const ratio = share(nights, dim)
  const allocated = Math.round((costs.rent + costs.energy + costs.fixed + costs.variable + costs.jbm + costs.wages) * ratio)
  const profit = Math.round(sales - fee - comm - allocated)
  const tax = Math.round(sales * taxRate(registry) / 100) + Math.round(costs.taxFixed * ratio)
  const accountant = Math.round(costs.accountant * ratio)
  const net = profit - tax - accountant
  const card = cardCash({ tickets: rows, registry, today: tokyoNightKey() })
  const byNight = nightsBetween(start, end).map(date => ({
    date,
    label: WEEK[weekdayOf(date)],
    sales: rowsIn(tickets, date, date).reduce((a, s) => a + (+s.total || 0), 0),
  }))
  return {
    start, end, nights, sales, count: rows.length,
    ticket: rows.length ? Math.round(sales / rows.length) : 0,
    tender, fee, comm, vip: vipOf(rows), profit, net, tax, accountant, card, allocated, costs, byNight,
  }
}

export function sameWeekdaySales(tickets, nightKey) {
  const prev = addDays(nightKey, -7)
  const now = rowsIn(tickets, nightKey, nightKey).reduce((a, s) => a + (+s.total || 0), 0)
  const before = rowsIn(tickets, prev, prev).reduce((a, s) => a + (+s.total || 0), 0)
  return { nightKey, prev, now, before, delta: now - before }
}

export function stillToSell(sales, goal) {
  const g = +goal || 0
  if (g <= 0) return null
  return Math.max(0, g - Math.round(+sales || 0))
}

function nextOnDay(day, today) {
  const due = Math.max(1, Math.min(28, Math.round(+day || 1)))
  const [y, m, d] = String(today).slice(0, 10).split('-').map(Number)
  const pad = n => String(n).padStart(2, '0')
  let yy = y
  let mm = m
  if (d > due) {
    mm += 1
    if (mm > 12) { mm = 1; yy += 1 }
  }
  return `${yy}-${pad(mm)}-${pad(due)}`
}

function daysUntil(today, date) {
  const [y, m, d] = today.split('-').map(Number)
  const [y2, m2, d2] = date.split('-').map(Number)
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y, m - 1, d)) / 86400000)
}

export function paymentAgenda({
  registry = [],
  hq = null,
  invoices = [],
  tickets = [],
  goals = {},
  today = tokyoNightKey(),
} = {}) {
  const monthKey = String(today).slice(0, 7)
  const costs = fixedMonthCost(registry, hq, monthKey)
  const monthTickets = (tickets || []).filter(s => nightKeyOfSale(s).startsWith(monthKey))
  const comm = commissionOf(monthTickets)
  const fee = Math.round(tenderOf(monthTickets).card * cardPct(registry) / 100)
  const items = []
  const push = (row) => {
    if (!row.amount) return
    const date = row.date || nextOnDay(row.day || 1, today)
    items.push({ ...row, date, days: daysUntil(today, date) })
  }
  push({ id: 'salario', kind: 'salario', amount: costs.wages, day: goals.dia_salario || 25, tab: 'salarios' })
  push({ id: 'drink', kind: 'drink', amount: comm, day: goals.dia_drink || 10, tab: 'pagamentos' })
  push({ id: 'aluguel', kind: 'aluguel', amount: costs.rent, day: (registry.find(r => r.kind === 'aluguel' && r.vence_dia) || {}).vence_dia || 1, tab: 'aluguel' })
  push({ id: 'energia', kind: 'energia', amount: costs.energy, day: (registry.find(r => r.kind === 'energia' && r.vence_dia) || {}).vence_dia || 1, tab: 'energia' })
  push({ id: 'contador', kind: 'contador', amount: costs.accountant, day: (registry.find(r => r.kind === 'contador' && r.vence_dia) || {}).vence_dia || 1, tab: 'contador' })
  const monthSales = monthTickets.reduce((a, s) => a + (+s.total || 0), 0)
  for (const r of registry || []) {
    if (r.kind !== 'imposto') continue
    const amount = Math.round(monthSales * (+r.pct || 0) / 100) + Math.round(+r.amount || 0)
    push({ id: r.id, kind: 'imposto', title: r.nome, amount, day: r.vence_dia || 15, tab: 'imposto' })
  }
  push({ id: 'variavel', kind: 'variavel', amount: costs.variable, day: goals.dia_mes || 1, tab: 'variavel' })
  for (const r of registry || []) {
    if (r.kind !== 'fixo' || !(+r.amount)) continue
    push({ id: r.id, kind: 'fixo', title: r.nome, amount: Math.round(+r.amount || 0), day: r.vence_dia || 1, tab: 'fixo' })
  }
  for (const f of invoices || []) {
    if (f.status === 'pago') continue
    const amount = Math.round(faturaRemaining(f))
    const date = String(f.data_vencimento || '').slice(0, 10)
    if (!date || amount <= 0) continue
    items.push({
      id: `jbm-${f.id}`,
      kind: 'bebidas',
      title: f.numero || 'JBM',
      amount,
      date,
      days: daysUntil(today, date),
      tab: 'faturas',
    })
  }
  const flow = cardCash({ tickets, registry, today })
  for (const row of flow.upcoming) {
    if (!row.amount) continue
    items.push({
      id: `card-${row.date}`,
      kind: 'cartao_cai',
      title: flow.nome,
      amount: row.amount,
      date: row.date,
      days: row.days,
      tab: 'cartao',
      inflow: true,
    })
  }
  const rank = { salario: 0, aluguel: 1, bebidas: 2, imposto: 3, energia: 4, drink: 5, contador: 6, fixo: 7, variavel: 8, cartao: 9, cartao_cai: 20 }
  return items.sort((a, b) => a.days - b.days || (rank[a.kind] ?? 12) - (rank[b.kind] ?? 12))
}

export function salaryBoard({ payroll = [], tickets = [], monthKey }) {
  const monthTickets = (tickets || []).filter(s => nightKeyOfSale(s).startsWith(monthKey))
  const rows = (payroll || []).map(p => {
    const nome = String(p.nome || '').trim().toLowerCase()
    const mine = monthTickets.filter(s => orderCastFromObs(s.obs).trim().toLowerCase() === nome)
    const sales = mine.reduce((a, s) => a + (+s.total || 0), 0)
    const comm = commissionOf(mine)
    const pay = Math.round(+p.pay || 0)
    const hours = +p.hours || 0
    const perHour = hours > 0 ? Math.round(pay / hours) : Math.round(+p.salario_hora || 0)
    const cover = pay > 0 ? sales / pay : 0
    let hint = 'watch'
    if (!pay) hint = 'empty'
    else if (cover >= 3) hint = 'pays'
    else if (cover >= 1) hint = 'tight'
    else if (sales === 0 && hours > 0) hint = 'floor'
    else hint = 'costly'
    return {
      id: p.staff_id,
      nome: p.nome,
      cargo: p.cargo || '',
      hours,
      lateHours: +p.lateHours || 0,
      pay,
      perHour,
      sales,
      comm,
      cover,
      hint,
      open: !!p.open,
      salario_mes: +p.salario_mes || 0,
      shifts: p.shifts || [],
    }
  }).sort((a, b) => b.pay - a.pay)
  const costly = rows.filter(r => r.hint === 'costly' || r.hint === 'floor')
  return {
    rows,
    total: rows.reduce((a, r) => a + r.pay, 0),
    save: costly.reduce((a, r) => a + r.pay, 0),
  }
}
