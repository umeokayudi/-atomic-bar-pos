import assert from 'node:assert/strict'
import { faturaSummary, statusForPaid, daysLate, addFaturaPayment, confirmFaturaPayment, removeFaturaPayment } from '../src/lib/faturaLedger.js'

// Pure summary
const f = { id: 'f1', total: 1757044, pago: 488350, data_vencimento: '2026-08-31' }
const pags = [
  { id: 'p1', fatura_id: 'f1', valor: 876910, confirmado: false, data: '2026-08-24' },
  { id: 'x', fatura_id: 'other', valor: 5, confirmado: true },
]
const s = faturaSummary(f, pags, '2026-10-10')
assert.equal(s.remaining, 1268694)
assert.equal(s.unrecorded, 488350)
assert.equal(s.underReview, 876910)
assert.equal(s.payments.length, 1)
assert.equal(s.status, 'parcial')
assert.equal(s.late, 40)
assert.equal(statusForPaid(100, 0), 'pendente')
assert.equal(statusForPaid(100, 100), 'pago')
assert.equal(daysLate('2026-10-11', '2026-10-10'), 0)

// Fake supabase that keeps rows in memory
function fakeDb(fatura) {
  const tables = { faturas: [fatura], fatura_pagamentos: [] }
  let n = 0
  return {
    tables,
    from(name) {
      const q = { filters: [], patch: null, del: false }
      const match = r => q.filters.every(([k, v]) => (v === null ? r[k] == null : r[k] === v))
      const api = {
        select() { return api },
        eq(k, v) { q.filters.push([k, v]); return api },
        is(k, v) { q.filters.push([k, v]); return api },
        single() { return Promise.resolve({ data: tables[name].find(match), error: null }) },
        insert(row) { tables[name].push({ id: 'p' + (++n), confirmado: false, ...row }); return Promise.resolve({ error: null }) },
        update(patch) { q.patch = patch; return api },
        delete() { q.del = true; return api },
        then(res) {
          const hit = tables[name].filter(match)
          if (q.patch) hit.forEach(r => Object.assign(r, q.patch))
          if (q.del) tables[name] = tables[name].filter(r => !hit.includes(r))
          return Promise.resolve({ data: hit.map(r => ({ id: r.id })), error: null }).then(res)
        },
      }
      return api
    },
  }
}

const db = fakeDb({ id: 'f1', total: 1000, pago: 0, status: 'pendente' })
await addFaturaPayment(db, 'f1', { valor: 300, data: '2026-10-01', metodo: 'Cash' })
assert.equal(db.tables.faturas[0].pago, 300)
assert.equal(db.tables.faturas[0].status, 'parcial')
await addFaturaPayment(db, 'f1', { valor: 700, data: '2026-10-05', metodo: 'Stripe', confirmado: false })
assert.equal(db.tables.faturas[0].pago, 300, 'waiting payment does not count')
const waiting = db.tables.fatura_pagamentos.find(p => !p.confirmado)
const stale = { ...waiting }
await confirmFaturaPayment(db, waiting)
// Double tap / second person with the old screen: the same payment is not added twice.
const again = await confirmFaturaPayment(db, stale)
assert.equal(again.already, true)
assert.equal(db.tables.faturas[0].pago, 1000)
assert.equal(db.tables.faturas[0].status, 'pago')
assert.equal(db.tables.faturas[0].data_pagamento, '2026-10-05')
const first = db.tables.fatura_pagamentos.find(p => p.valor === 300)
await removeFaturaPayment(db, first)
assert.equal(db.tables.faturas[0].pago, 700)
assert.equal(db.tables.faturas[0].status, 'parcial')
assert.equal(db.tables.fatura_pagamentos.length, 1)
await assert.rejects(addFaturaPayment(db, 'f1', { valor: 0 }))

console.log('faturaLedger: ok')
