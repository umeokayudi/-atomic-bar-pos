import assert from 'node:assert/strict'
import {
  invoiceMoney, ledgerTotals, reconciledCash, purchasePaidByBar, invoiceDeliveries, invoiceCheck,
  invoiceLockError, averageOfActive, paymentKind, DIRECT_METHOD, invoicePeriod,
} from '../src/lib/money.js'

const ATOMIC = 'b23a5f97-ad4c-4c2a-baa6-72a0d3ba85b9'
// The 29/10/2026 review: June ¥465.000 (paid by one ¥300.000 transfer), July ¥1.757.044 with ¥488.350
// paid by the bar straight to Liquor Mountain (no payment row) and a ¥876.910 Stripe payment in review.
const jun = { id: 'jun', bar_id: ATOMIC, total: 465000, pago: 300000, periodo_inicio: '2026-06-01', periodo_fim: '2026-06-30' }
const jul = { id: 'jul', bar_id: ATOMIC, total: 1757044, pago: 488350, periodo_inicio: '2026-07-01', periodo_fim: '2026-07-31' }
const pags = [
  { id: 't', fatura_id: 'jun', valor: 300000, confirmado: true, metodo: 'Transfer' },
  { id: 's', fatura_id: 'jul', valor: 876910, confirmado: false, metodo: 'Stripe' },
]

const mJul = invoiceMoney(jul, pags)
assert.equal(mJul.direct, 488350)
assert.equal(mJul.received, 0)
assert.equal(mJul.review, 876910)
assert.equal(mJul.remaining, 1268694)

const tot = ledgerTotals([jun, jul], pags)
assert.equal(tot.received, 300000, 'received = confirmed cash only')
assert.equal(tot.review, 876910)
assert.equal(tot.direct, 488350)

// With a logged direct payment the legacy credit is not counted twice.
const pags2 = [...pags, { id: 'd', fatura_id: 'jul', valor: 488350, confirmado: true, metodo: DIRECT_METHOD, notas: 'Liquor Mountain' }]
const m2 = invoiceMoney(jul, pags2)
assert.equal(m2.direct, 488350)
assert.equal(m2.received, 0)
assert.equal(paymentKind(pags2[2]), 'direct')

// The Liquor Mountain purchase the bar paid is not JBM money out.
const lm = { fornecedor: 'Liquor Mountain', data: '2026-07-10', total_real: 488350, status_pagamento: 'pago' }
const costco = { fornecedor: 'Costco', data: '2026-07-11', total_real: 50000, status_pagamento: 'pago' }
assert.equal(purchasePaidByBar(lm), true)
assert.equal(purchasePaidByBar(costco), false)
const cash = reconciledCash({ faturas: [jun, jul], pagamentos: pags, compras: [lm, costco] })
assert.equal(cash.received, 300000)
assert.equal(cash.paidOut, 50000)
assert.equal(cash.cash, 250000)

// Invoice lock: June invoice vs ¥2.565.926 of deliveries.
const pedidos = [
  { id: 'aaaaaaaa-1', bar_id: ATOMIC, status: 'entregue', total_estimado: 2565926, data_pedido: '2026-06-15' },
  { id: 'bbbbbbbb-1', bar_id: ATOMIC, status: 'pendente', total_estimado: 999, data_pedido: '2026-06-16' },
]
const vendas = [
  { id: 'v1', bar_id: ATOMIC, total: 2565926, data: '2026-06-15', obs: 'Auto: order aaaaaaaa' }, // copy of the order
  { id: 'v2', bar_id: ATOMIC, total: 1000, data: '2026-07-02' },
]
const d = invoiceDeliveries(jun, { pedidos, vendas })
assert.equal(d.total, 2565926, 'auto sale copy of an order is not counted twice')
const c = invoiceCheck(jun, d.total)
assert.equal(c.ok, false)
assert.equal(c.diff, -2100926)
assert.equal(invoiceCheck({ ...jun, ajuste: -2100926, ajuste_motivo: 'Paid by the bar to suppliers' }, d.total).ok, true)
assert.equal(invoiceCheck({ ...jun, ajuste: -2100926 }, d.total).ok, false)
assert.deepEqual(invoiceLockError({ total: 465000, deliveries: 2565926, ajuste: -2100926, motivo: '' }), { code: 'reason' })
assert.equal(invoiceLockError({ total: 465000, deliveries: 2565926, ajuste: -2100926, motivo: 'x' }), null)

assert.equal(averageOfActive([0, 0, 0]), null)
assert.equal(averageOfActive([0, 100, 300]), 200)
assert.deepEqual(invoicePeriod({ data_emissao: '2026-07-31', data_vencimento: '2026-08-31' }), { start: '2026-07-31', end: '2026-07-31' })

console.log('money ok')
