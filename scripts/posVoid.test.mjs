// Void a till sale, cash count at close, and what till/staff logins may write. Run: npm run test:pos-void
import assert from 'node:assert/strict'
import { buildVoid, canVoid, isVoided } from '../src/lib/posVoid.js'
import { summarizeNight, closeVariance } from '../src/lib/nightClose.js'
import { frontDeleteError, frontSaleWriteError } from '../api/_posSaleStamp.js'
import { hashSecret, secretsMatch, isBurnedSecret } from '../api/_hash.js'
import { createHash } from 'node:crypto'

let n = 0
const ok = (name, fn) => { fn(); n++; console.log(`✓ ${name}`) }
const night = '2026-10-17'

ok('a card sale and its void leave nothing: total, tickets, card and fee', () => {
  const sale = { id: 's1', bar_id: 'b', data: night, total: 5000, metodo_pagamento: 'card', obs: 'Cast: Aiko|a1\nCardFee: 165' }
  const { voidRow, originalPatch } = buildVoid(sale, { reason: 'wrong drink', byName: 'Ken', byId: 'u1' })
  assert.equal(voidRow.total, -5000)
  assert.equal(voidRow.card_fee, 165)
  assert.match(voidRow.obs, /^Void of s1: wrong drink \(Ken\)/)
  assert.match(voidRow.obs, /Cast: Aiko\|a1/)
  assert.doesNotMatch(voidRow.obs, /CardFee/)
  assert.equal(voidRow.idempotency_key, 'void:s1')
  const sum = summarizeNight([sale, voidRow], night)
  assert.deepEqual([sum.ticketCount, sum.netSales, sum.cardTotal, sum.cardFees], [0, 0, 0, 0])
  assert.ok(isVoided({ obs: originalPatch.obs }))
})

ok('voiding a cash sale lowers the cash the drawer should hold', () => {
  const a = { id: 'c1', total: 3000, metodo_pagamento: 'Cash', data: night }
  const b = { id: 'c2', total: 1200, metodo_pagamento: 'Cash', data: night }
  const { voidRow } = buildVoid(a, { reason: 'x' })
  assert.equal(summarizeNight([a, b, voidRow], night).expectedCash, 1200)
})

ok('a void needs a reason and cannot be repeated or voided again', () => {
  const sale = { id: 's', total: 900, data: night }
  assert.throws(() => buildVoid(sale, { reason: ' ' }))
  const { voidRow, originalPatch } = buildVoid(sale, { reason: 'r' })
  assert.equal(canVoid({ ...sale, obs: originalPatch.obs }), false)
  assert.equal(canVoid({ ...voidRow, id: 'v' }), false)
})

ok('cash count difference', () => {
  assert.equal(closeVariance(10000, 9500), -500)
})

ok('till/staff logins: no void rows, no money edits, delete only their fresh sale', () => {
  const caixa = { user: { id: 'u1' }, perfil: { role: 'caixa' } }
  const owner = { user: { id: 'o' }, perfil: { role: 'cliente' } }
  assert.ok(frontSaleWriteError('pos_vendas', { mode: 'insert', insertRows: [{ total: -100 }] }, caixa))
  assert.equal(frontSaleWriteError('pos_vendas', { mode: 'insert', insertRows: [{ total: -100 }] }, owner), null)
  assert.equal(frontSaleWriteError('pos_vendas', { mode: 'insert', insertRows: [{ total: 900 }] }, caixa), null)
  assert.ok(frontSaleWriteError('pos_vendas', { mode: 'update', updatePatch: { total: 1 } }, caixa))
  assert.equal(frontSaleWriteError('pos_vendas', { mode: 'update', updatePatch: { guest_id: 'g' } }, caixa), null)
  assert.ok(frontSaleWriteError('pos_vendas', { mode: 'upsert', insertRows: [{}] }, caixa))
  const now = Date.parse('2026-10-17T13:00:00Z')
  assert.equal(frontDeleteError([{ criado_por: 'u1', criado_em: '2026-10-17T12:58:00Z' }], caixa, now), null)
  assert.ok(frontDeleteError([{ criado_por: 'u1', criado_em: '2026-10-17T11:00:00Z' }], caixa, now))
  assert.ok(frontDeleteError([{ criado_por: 'u2', criado_em: '2026-10-17T12:59:00Z' }], caixa, now))
  assert.equal(frontDeleteError([{ criado_por: 'x', criado_em: '2020-01-01' }], owner, now), null)
})

ok('secrets: salted scrypt, old SHA-256 still checks, published demo passwords refused', () => {
  const h = hashSecret('1234')
  assert.match(h, /^scrypt\$/)
  assert.notEqual(h, hashSecret('1234'))
  assert.ok(secretsMatch('1234', h))
  assert.ok(!secretsMatch('1235', h))
  assert.ok(secretsMatch('1234', createHash('sha256').update('1234').digest('hex')))
  assert.ok(isBurnedSecret('PosOnly#2026'))
})

console.log(`\n${n} passed`)
