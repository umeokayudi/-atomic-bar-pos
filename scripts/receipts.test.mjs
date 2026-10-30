import assert from 'node:assert/strict'
import { findDuplicate, nextNumber, companyEmitente, companyMissing } from '../src/lib/receipts.js'
import { receiptableItems } from '../src/lib/portalRecibos.js'

const bar = 'b1'
const fatura = { id: 'f1', bar_id: bar, total: 465000, pago: 300000, periodo_inicio: '2026-06-01', periodo_fim: '2026-06-30' }
const item = { key: 'p-t1', valor: 300000, fatura }

// Two receipts (RY-202610-002 and -003) for one ¥300.000 transfer: the second is found as a duplicate.
const old = [{ bar_id: bar, numero: 'RY-202610-002', total: 300000, periodo_inicio: '2026-06-01', periodo_fim: '2026-06-30', itens: [] }]
assert.equal(findDuplicate(old, { barId: bar, item })?.numero, 'RY-202610-002')
assert.equal(findDuplicate(old, { barId: 'other', item }), null)
const withRef = [{ bar_id: bar, numero: 'RY-202610-004', total: 300000, pagamento_ref: 'p-other' }]
assert.equal(findDuplicate(withRef, { barId: bar, item }), null, 'a ref decides when present')

// Numbers: highest of the month across bars + 1, never the count of a short list.
assert.equal(nextNumber(['RY-202610-001', 'RY-202610-003', 'RY-202609-010'], '2026-10-30'), 'RY-202610-004')
assert.equal(nextNumber([], '2026-11-01'), 'RY-202611-001')

assert.equal(companyEmitente({ registro: 'T1234567890123' }).registro, '', 'placeholder number never printed')
assert.deepEqual(companyMissing({ nome: 'JBM' }), ['endereco', 'tel', 'registro'])

// No JBM receipt for what the bar paid straight to a supplier; the confirmed transfer is receiptable.
const jul = { id: 'jul', bar_id: 'b23a5f97-ad4c-4c2a-baa6-72a0d3ba85b9', total: 1757044, pago: 488350, periodo_inicio: '2026-07-01', periodo_fim: '2026-07-31' }
const items = receiptableItems([fatura, jul], [{ id: 't1', fatura_id: 'f1', valor: 300000, confirmado: true, metodo: 'Transfer' }])
assert.deepEqual(items.map(i => [i.key, i.valor]), [['p-t1', 300000]])

console.log('receipts ok')
