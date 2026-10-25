import assert from 'node:assert/strict'
import { buildCostOverview } from '../src/lib/costOverview.js'
import { costCategoryOf, kindForCategory, yenDigits, groupYen } from '../src/lib/costCategories.js'

const registry = [
  { id: 'a', kind: 'aluguel', nome: 'Realty', amount: 180000 },
  { id: 'b', kind: 'fixo', nome: 'NTT', detalhe: 'internet', amount: 6000 },
  { id: 'c', kind: 'variavel', nome: 'Repair', detalhe: 'repair', amount: 18000, month_key: '2026-10' },
  { id: 'd', kind: 'variavel', nome: 'Old repair', amount: 9000, month_key: '2026-09' },
  { id: 'e', kind: 'fornecedor', nome: 'Sake', amount: 1 },
]
const books = { pos: { amount: 300000 }, jbm: { amount: 50000 }, staff: { amount: 40000 }, rent: { amount: 0 } }
const v = buildCostOverview({ registry, books, monthKey: '2026-10' })
assert.equal(v.till, 300000)
assert.equal(v.costs, 180000 + 6000 + 18000 + 50000 + 40000)
assert.equal(v.result, 300000 - v.costs)
assert.equal(v.lines[0].id, 'rent')
assert.ok(!v.lines.find(l => l.name === 'Old repair'), 'other month variable cost left out')
assert.ok(!v.lines.find(l => l.name === 'Sake'), 'suppliers are not costs here')

const empty = buildCostOverview({ registry: [], books: { pos: { amount: 0 } }, monthKey: '2026-10' })
assert.deepEqual(empty.lines.map(l => l.id).sort(), ['jbm', 'rent', 'wages'])
assert.equal(empty.missingRent, true)
assert.equal(empty.costShare, null)

assert.equal(costCategoryOf({ kind: 'aluguel' }), 'rent')
assert.equal(costCategoryOf({ kind: 'energia' }), 'power')
assert.equal(costCategoryOf({ kind: 'fixo', detalhe: 'Karaoke' }), 'Karaoke')
assert.equal(kindForCategory('fixo', 'rent'), 'aluguel')
assert.equal(kindForCategory('variavel', 'power'), 'energia')
assert.equal(kindForCategory('fixo', 'internet'), 'fixo')
assert.equal(yenDigits('¥12,000'), '12000')
assert.equal(groupYen('0012000'), '12,000')
console.log('costOverview ok')
