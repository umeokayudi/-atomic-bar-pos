/** Numbers for the bar admin page. POS till stays separate from the JBM bill. */

import { aggregateHourlySales } from './atomicPos.js'
import { faturaRemaining } from './barPortal.js'
import { commissionOf, tenderOf } from './barClose.js'
import { nightKeyOfSale, prevTokyoDateKey } from './nightClose.js'
import { readTicketMeta } from './nightTicket.js'
import { orderCastFromObs, orderCastIdFromObs } from './orderMeta.js'
import { tokyoNightKey, tokyoDateKey } from './tokyo.js'

function daysBetween(fromKey, toKey) {
  const [y, m, d] = String(fromKey).slice(0, 10).split('-').map(Number)
  const [y2, m2, d2] = String(toKey).slice(0, 10).split('-').map(Number)
  if (!y || !y2) return null
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y, m - 1, d)) / 86400000)
}

function sumKind(registry, kind, monthKey) {
  return (registry || []).reduce((a, r) => {
    if (r.kind !== kind) return a
    if (kind === 'variavel' && r.month_key && r.month_key !== monthKey) return a
    return a + Math.round(+r.amount || 0)
  }, 0)
}

export function buildBarDesk({
  tickets = [],
  hq = null,
  invoices = [],
  registry = [],
  today = tokyoDateKey(),
  nightKey = tokyoNightKey(),
} = {}) {
  const monthKey = String(today).slice(0, 7)
  const monthTickets = (tickets || []).filter(s => nightKeyOfSale(s).startsWith(monthKey) || String(s.data || '').startsWith(monthKey))
  const posIn = Math.round(+hq?.books?.pos?.amount || monthTickets.reduce((a, s) => a + (+s.total || 0), 0))
  const wages = Math.round(+hq?.books?.staff?.amount || (hq?.payroll || []).reduce((a, r) => a + (+r.pay || 0), 0))
  const rentRegistry = sumKind(registry, 'aluguel', monthKey)
  const rent = rentRegistry || Math.round(+hq?.books?.rent?.amount || hq?.rent?.amount || 0)
  const energy = sumKind(registry, 'energia', monthKey)
  const fixed = sumKind(registry, 'fixo', monthKey)
  const variable = sumKind(registry, 'variavel', monthKey)
  const jbm = Math.round(+hq?.books?.jbm?.amount || 0)
  const cardRows = (registry || []).filter(r => r.kind === 'cartao' && +r.pct > 0)
  const cardRate = cardRows.length ? Math.max(...cardRows.map(r => +r.pct || 0)) : 0
  const tender = tenderOf(monthTickets)
  const fee = Math.round(tender.card * cardRate / 100)
  const commission = commissionOf(monthTickets)
  const out = wages + rent + energy + fixed + variable + jbm + fee + commission

  const alerts = []
  for (const f of invoices || []) {
    if (f.status === 'pago') continue
    const amount = faturaRemaining(f)
    if (amount <= 0) continue
    const due = String(f.data_vencimento || f.periodo_fim || '').slice(0, 10)
    const days = due ? daysBetween(today, due) : null
    if (days == null || days > 14) continue
    alerts.push({
      id: `f-${f.id || due}`,
      tone: days < 0 ? 'bad' : 'soon',
      title: f.numero || f.descricao || 'JBM',
      amount,
      days,
      tab: 'faturas',
      sort: days,
    })
  }
  const monthly = [
    rent > 0 && { id: 'rent', titleKey: 'rent', amount: rent, tab: 'aluguel' },
    energy > 0 && { id: 'energy', titleKey: 'power', amount: energy, tab: 'energia' },
    fixed > 0 && { id: 'fixed', titleKey: 'fixed', amount: fixed, tab: 'fixo' },
    variable > 0 && { id: 'variable', titleKey: 'variable', amount: variable, tab: 'variavel' },
    wages > 0 && { id: 'wages', titleKey: 'labor', amount: wages, tab: 'ponto' },
  ].filter(Boolean)
  for (const row of monthly) {
    alerts.push({ ...row, tone: 'month', days: 0, sort: 20 })
  }
  alerts.sort((a, b) => a.sort - b.sort)

  let cursor = nightKey
  const days = []
  for (let i = 0; i < 14; i += 1) {
    const rows = (tickets || []).filter(s => nightKeyOfSale(s) === cursor)
    days.push({
      date: cursor,
      total: rows.reduce((a, s) => a + (+s.total || 0), 0),
      count: rows.length,
    })
    cursor = prevTokyoDateKey(cursor)
  }
  days.reverse()

  const tonightRows = (tickets || []).filter(s => nightKeyOfSale(s) === nightKey)
  const hourNight = tonightRows.length ? nightKey : (days.slice().reverse().find(d => d.total > 0)?.date || nightKey)
  const hourRows = (tickets || []).filter(s => nightKeyOfSale(s) === hourNight)
  const hourlyAll = aggregateHourlySales(hourRows)
  const hourly = [...hourlyAll.slice(18), ...hourlyAll.slice(0, 6)]
  const peak = hourly.reduce((best, h) => (h.total > best.total ? h : best), hourly[0])

  const castMap = new Map()
  for (const s of monthTickets) {
    const name = orderCastFromObs(s.obs)
    const id = orderCastIdFromObs(s.obs) || s.drink_back_agent_id || ''
    if (!name && !id) continue
    const key = id || name
    const prev = castMap.get(key) || { id: key, name: name || 'Cast', sales: 0, commission: 0, tickets: 0 }
    if (name) prev.name = name
    prev.sales += +s.total || 0
    prev.tickets += 1
    const comm = readTicketMeta(s.obs).commission
    if (comm) prev.commission += comm
    castMap.set(key, prev)
  }
  const cast = [...castMap.values()].sort((a, b) => b.sales - a.sales)

  return {
    monthKey,
    cash: {
      inn: posIn,
      out,
      net: posIn - out,
      lines: [
        { key: 'pos', amount: posIn, sign: 1 },
        { key: 'labor', amount: wages, sign: -1 },
        { key: 'rent', amount: rent, sign: -1 },
        { key: 'power', amount: energy, sign: -1 },
        { key: 'fixed', amount: fixed, sign: -1 },
        { key: 'variable', amount: variable, sign: -1 },
        { key: 'jbm', amount: jbm, sign: -1 },
        { key: 'fee', amount: fee, sign: -1 },
        { key: 'commission', amount: commission, sign: -1 },
      ].filter(l => l.amount > 0),
    },
    alerts,
    days,
    hourly,
    hourNight,
    peak: peak?.total ? peak : null,
    cast,
    labor: {
      total: wages,
      hours: hq?.hoursTotal || 0,
      rows: hq?.payroll || [],
    },
  }
}
