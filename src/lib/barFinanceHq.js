/**
 * HQ view of one client bar's money: the same month report the bar sees on its own Money page
 * (periodReport / paymentAgenda), plus a six-month cash flow. Pure: runs in Node (API, tests) and the browser.
 */

import { monthBounds, paymentAgenda, periodReport } from './barClose.js'
import { lastDayOfMonth, shiftMonthKey, tokyoNightKey } from './tokyo.js'
import { nightKeyOfSale } from './nightClose.js'

const pad = n => String(n).padStart(2, '0')

/** First and last night of a month; the current month stops at tonight. */
export function monthWindow(monthKey, today = tokyoNightKey()) {
  const [y, m] = String(monthKey).split('-').map(Number)
  const start = `${monthKey}-01`
  const last = `${monthKey}-${pad(lastDayOfMonth(y, m) || 30)}`
  const end = today >= start && today < last ? today : last
  return { start, end, closed: today > last, future: today < start }
}

/** Share of the month's costs the report counts: nights so far ÷ nights in the month (1 for a closed month). */
export function monthShare(report) {
  const [y, m] = String(report?.start || '').slice(0, 7).split('-').map(Number)
  const dim = lastDayOfMonth(y, m) || 30
  return Math.min(1, (report?.nights || 0) / dim)
}

/** Every cost the report counts, as separate lines; month costs are counted for the nights so far, like the bar's own page. */
export function costLines(report) {
  const c = report?.costs || {}
  const share = monthShare(report)
  const part = v => Math.round((+v || 0) * share)
  return [
    { id: 'jbm', value: part(c.jbm) },
    { id: 'wages', value: part(c.wages) },
    { id: 'rent', value: part(c.rent) },
    { id: 'energy', value: part(c.energy) },
    { id: 'fixed', value: part(c.fixed) },
    { id: 'variable', value: part(c.variable) },
    { id: 'cardFee', value: report?.fee || 0 },
    { id: 'commission', value: report?.comm || 0 },
    { id: 'tax', value: report?.tax || 0 },
    { id: 'accountant', value: report?.accountant || 0 },
  ]
}

/** Money summary of a report: sales, all costs, result after tax and both margins. */
export function moneyLine(report) {
  const sales = Math.round(report?.sales || 0)
  const costs = Math.max(0, sales - Math.round(report?.net || 0))
  const result = Math.round(report?.net || 0)
  const drinks = Math.round((report?.costs?.jbm || 0) * monthShare(report))
  return {
    sales,
    costs,
    result,
    count: report?.count || 0,
    ticket: report?.ticket || 0,
    marginPct: sales ? Math.round((result / sales) * 1000) / 10 : null,
    // What is left of sales after paying JBM for the drinks.
    grossPct: sales ? Math.round(((sales - drinks) / sales) * 1000) / 10 : null,
  }
}

/** Snapshot-like object for a past month: JBM bill and rent from the month series, wages from the server's count. */
function hqForMonth(pack, monthKey) {
  if (pack.hq?.mes === monthKey) return pack.hq
  if (pack.hq?.prev?.mes === monthKey) return { books: pack.hq.prev.books, payroll: pack.hq.prev.payroll, rent: pack.hq.prev.rent }
  const row = (pack.hq?.months || []).find(m => m.key === monthKey) || {}
  const wages = Math.round(+pack.wagesByMonth?.[monthKey] || 0)
  return {
    books: {
      jbm: { amount: Math.round(+row.jbm || 0) },
      rent: { amount: Math.round(+row.rent || 0) },
      staff: { amount: wages },
    },
    payroll: [],
  }
}

function ticketsFor(pack) {
  const hq = pack.hq || {}
  const seen = new Set()
  const out = []
  for (const s of [...(hq.pos?.history || []), ...(hq.pos?.tickets || []), ...(hq.prev?.pos?.tickets || [])]) {
    if (!s || seen.has(s.id)) continue
    seen.add(s.id)
    out.push(s)
  }
  return out
}

/** Month report of one bar, as the bar's Money page computes it. */
export function barMonth(pack, monthKey, today = tokyoNightKey()) {
  const win = monthWindow(monthKey, today)
  const report = periodReport({
    tickets: ticketsFor(pack),
    registry: pack.registry || [],
    hq: hqForMonth(pack, monthKey),
    start: win.start,
    end: win.end,
    monthKey,
  })
  return { ...report, monthKey, window: win, share: monthShare(report), money: moneyLine(report), lines: costLines(report) }
}

/** Six months of money in (till) and out (every cost), oldest first. */
export function cashflowSeries(pack, monthKey, count = 6, today = tokyoNightKey()) {
  // Months before the bar's first till sale have no data to compare: leave them out instead of showing only costs.
  const first = ticketsFor(pack).map(s => nightKeyOfSale(s)).filter(Boolean).sort()[0]
  const keys = Array.from({ length: count }, (_, i) => shiftMonthKey(monthKey, -(count - 1 - i)))
    .filter(key => first && key >= first.slice(0, 7))
  return keys.map(key => {
    const r = barMonth(pack, key, today)
    return { key, in: r.money.sales, out: r.money.costs, net: r.money.result }
  })
}

/** Everything the HQ bar page shows, from what /api/bar/bar-finance returns. */
export function barFinanceView(pack, monthKey, today = tokyoNightKey()) {
  const month = barMonth(pack, monthKey, today)
  const prevKey = shiftMonthKey(monthKey, -1)
  const prev = barMonth(pack, prevKey, today)
  const agenda = monthKey === today.slice(0, 7)
    ? paymentAgenda({
      registry: pack.registry || [],
      hq: pack.hq,
      invoices: pack.hq?.jbm?.openInvoices || [],
      tickets: ticketsFor(pack),
      goals: pack.goals || {},
      today,
    }).filter(row => row.days >= 0 && row.days <= 31).slice(0, 12)
    : []
  return {
    month,
    prev,
    cashflow: cashflowSeries(pack, today.slice(0, 7), 6, today),
    agenda,
    bounds: monthBounds(month.window.start),
  }
}

/** One row of the HQ bar list (server builds it so the list stays small). */
export function barListRow(bar, pack, monthKey, today = tokyoNightKey()) {
  const month = barMonth(pack, monthKey, today)
  const prev = barMonth(pack, shiftMonthKey(monthKey, -1), today)
  const growthPct = prev.money.sales ? Math.round(((month.money.sales - prev.money.sales) / prev.money.sales) * 100) : null
  return {
    id: bar.id,
    nome: bar.nome,
    cor: bar.cor || null,
    ...month.money,
    prevSales: prev.money.sales,
    growthPct,
    owesJbm: Math.round(+pack.hq?.jbm?.totalPendente || 0),
    overdueInvoices: +pack.hq?.jbm?.faturasAtraso || 0,
    hasTill: (pack.hq?.pos?.history || []).length > 0,
  }
}
