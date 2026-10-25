import assert from 'node:assert/strict'
import { categoryCounts, daysUntil, nextState, partnerEmoji, partnersFrom, supplierChoices, telHref } from '../src/lib/partners.js'

const rows = [
  { id: 'a', kind: 'fornecedor', nome: 'Sake Wholesale', cargo: 'bebidas' },
  { id: 'b', kind: 'fornecedor', nome: 'Clean Tokyo', cargo: 'limpeza', proximo_servico: '2026-10-26' },
  { id: 'c', kind: 'fornecedor', nome: 'Florist', cargo: 'Flowers' },
  { id: 'd', kind: 'aluguel', nome: 'Realty' },
  { id: 'e', kind: 'fornecedor', nome: '  ' },
]

assert.deepEqual(partnersFrom(rows).map(r => r.id), ['b', 'c', 'a'])
assert.deepEqual(supplierChoices(rows).map(r => r.nome), ['Sake Wholesale', 'Clean Tokyo', 'Florist'])
assert.equal(supplierChoices(rows)[0].emoji, '🍾')
assert.equal(partnerEmoji('Flowers'), '🤝')
assert.equal(partnerEmoji(''), '🤝')
assert.equal(partnerEmoji('limpeza'), '🧹')
assert.deepEqual(categoryCounts(partnersFrom(rows)).map(c => c.key), ['bebidas', 'limpeza', 'Flowers'])
assert.equal(daysUntil('2026-10-26', '2026-10-25'), 1)
assert.equal(daysUntil('', '2026-10-25'), null)
assert.equal(nextState('2026-10-20', '2026-10-25'), 'late')
assert.equal(nextState('2026-11-01', '2026-10-25'), 'soon')
assert.equal(nextState('2026-12-01', '2026-10-25'), 'later')
assert.equal(telHref('090-1111-2222'), 'tel:09011112222')
assert.equal(telHref('LINE ikeda_k'), '')
console.log('partners: ok')
