import assert from 'node:assert/strict'
import { barFinanceView, barListRow, monthWindow, moneyLine } from '../src/lib/barFinanceHq.js'

const today = '2026-10-15'
const tick = (id, data, total, metodo = 'Cash') => ({ id, data, criado_em: null, total, obs: '', metodo_pagamento: metodo })
const pack = {
  hq: {
    mes: '2026-10',
    books: { pos: { amount: 30000 }, jbm: { amount: 6200 }, staff: { amount: 3100 }, rent: { amount: 0 } },
    payroll: [{ staff_id: 's1', nome: 'A', hours: 10, pay: 3100 }],
    prev: { mes: '2026-09', books: { jbm: { amount: 9000 }, staff: { amount: 6000 }, rent: { amount: 0 } }, payroll: [], rent: { amount: 0 }, pos: { tickets: [] } },
    months: [{ key: '2026-08', jbm: 1000, rent: 0 }],
    pos: { tickets: [tick('a', '2026-10-01', 10000), tick('b', '2026-10-02', 20000, 'Card')], history: [tick('a', '2026-10-01', 10000), tick('b', '2026-10-02', 20000, 'Card'), tick('c', '2026-09-10', 40000)] },
    jbm: { openInvoices: [], totalPendente: 5000, faturasAtraso: 1 },
  },
  registry: [{ id: 'r1', kind: 'aluguel', amount: 31000, nome: 'Rent' }],
  goals: {},
  wagesByMonth: { '2026-08': 500 },
}

assert.deepEqual(monthWindow('2026-10', today), { start: '2026-10-01', end: '2026-10-15', closed: false, future: false })
assert.equal(monthWindow('2026-09', today).closed, true)

const v = barFinanceView(pack, '2026-10', today)
assert.equal(v.month.money.sales, 30000)
assert.equal(v.month.nights, 15)
// Rent 31000 over 31 nights → 15000 for 15 nights; JBM 6200 → 3000; wages 3100 → 1500.
const line = id => v.month.lines.find(l => l.id === id).value
assert.equal(line('rent'), 15000)
assert.equal(line('jbm'), 3000)
assert.equal(line('wages'), 1500)
assert.equal(v.month.money.result, 30000 - v.month.money.costs)
assert.equal(v.month.tender.card, 20000)
assert.equal(v.prev.money.sales, 40000)
assert.equal(v.prev.window.closed, true)
assert.deepEqual(v.cashflow.map(r => r.key), ['2026-09', '2026-10'])
assert.equal(v.cashflow.at(-1).key, '2026-10')
assert.equal(v.cashflow.find(r => r.key === '2026-09').in, 40000)
assert.equal(moneyLine({ sales: 0, net: 0 }).marginPct, null)

const row = barListRow({ id: 'x', nome: 'Atomic' }, pack, '2026-10', today)
assert.equal(row.sales, 30000)
assert.equal(row.growthPct, -25)
assert.equal(row.owesJbm, 5000)
assert.equal(row.hasTill, true)
console.log('barFinanceHq: ok')
