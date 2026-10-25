/**
 * Drink back page: which nights to show, and each woman's totals over them. Pure: no fetch, no writes.
 * Day keys are night keys (pos_vendas.data, 06:00–05:59 JST), so "today" is tonight's shift.
 */

import { personCredit, staffAliases } from './saleCredit.js'
import { tokyoNightKey } from './tokyo.js'
import { monthBounds, shiftMonth } from './barCalendar.js'

export const DRINK_BACK_PRESETS = ['today', 'yesterday', 'week', 'month', 'prev']

function addDays(key, days) {
  const [y, m, d] = String(key).slice(0, 10).split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d + days))
  return dt.toISOString().slice(0, 10)
}

/** { from, to } (inclusive YYYY-MM-DD) for a preset id. Unknown ids fall back to this month. */
export function presetRange(id, today = tokyoNightKey()) {
  if (id === 'today') return { from: today, to: today }
  if (id === 'yesterday') { const y = addDays(today, -1); return { from: y, to: y } }
  if (id === 'week') return { from: addDays(today, -6), to: today }
  if (id === 'prev') return monthBounds(shiftMonth(today.slice(0, 7), -1))
  return monthBounds(today.slice(0, 7))
}

/** The preset a from/to pair matches, or 'custom'. */
export function presetOf(from, to, today = tokyoNightKey()) {
  for (const id of DRINK_BACK_PRESETS) {
    const r = presetRange(id, today)
    if (r.from === from && r.to === to) return id
  }
  return 'custom'
}

/** Sales on nights from..to (inclusive). Sales without a date are left out. */
export function salesInRange(sales = [], from, to) {
  return (sales || []).filter(s => {
    const d = String(s?.data || '').slice(0, 10)
    return !!d && (!from || d >= from) && (!to || d <= to)
  })
}

/**
 * One row per agent with totals and a per-night breakdown, best seller first (inactive last).
 * Only tickets she is marked on count (castOnly); a shared ticket is split equally (saleCredit.js).
 */
export function drinkBackBoard(sales = [], agents = []) {
  const aliases = staffAliases(agents)
  const ticketIds = new Set()
  const rows = (agents || []).map(agent => {
    const mine = personCredit(sales, { id: agent.id, agentId: agent.id, nome: agent.nome }, { aliases, castOnly: true })
    const byDay = new Map()
    for (const r of mine.rows) {
      ticketIds.add(r.sale?.id ?? r.sale)
      const day = String(r.sale?.data || '').slice(0, 10)
      const prev = byDay.get(day) || { day, tickets: 0, revenue: 0, commission: 0 }
      prev.tickets += 1
      prev.revenue += r.amount
      prev.commission += r.commission
      byDay.set(day, prev)
    }
    return {
      ...agent,
      tickets: mine.tickets,
      revenue: mine.sales,
      commission: mine.commission,
      days: [...byDay.values()].sort((a, b) => (a.day < b.day ? 1 : -1)),
    }
  })
  rows.sort((a, b) => (!!b.ativo - !!a.ativo) || (b.revenue - a.revenue) || String(a.nome).localeCompare(String(b.nome)))
  const totals = rows.reduce((t, r) => ({
    revenue: t.revenue + r.revenue,
    commission: t.commission + r.commission,
    earners: t.earners + (r.tickets > 0 ? 1 : 0),
  }), { revenue: 0, commission: 0, earners: 0 })
  // A ticket shared by two women is one ticket here, not two.
  totals.tickets = ticketIds.size
  return { rows, totals }
}

/** Notes shown to people: the "staff:<id>" link line is internal. */
export function visibleNotes(notas) {
  const s = String(notas || '').trim()
  return /^staff:/.test(s) ? '' : s
}
