import assert from 'node:assert/strict'
import { invoiceAdjustment, notasWithAdjustment, invoiceCheck, invoiceComposition, invoiceTotal, moneyInFacts } from '../src/lib/money.js'
import { findDuplicate, duplicateReceipts } from '../src/lib/receipts.js'
import { isArchivedOrTest } from '../src/lib/catalog.js'
import { buildCollectionEmail } from '../src/lib/collectionEmail.js'
import { stockAlerts } from '../src/lib/stockAlerts.js'

const ATOMIC = 'b23a5f97-ad4c-4c2a-baa6-72a0d3ba85b9'
const jun = { id: 'jun', bar_id: ATOMIC, total: 465000, valor: 465000, pago: 300000, periodo_inicio: '2026-06-01', periodo_fim: '2026-06-30', status: 'parcial', data_vencimento: '2026-07-31' }
const jul = { id: 'jul', bar_id: ATOMIC, total: 1757044, valor: 2145604, pago: 488350, periodo_inicio: '2026-07-01', periodo_fim: '2026-07-31', status: 'parcial', data_vencimento: '2026-08-31' }
const pags = [
  { fatura_id: 'jun', valor: 300000, confirmado: true, metodo: 'Transfer' },
  { fatura_id: 'jul', valor: 876910, confirmado: false, metodo: 'Stripe' },
]

// 1. One official total: `total` wins over a drifted `valor`.
assert.equal(invoiceTotal(jul), 1757044)

// 2. Money in: only confirmed cash.
const mi = moneyInFacts([jun, jul], pags)
assert.equal(mi.receivedConfirmedCash, 300000)
assert.equal(mi.paidByBarDirectToSupplier, 488350)
assert.equal(mi.inReviewNotReceived, 876910)

// 4. June adjustment kept in notas while the SQL columns are missing.
const notas = notasWithAdjustment(null, { ajuste: -2100926, motivo: 'Bar paid suppliers directly', by: 'Owner', at: '2026-11-03T09:00:00Z' })
const junAdj = { ...jun, notas }
assert.deepEqual(invoiceAdjustment(junAdj).ajuste, -2100926)
assert.equal(invoiceAdjustment(junAdj).motivo, 'Bar paid suppliers directly')
assert.equal(invoiceCheck(junAdj, 2565926).ok, true)
const comp = invoiceComposition(junAdj, 2565926, pags)
assert.equal(comp.other, 0)
assert.equal(comp.received, 300000)
assert.equal(notasWithAdjustment(notas, { ajuste: 0, motivo: '' }), null)

// 6. Duplicate receipts: RY-202610-002 / -003 (same bar, ¥300.000, 29/09, one-day period).
const r2 = { id: 'a', numero: 'RY-202610-002', bar_id: ATOMIC, total: 300000, data_emissao: '2026-09-29', periodo_inicio: '2026-06-30', periodo_fim: '2026-06-30', criado_em: '2026-10-12', itens: [{ nome: 'Pagamento — Transfer' }] }
const r3 = { ...r2, id: 'b', numero: 'RY-202610-003', criado_em: '2026-10-25' }
const dups = duplicateReceipts([r3, r2])
assert.equal(dups.get('b').numero, 'RY-202610-002')
assert.equal(dups.has('a'), false)
const item = { key: 'pay:x', valor: 300000, data: '2026-09-29', fatura: jun }
assert.equal(findDuplicate([r2], { barId: ATOMIC, item })?.numero, 'RY-202610-002')
assert.equal(findDuplicate([r2], { barId: ATOMIC, item: { ...item, data: '2026-10-29' } }), null)

// 8. Test / archived products.
assert.equal(isArchivedOrTest({ nome: 'TESTE-MUSE', ativo: true }), true)
assert.equal(isArchivedOrTest({ nome: 'Orange Juice', ativo: false }), true)
assert.equal(isArchivedOrTest({ nome: 'Orange Juice', ativo: true }), false)
const list = [
  { id: 1, nome: 'Jameson', hasCount: true, attention: true, stock: 0, minimo: 2, ativo: true },
  { id: 2, nome: 'TESTE-MUSE', hasCount: true, attention: true, stock: 0, minimo: 5, ativo: true },
  { id: 3, nome: 'Water', hasCount: true, attention: false, stock: 20, minimo: 5, ativo: true },
]
assert.equal(stockAlerts(list).length, 1)

// 5. Collection e-mail.
const t = (k, v = {}) => `${k}${Object.keys(v).length ? ':' + Object.values(v).join('|') : ''}`
const mail = buildCollectionEmail({ bar: { id: ATOMIC, nome: 'Atomic' }, email: 'admin@atomic.bar', invoices: [jun, jul], pagamentos: pags, today: '2026-11-03', t, yen: n => `¥${n}` })
assert.equal(mail.to, 'admin@atomic.bar')
assert.equal(mail.rows.length, 2)
assert.equal(mail.totalLeft, 165000 + 1268694)
assert.equal(mail.overdueLeft, mail.totalLeft)

console.log('fixes1103 tests passed')
