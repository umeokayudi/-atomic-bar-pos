/**
 * Manager analytics over operational nights (06:00–05:59 Asia/Tokyo).
 * Missing costs stay null. Unassigned tickets are not employee performance.
 */

import { addDays, tenderOf, weekdayOf } from './barClose.js'
import { nightKeyOfSale, hourOfSale } from './nightClose.js'
import { orderCastFromObs, orderCastIdFromObs } from './orderMeta.js'
import { lastDayOfMonth } from './tokyo.js'

export const PRESETS = [
  'today',
  'yesterday',
  'thisWeek',
  'lastWeek',
  'thisMonth',
  'lastMonth',
  'last30',
  'last90',
  'custom',
]

export const COMPARE_MODES = ['previous', 'weekday', 'lastMonth', 'lastYear']

function pad(n) {
  return String(n).padStart(2, '0')
}

function iso(y, m, d) {
  return `${y}-${pad(m)}-${pad(d)}`
}

export function nightsBetween(start, end, cap = 400) {
  const out = []
  if (!start || !end || start > end) return out
  let cursor = start
  for (let i = 0; i < cap && cursor <= end; i += 1) {
    out.push(cursor)
    cursor = addDays(cursor, 1)
  }
  return out
}

function mondayOf(nightKey) {
  const dow = weekdayOf(nightKey)
  const offset = dow === 0 ? -6 : 1 - dow
  return addDays(nightKey, offset)
}

function monthEnd(nightKey) {
  const [y, m] = String(nightKey).slice(0, 7).split('-').map(Number)
  return iso(y, m, lastDayOfMonth(y, m))
}

function shiftMonth(nightKey, delta) {
  const [y, m, d] = String(nightKey).slice(0, 10).split('-').map(Number)
  const idx = y * 12 + (m - 1) + delta
  const ny = Math.floor(idx / 12)
  const nm = ((idx % 12) + 12) % 12 + 1
  const dim = lastDayOfMonth(ny, nm)
  return iso(ny, nm, Math.min(d, dim))
}

function shiftYear(nightKey) {
  const [y, m, d] = String(nightKey).slice(0, 10).split('-').map(Number)
  const dim = lastDayOfMonth(y - 1, m)
  return iso(y - 1, m, Math.min(d, dim))
}

export function periodRange(preset, nightKey, custom = {}) {
  const night = String(nightKey || '').slice(0, 10)
  if (preset === 'yesterday') {
    const day = addDays(night, -1)
    return { preset, start: day, end: day }
  }
  if (preset === 'thisWeek') return { preset, start: mondayOf(night), end: night }
  if (preset === 'lastWeek') {
    const start = addDays(mondayOf(night), -7)
    return { preset, start, end: addDays(start, 6) }
  }
  if (preset === 'thisMonth') return { preset, start: `${night.slice(0, 7)}-01`, end: night }
  if (preset === 'lastMonth') {
    const first = shiftMonth(`${night.slice(0, 7)}-01`, -1)
    return { preset, start: first, end: monthEnd(first) }
  }
  if (preset === 'last30') return { preset, start: addDays(night, -29), end: night }
  if (preset === 'last90') return { preset, start: addDays(night, -89), end: night }
  if (preset === 'custom') {
    const start = String(custom.start || night).slice(0, 10)
    const end = String(custom.end || night).slice(0, 10)
    return start <= end ? { preset, start, end } : { preset, start: end, end: start }
  }
  return { preset: 'today', start: night, end: night }
}

export function comparisonRange(mode, range) {
  const nights = nightsBetween(range.start, range.end)
  const len = Math.max(nights.length, 1)
  if (mode === 'weekday') {
    return { mode, start: addDays(range.start, -7), end: addDays(range.end, -7) }
  }
  if (mode === 'lastMonth') {
    return { mode, start: shiftMonth(range.start, -1), end: shiftMonth(range.end, -1) }
  }
  if (mode === 'lastYear') {
    return { mode, start: shiftYear(range.start), end: shiftYear(range.end) }
  }
  return { mode: 'previous', start: addDays(range.start, -len), end: addDays(range.start, -1) }
}

export function ticketNight(sale) {
  return nightKeyOfSale(sale) || ''
}

export function ticketsInRange(tickets, start, end) {
  return (tickets || []).filter(sale => {
    const key = ticketNight(sale)
    return key && key >= start && key <= end
  })
}

export function historyCoverage(tickets) {
  const nights = (tickets || []).map(ticketNight).filter(Boolean).sort()
  if (!nights.length) return { from: null, to: null, count: 0 }
  return { from: nights[0], to: nights[nights.length - 1], count: nights.length }
}

function rangeCovered(coverage, start, end) {
  if (!coverage.from) return false
  return start >= coverage.from && end <= coverage.to
}

export function salesOf(rows) {
  return (rows || []).reduce((sum, sale) => sum + (+sale.total || 0), 0)
}

export function guestCount(rows) {
  const ids = (rows || []).map(sale => sale.guest_id).filter(Boolean)
  if (!ids.length) return null
  return new Set(ids).size
}

function roundYen(n) {
  return Math.round(n)
}

export function measureSales(rows, { covered, demo }) {
  if (demo && !(rows || []).length && !covered) {
    return { status: 'unavailable', sales: null, orders: null, ticket: null, guests: null }
  }
  if (!covered && !(rows || []).length) {
    return { status: 'unavailable', sales: null, orders: null, ticket: null, guests: null }
  }
  const orders = (rows || []).length
  const sales = roundYen(salesOf(rows))
  return {
    status: orders ? 'available' : 'empty',
    sales,
    orders,
    ticket: orders ? roundYen(sales / orders) : null,
    guests: guestCount(rows),
  }
}

export function compareMetric(current, previous) {
  if (current == null || previous == null) return { abs: null, pct: null }
  const abs = roundYen(current - previous)
  if (!previous) return { abs, pct: null }
  return { abs, pct: Math.round(((current - previous) / previous) * 1000) / 10 }
}

function personKey(sale, people) {
  const id = sale.drink_back_agent_id || orderCastIdFromObs(sale.obs) || ''
  const name = orderCastFromObs(sale.obs).trim().toLowerCase()
  const match = (people || []).find(person => {
    if (id && person.id === id) return true
    if (name && String(person.nome || '').trim().toLowerCase() === name) return true
    return false
  })
  return match ? { id: match.id, nome: match.nome } : null
}

export function employeeSales(rows, people) {
  const buckets = new Map()
  let unassigned = 0
  let unassignedSales = 0
  for (const sale of rows || []) {
    const person = personKey(sale, people)
    if (!person) {
      unassigned += 1
      unassignedSales += +sale.total || 0
      continue
    }
    const prev = buckets.get(person.id) || { id: person.id, nome: person.nome, sales: 0, orders: 0 }
    prev.sales += +sale.total || 0
    prev.orders += 1
    buckets.set(person.id, prev)
  }
  const ranked = [...buckets.values()]
    .map(row => ({
      ...row,
      sales: roundYen(row.sales),
      ticket: row.orders ? roundYen(row.sales / row.orders) : null,
      profit: null,
      hours: null,
      salesPerHour: null,
    }))
    .sort((a, b) => b.sales - a.sales)
  return {
    ranked,
    unassigned,
    unassignedSales: roundYen(unassignedSales),
    profitStatus: 'unavailable',
  }
}

function lineRevenue(line) {
  const qty = +line.qtd
  const price = line.preco_unitario
  if (!Number.isFinite(qty) || qty <= 0) return null
  if (price == null || price === '' || Number.isNaN(+price)) return null
  return { qty, revenue: qty * (+price) }
}

function lineCost(line, qty) {
  if (line.custo_unitario == null || line.custo_unitario === '') return null
  const unit = +line.custo_unitario
  if (!Number.isFinite(unit)) return null
  return unit * qty
}

export function productPerformance(lines, ticketIds) {
  const allowed = ticketIds ? new Set(ticketIds) : null
  const map = new Map()
  let missingPrice = 0
  let missingCost = 0
  for (const line of lines || []) {
    if (allowed && line.pos_venda_id && !allowed.has(line.pos_venda_id)) continue
    const named = String(line.nome || '').trim()
    if (!named) continue
    const money = lineRevenue(line)
    if (!money) {
      missingPrice += 1
      continue
    }
    const key = line.produto_id || named
    const prev = map.get(key) || {
      key,
      nome: named,
      units: 0,
      sales: 0,
      orders: new Set(),
      cost: 0,
      costKnown: true,
    }
    prev.units += money.qty
    prev.sales += money.revenue
    if (line.pos_venda_id) prev.orders.add(line.pos_venda_id)
    const cost = lineCost(line, money.qty)
    if (cost == null) {
      prev.costKnown = false
      missingCost += 1
    } else {
      prev.cost += cost
    }
    map.set(key, prev)
  }
  const rows = [...map.values()].map(row => {
    const sales = roundYen(row.sales)
    const profit = row.costKnown ? roundYen(sales - row.cost) : null
    const margin = profit == null || !sales ? null : Math.round((profit / sales) * 1000) / 10
    return {
      key: row.key,
      nome: row.nome,
      units: row.units,
      sales,
      orders: row.orders.size,
      unitCost: row.costKnown && row.units ? roundYen(row.cost / row.units) : null,
      profit,
      margin,
    }
  })
  return {
    bySales: rows.slice().sort((a, b) => b.sales - a.sales),
    byProfit: rows.filter(row => row.profit != null).sort((a, b) => b.profit - a.profit),
    missingPrice,
    missingCost,
    profitReady: rows.some(row => row.profit != null),
  }
}

export function timeline({ tickets, start, end, grain = 'day', profitByNight = null, filled = true }) {
  const rows = ticketsInRange(tickets, start, end)
  if (grain === 'hour') {
    const points = Array.from({ length: 24 }, (_, hour) => ({
      key: String(hour),
      label: `${pad(hour)}:00`,
      sales: null,
      orders: null,
      profit: null,
    }))
    for (const sale of rows) {
      const hour = hourOfSale(sale)
      if (hour == null) continue
      const point = points[hour]
      point.sales = (point.sales || 0) + (+sale.total || 0)
      point.orders = (point.orders || 0) + 1
    }
    return points.map(point => ({
      ...point,
      sales: point.sales == null ? null : roundYen(point.sales),
    }))
  }
  const nights = nightsBetween(start, end)
  const byNight = new Map(nights.map(night => [night, { sales: 0, orders: 0, seen: false }]))
  for (const sale of rows) {
    const key = ticketNight(sale)
    const bucket = byNight.get(key)
    if (!bucket) continue
    bucket.sales += +sale.total || 0
    bucket.orders += 1
    bucket.seen = true
  }
  if (grain === 'month' || grain === 'week') {
    const groups = new Map()
    for (const night of nights) {
      const key = grain === 'month' ? night.slice(0, 7) : mondayOf(night)
      const prev = groups.get(key) || { key, label: key, sales: 0, orders: 0, nights: 0, withSales: 0 }
      const bucket = byNight.get(night)
      prev.sales += bucket.sales
      prev.orders += bucket.orders
      prev.nights += 1
      if (bucket.seen) prev.withSales += 1
      groups.set(key, prev)
    }
    return [...groups.values()].map(group => ({
      key: group.key,
      label: group.label,
      sales: roundYen(group.sales),
      orders: group.orders,
      profit: null,
      sample: group.withSales,
    }))
  }
  return nights.map(night => {
    const bucket = byNight.get(night)
    const profit = profitByNight && Object.prototype.hasOwnProperty.call(profitByNight, night)
      ? profitByNight[night]
      : null
    return {
      key: night,
      label: night.slice(5),
      sales: bucket.seen || filled ? roundYen(bucket.sales) : null,
      orders: bucket.seen || filled ? bucket.orders : null,
      profit,
      recorded: bucket.seen,
    }
  })
}

export function weekdayRollup(rows) {
  const days = Array.from({ length: 7 }, (_, weekday) => ({
    weekday,
    sales: 0,
    orders: 0,
    profit: null,
  }))
  for (const sale of rows || []) {
    const key = ticketNight(sale)
    if (!key) continue
    const day = days[weekdayOf(key)]
    day.sales += +sale.total || 0
    day.orders += 1
  }
  return days.map(day => ({
    ...day,
    sales: roundYen(day.sales),
    ticket: day.orders ? roundYen(day.sales / day.orders) : null,
  }))
}

export function heatmap(rows) {
  const cells = []
  for (let weekday = 0; weekday < 7; weekday += 1) {
    for (let hour = 0; hour < 24; hour += 1) {
      cells.push({ weekday, hour, sales: 0, orders: 0, profit: null, timed: 0 })
    }
  }
  let undated = 0
  for (const sale of rows || []) {
    const key = ticketNight(sale)
    const hour = hourOfSale(sale)
    if (!key || hour == null) {
      undated += 1
      continue
    }
    const cell = cells[weekdayOf(key) * 24 + hour]
    cell.sales += +sale.total || 0
    cell.orders += 1
    cell.timed += 1
  }
  return {
    cells: cells.map(cell => ({ ...cell, sales: roundYen(cell.sales) })),
    undated,
  }
}

export function paymentMix(rows) {
  const tender = tenderOf(rows)
  const sales = salesOf(rows)
  return {
    tender,
    sales: roundYen(sales),
    refunds: null,
    discounts: null,
    fees: null,
  }
}

export function monthExpenses(registry, monthKey) {
  const rows = (registry || []).filter(row => {
    if (!row || row.amount == null || row.amount === '') return false
    if (row.month_key && row.month_key !== monthKey) return false
    return ['aluguel', 'energia', 'fixo', 'variavel', 'contador', 'imposto'].includes(row.kind)
  })
  return rows.map(row => ({
    kind: row.kind,
    amount: roundYen(+row.amount || 0),
    month: row.month_key || monthKey,
    note: 'Registered amount. Not cash movement and not profit.',
  }))
}

export function buildInsights({ current, previous, products, employees, heatmap: heat, range }) {
  const notes = []
  if (current.sales != null && previous.sales != null && current.sales !== previous.sales) {
    const change = compareMetric(current.sales, previous.sales)
    const ticketChange = compareMetric(current.ticket, previous.ticket)
    notes.push({
      id: 'sales-change',
      text: ticketChange.pct == null
        ? `Net sales moved ${change.abs >= 0 ? 'up' : 'down'} ${Math.abs(change.abs)} yen versus the comparison window.`
        : `Net sales moved ${change.pct >= 0 ? 'up' : 'down'} ${Math.abs(change.pct)}% versus the comparison window. Average ticket moved ${ticketChange.pct >= 0 ? 'up' : 'down'} ${Math.abs(ticketChange.pct)}%.`,
      period: `${range.start} → ${range.end}`,
      source: 'pos_vendas.total on the operational night',
      completeness: current.status,
    })
  }
  const topProfit = products?.byProfit?.[0]
  if (topProfit) {
    notes.push({
      id: 'top-profit',
      text: `${topProfit.nome} recorded the highest gross profit in this set (${topProfit.profit} yen).`,
      period: `${range.start} → ${range.end}`,
      source: 'lines with a recorded unit cost',
      completeness: 'available',
    })
  } else if (products && products.bySales?.length && !products.profitReady) {
    notes.push({
      id: 'profit-missing',
      text: 'Product sales are ranked by recorded revenue. A profit ranking is omitted because unit cost is missing.',
      period: `${range.start} → ${range.end}`,
      source: 'pos line items',
      completeness: 'partial',
    })
  }
  const peak = (heat?.cells || []).reduce((best, cell) => {
    if (!cell.orders) return best
    if (!best || cell.sales > best.sales) return cell
    return best
  }, null)
  if (peak && peak.orders >= 1) {
    const names = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
    notes.push({
      id: 'peak-cell',
      text: `${names[peak.weekday]} ${pad(peak.hour)}:00–${pad((peak.hour + 1) % 24)}:00 has the highest recorded sales in the heatmap (${peak.sales} yen, ${peak.orders} ticket${peak.orders === 1 ? '' : 's'}). A quiet hour is not scored as poor performance.`,
      period: `${range.start} → ${range.end}`,
      source: 'ticket clock time in Asia/Tokyo',
      completeness: heat.undated ? 'partial' : 'available',
    })
  }
  const topEmployee = employees?.ranked?.[0]
  if (topEmployee) {
    notes.push({
      id: 'top-employee',
      text: `${topEmployee.nome} has the highest attributed sales in this period (${topEmployee.sales} yen). Unassigned tickets are excluded. Profit per person is not calculated.`,
      period: `${range.start} → ${range.end}`,
      source: 'drink_back_agent_id or Cast note',
      completeness: employees.unassigned ? 'partial' : 'available',
    })
  }
  return notes
}

export function analyze({
  tickets = [],
  lines = null,
  people = [],
  registry = [],
  payroll = null,
  preset = 'today',
  nightKey,
  custom,
  compare = 'previous',
  grain = 'auto',
  demo = false,
  targetPerNight = 0,
}) {
  const range = periodRange(preset, nightKey, custom)
  const compareTo = comparisonRange(compare, range)
  const coverage = historyCoverage(tickets)
  const covered = demo ? false : (coverage.count ? rangeCovered(coverage, range.start, range.end) || ticketsInRange(tickets, range.start, range.end).length > 0 : false)
  const currentRows = ticketsInRange(tickets, range.start, range.end)
  const previousRows = ticketsInRange(tickets, compareTo.start, compareTo.end)
  const previousCovered = !demo && coverage.count
    ? rangeCovered(coverage, compareTo.start, compareTo.end) || previousRows.length > 0
    : false
  const current = measureSales(currentRows, { covered: demo ? false : covered || currentRows.length > 0, demo })
  const previous = measureSales(previousRows, { covered: previousCovered, demo })
  if (demo) {
    current.status = 'unavailable'
    current.sales = null
    current.orders = null
    current.ticket = null
    previous.status = 'unavailable'
    previous.sales = null
  }
  const nights = nightsBetween(range.start, range.end)
  const chosenGrain = grain === 'auto'
    ? (nights.length <= 1 ? 'hour' : nights.length <= 45 ? 'day' : nights.length <= 120 ? 'week' : 'month')
    : grain
  const products = lines == null
    ? { bySales: [], byProfit: [], missingPrice: 0, missingCost: 0, profitReady: false, status: 'unavailable' }
    : { ...productPerformance(lines, new Set(currentRows.map(row => row.id).filter(Boolean))), status: 'available' }
  const employees = employeeSales(current.status === 'unavailable' ? [] : currentRows, people)
  const heat = heatmap(current.status === 'unavailable' ? [] : currentRows)
  const expenses = monthExpenses(registry, range.end.slice(0, 7))
  const labor = Array.isArray(payroll) && payroll.length && range.start.slice(0, 7) === range.end.slice(0, 7)
    ? {
      status: 'available',
      amount: roundYen(payroll.reduce((sum, row) => sum + (Number.isFinite(+row.pay) ? +row.pay : 0), 0)),
      partial: payroll.some(row => !Number.isFinite(+row.pay)),
      note: 'Month payroll book. It is not split into nights and it is not gross profit.',
    }
    : { status: 'unavailable', amount: null, partial: false, note: 'Labor cost is not loaded for this range.' }
  const report = {
    timezone: 'Asia/Tokyo',
    operationalDay: '06:00–05:59',
    range,
    compareTo,
    coverage,
    current,
    previous,
    salesChange: compareMetric(current.sales, previous.sales),
    ticketChange: compareMetric(current.ticket, previous.ticket),
    ordersChange: compareMetric(current.orders, previous.orders),
    timeline: current.status === 'unavailable' ? [] : timeline({
      tickets,
      start: range.start,
      end: range.end,
      grain: chosenGrain,
      filled: !demo && coverage.count ? rangeCovered(coverage, range.start, range.end) : false,
    }),
    grain: chosenGrain,
    weekdays: current.status === 'unavailable' ? [] : weekdayRollup(currentRows),
    heatmap: heat,
    payments: current.status === 'unavailable' ? null : paymentMix(currentRows),
    products,
    employees,
    expenses,
    labor,
    cashVariance: { status: 'unavailable', amount: null, note: 'No counted closing is on the loaded books.' },
    grossProfit: { status: 'unavailable', amount: null, note: 'Gross profit needs recorded unit cost. Sales are not used as cost.' },
    grossMargin: { status: 'unavailable', amount: null },
    targetPerNight: +targetPerNight > 0 ? +targetPerNight : null,
    insights: [],
  }
  report.insights = buildInsights({
    current: report.current,
    previous: report.previous,
    products: report.products,
    employees: report.employees,
    heatmap: report.heatmap,
    range,
  })
  return report
}
