import assert from 'node:assert/strict'
import { normalizeName, findDuplicates, nameTaken, supplierTaxMode, offerPrices, compareOffers, productMargin, withTaxTag } from '../src/lib/catalog.js'

// The pairs from the 29/10 review collapse to one name.
for (const [a, b] of [
  ['Orange Juice', 'Orange Juice (dup)'], ['Cramberry', 'Cranberry'], ['Grape Fruit', 'Grapefruit'],
  ['Jasmin', 'Jasmine'], ['Tomato Juice', 'Tomato Juice 9 Unit'], ['Chivas 12', 'Chivas 12 (1L)'],
]) assert.equal(normalizeName(a), normalizeName(b), `${a} = ${b}`)
assert.notEqual(normalizeName('Chivas 12'), normalizeName('Chivas 18'))
const list = [{ id: 1, nome: 'Orange Juice' }, { id: 2, nome: 'Orange Juice (dup)' }, { id: 3, nome: 'Gin', ativo: false }, { id: 4, nome: 'gin' }]
assert.equal(findDuplicates(list).length, 1)
assert.equal(nameTaken(list, 'GIN')?.id, 4)
assert.equal(nameTaken(list, 'gin', 4), null)

// Tax: never +10% on a sheet that already includes tax.
assert.equal(supplierTaxMode({ nome: 'Liquor Mountain' }), 'included')
assert.equal(supplierTaxMode({ nome: 'Costco' }), 'excluded')
assert.equal(supplierTaxMode({ nome: 'Costco', notas: withTaxTag('x', 'included') }), 'included')
assert.deepEqual(offerPrices(1100, 'included'), { net: 1000, gross: 1100 })
assert.deepEqual(offerPrices(1000, 'excluded'), { net: 1000, gross: 1100 })
const c = compareOffers([
  { preco: 1100, fornecedores: { nome: 'Liquor Mountain' } },
  { preco: 1050, fornecedores: { nome: 'Costco' } },
  { preco: 0, fornecedores: { nome: 'Le Vin' } },
])
assert.equal(c.offers[0].fornecedores.nome, 'Liquor Mountain')
assert.deepEqual(c.coverage, { withPrice: 2, linked: 3 })

assert.equal(productMargin({ custo: 0, preco_venda: 1000 }), null, 'cost ¥0 is pending, not 100%')
assert.equal(productMargin({ custo: 400, preco_venda: 1000 }), 60)
console.log('catalog ok')

const { purchaseItemsError, realCost } = await import('../src/lib/purchaseRules.js')
assert.deepEqual(purchaseItemsError([], 1000), { code: 'needItems' })
assert.deepEqual(purchaseItemsError([{ nome: 'Mercadorias Costco (Atomic) — detalhar', qtd: 1, custo_unitario: 50000 }], 50000), { code: 'lumpLine' })
assert.deepEqual(purchaseItemsError([{ nome: 'Gin', qtd: 2, custo_unitario: 1000 }], 3000), { code: 'sumMismatch', sum: 2000, subtotal: 3000 })
assert.equal(purchaseItemsError([{ nome: 'Gin', qtd: 2, custo_unitario: 1000 }, { nome: 'Tonic', qtd: 10, custo_unitario: 100 }], 3000), null)
assert.equal(realCost({ total_pago: 3000, desconto_pontos: 200 }), 2800)
console.log('purchase rules ok')
