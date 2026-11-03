/** Close check: system totals per payment method for one night, and the tab fix in the night close. */
import assert from 'node:assert/strict'
import { checkState, closeCheck, methodBucket, methodDiff, saleParts } from '../src/lib/closeCheck.js'
import { summarizeNight } from '../src/lib/nightClose.js'
import { tenderOf } from '../src/lib/barClose.js'

let n = 0
function ok(name, fn) { fn(); n += 1; console.log(`ok ${n} - ${name}`) }

const night = '2026-10-25'
const at = h => new Date(Date.UTC(2026, 9, 25, h - 9, 10)).toISOString() // Tokyo hour h on the 25th
const sales = [
  { id: 'a', total: 3200, metodo_pagamento: 'Cash', criado_em: at(21), data: night, obs: '' },
  { id: 'b', total: 1200, metodo_pagamento: 'Credit card', criado_em: at(22), data: night, obs: 'Cast: Yuri|x\nPay: Credit card record-only' },
  { id: 'c', total: 56250, metodo_pagamento: 'Tab', comanda_id: 't1', criado_em: at(23), data: night, obs: 'Pay: Credit card tab\nTable 2' },
  { id: 'd', total: 15400, metodo_pagamento: 'Tab', comanda_id: 't2', criado_em: at(23), data: night, obs: 'Pay: Cash tab\nSofa w' },
  { id: 'e', total: 8000, metodo_pagamento: 'Cash + PayPay', criado_em: at(23), data: night, obs: 'Pay: Cash 5000 + PayPay 3000 record-only' },
  { id: 'f', total: 10000, metodo_pagamento: 'Tab', comanda_id: 't3', criado_em: at(23), data: night, obs: 'Pay: Cash + Credit card tab' },
  { id: 'g', total: 2000, refunded: 500, metodo_pagamento: 'PayPay', criado_em: at(23), data: night, obs: '' },
  { id: 'old', total: 9999, metodo_pagamento: 'Cash', criado_em: new Date(Date.UTC(2026, 9, 23, 13)).toISOString(), data: '2026-10-23', obs: '' },
]
const tabPays = { t3: [{ valor: 4000, metodo: 'Cash' }, { valor: 6000, metodo: 'Credit card' }] }

ok('method buckets', () => {
  assert.equal(methodBucket('Cash'), 'cash')
  assert.equal(methodBucket('Credit card'), 'card')
  assert.equal(methodBucket('PayPay'), 'paypay')
  assert.equal(methodBucket('On account · Tanaka'), 'other')
})

ok('tab paid several ways splits by its payments; without them it is "other"', () => {
  assert.deepEqual(saleParts(sales[5], tabPays), [{ method: 'cash', amount: 4000 }, { method: 'card', amount: 6000 }])
  assert.deepEqual(saleParts(sales[5], {}), [{ method: 'other', amount: 10000 }])
})

ok('system totals per method for the night, with the tickets behind them', () => {
  const c = closeCheck(sales, night, tabPays)
  assert.equal(c.methods.cash.total, 3200 + 15400 + 5000 + 4000)
  assert.equal(c.methods.card.total, 1200 + 56250 + 6000)
  assert.equal(c.methods.paypay.total, 3000 + 1500)
  assert.equal(c.methods.other.total, 0)
  assert.equal(c.total, 3200 + 1200 + 56250 + 15400 + 8000 + 10000 + 1500)
  assert.equal(c.tickets, 7)
  assert.equal(c.methods.cash.rows.length, 4)
  assert.ok(c.methods.card.rows.some(r => r.label === 'Table 2' && r.time === '23:10'))
})

ok('difference and state: empty count is "not counted", never a zero difference', () => {
  const c = closeCheck(sales, night, tabPays)
  assert.equal(methodDiff(100, ''), null)
  assert.equal(methodDiff(100, null), null)
  assert.equal(methodDiff(100, '90'), -10)
  assert.equal(checkState(c, {}), 'empty')
  assert.equal(checkState(c, { cash: c.methods.cash.total }), 'partial')
  assert.equal(checkState(c, { cash: c.methods.cash.total, card: c.methods.card.total, paypay: c.methods.paypay.total }), 'ok')
  assert.equal(checkState(c, { cash: 1 }), 'off')
})

ok('night close and period report put a cash tab in cash and a card tab in card', () => {
  const s = summarizeNight(sales.slice(2, 4), night)
  assert.equal(s.cashTotal, 15400)
  assert.equal(s.cardTotal, 56250)
  assert.equal(s.otherTotal, 0)
  const p = tenderOf(sales.slice(2, 4))
  assert.equal(p.cash, 15400)
  assert.equal(p.card, 56250)
})

console.log(`\n${n} passed`)
