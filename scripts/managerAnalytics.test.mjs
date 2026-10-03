import assert from 'node:assert/strict'
import { tokyoWallToUtcMs } from '../src/lib/tokyo.js'
import {
  analyze,
  comparisonRange,
  employeeSales,
  periodRange,
  productPerformance,
  salesOf,
  ticketNight,
  validSaleAmount,
} from '../src/lib/managerAnalytics.js'

const night = '2026-10-01'

function sale(partial) {
  return {
    id: partial.id,
    total: partial.total,
    criado_em: partial.at,
    data: partial.data,
    obs: partial.obs || '',
    metodo_pagamento: partial.pay || 'Cash',
    drink_back_agent_id: partial.agent || null,
    guest_id: partial.guest,
  }
}

const at = (day, hour) => new Date(tokyoWallToUtcMs(...day.split('-').map(Number), hour, 10)).toISOString()

const tickets = [
  sale({ id: 'a', total: 10000, at: at('2026-10-01', 21), agent: 'e1', guest: 'g1', pay: 'Cash' }),
  sale({ id: 'b', total: 4000, at: at('2026-10-01', 22), guest: 'g2', pay: 'Card' }),
  sale({ id: 'c', total: 8000, at: at('2026-09-24', 21), agent: 'e1', pay: 'Cash' }),
  sale({ id: 'd', total: 2000, at: at('2026-10-02', 3), agent: 'e2', pay: 'Cash' }),
]

assert.equal(ticketNight(tickets[3]), '2026-10-01', '03:00 stays on the operational night')
assert.equal(ticketNight({ obs: 'Demo POS sample', criado_em: at('2026-10-01', 21), total: 9 }), '')

const today = periodRange('today', night)
assert.deepEqual(today, { preset: 'today', start: night, end: night })
const last30 = periodRange('last30', night)
assert.equal(last30.start, '2026-09-02')
assert.equal(last30.end, night)

const previous = comparisonRange('previous', today)
assert.deepEqual(previous, { mode: 'previous', start: '2026-09-30', end: '2026-09-30' })
const weekday = comparisonRange('weekday', today)
assert.equal(weekday.start, '2026-09-24')

const report = analyze({
  tickets,
  people: [{ id: 'e1', nome: 'Aki' }, { id: 'e2', nome: 'Ren' }],
  preset: 'today',
  nightKey: night,
  compare: 'weekday',
  demo: false,
})
assert.equal(report.timezone, 'Asia/Tokyo')
assert.equal(report.current.sales, 16000)
assert.equal(report.current.orders, 3)
assert.equal(report.current.guests, 2)
assert.equal(report.previous.sales, 8000)
assert.equal(report.salesChange.pct, 100)
assert.equal(report.grossProfit.status, 'unavailable')
assert.equal(report.grossProfit.amount, null)
assert.equal(report.employees.ranked[0].nome, 'Aki')
assert.equal(report.employees.ranked.find(row => row.nome === 'Ren').sales, 2000)
assert.equal(report.employees.unassigned, 1)
assert.equal(report.employees.ranked.some(row => row.id === 'unassigned'), false)
assert.equal(report.employees.ranked[0].profit, null)

const voided = sale({ id: 'voided', total: 9000, at: at('2026-10-01', 23), pay: 'Cash' })
voided.void_status = 'void'
voided.refunded = 9000
const partialRefund = sale({ id: 'partial', total: 4000, at: at('2026-10-01', 23), pay: 'Cash' })
partialRefund.void_status = 'partial_refund'
partialRefund.refunded = 1000
const overRefund = sale({ id: 'over', total: 2000, at: at('2026-10-01', 23), pay: 'Cash' })
overRefund.refunded = 9000
assert.equal(validSaleAmount(voided), 0)
assert.equal(validSaleAmount(partialRefund), 3000)
assert.equal(validSaleAmount(overRefund), 0)
assert.equal(salesOf([voided, partialRefund, overRefund, voided]), 3000)
const withVoid = analyze({
  tickets: [...tickets, voided],
  people: [{ id: 'e1', nome: 'Aki' }, { id: 'e2', nome: 'Ren' }],
  preset: 'today',
  nightKey: night,
  compare: 'weekday',
  demo: false,
})
assert.equal(withVoid.current.sales, 16000)
assert.equal(withVoid.current.orders, 3)

const products = productPerformance([
  { pos_venda_id: 'a', nome: 'Highball', qtd: 4, preco_unitario: 800, custo_unitario: 200 },
  { pos_venda_id: 'a', nome: 'Wine', qtd: 1, preco_unitario: 1200 },
  { pos_venda_id: 'z', nome: 'Other night', qtd: 9, preco_unitario: 100, custo_unitario: 10 },
], new Set(['a']))
assert.equal(products.bySales[0].nome, 'Highball')
assert.equal(products.byProfit.length, 1)
assert.equal(products.byProfit[0].nome, 'Highball')
assert.equal(products.byProfit.some(row => row.nome === 'Wine'), false)
assert.equal(products.missingCost, 1)

const empty = analyze({ tickets: [], preset: 'today', nightKey: night, demo: true })
assert.equal(empty.current.sales, null)
assert.equal(empty.current.status, 'unavailable')
assert.equal(empty.timeline.length, 0)

const partial = analyze({
  tickets: [sale({ id: 'only', total: 500, at: at('2026-10-01', 20) })],
  preset: 'last30',
  nightKey: night,
  demo: false,
})
assert.equal(partial.timeline.some(point => point.sales == null), true)

console.log('manager analytics tests passed')
