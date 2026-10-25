/** Drink recipe lines, cost and suggested prices. node scripts/recipe.test.mjs */
import assert from 'node:assert/strict'
import { lineCost, marginPct, matchProduct, parseRecipe, recipeCost, serializeRecipe, suggestPrices } from '../src/lib/recipe.js'

let n = 0
const test = (name, fn) => { fn(); n++; console.log(`ok ${n} - ${name}`) }

const produtos = [
  { id: 'a', nome: 'Jose Cuervo Especial 750ml', preco_venda: 1500, volume_ml: 750 },
  { id: 'b', nome: 'Cranberry Juice 1L', preco_venda: 900, volume_ml: 1000 },
  { id: 'c', nome: 'Asahi Beer 330ml', preco_venda: 284, volume_ml: 330 },
  { id: 'd', nome: 'Orange Juice', preco_venda: 500, volume_ml: null },
]

test('legacy short names find the catalogue bottle', () => {
  assert.equal(matchProduct('cuervo', produtos)?.id, 'a')
  assert.equal(matchProduct('cranberry', produtos)?.id, 'b')
  assert.equal(matchProduct('oj', produtos), null)
})

test('parse a legacy recipe and price it', () => {
  const lines = parseRecipe('cuervo 30ml + cranberry 180ml', produtos)
  assert.equal(lines.length, 2)
  assert.equal(lines[0].kind, 'jbm')
  assert.equal(lineCost(lines[0]), 60)
  assert.equal(lineCost(lines[1]), 162)
  assert.deepEqual(recipeCost(lines), { total: 222, complete: true })
})

test('own bottle and fixed cost round-trip through the text', () => {
  const lines = [
    { kind: 'jbm', produto_id: 'a', nome: 'Jose Cuervo Especial 750ml', ml: 45, bottlePrice: 1500, bottleMl: 750 },
    { kind: 'own', nome: 'Lemon juice', ml: 20, bottlePrice: 800, bottleMl: 1000 },
    { kind: 'fixed', nome: 'Lime + salt', fixed: 20 },
  ]
  const text = serializeRecipe(lines)
  assert.equal(text, 'Jose Cuervo Especial 750ml 45ml + Lemon juice 20ml (¥800/1000ml) + Lime & salt (¥20)')
  const back = parseRecipe(text, produtos)
  assert.equal(back[0].produto_id, 'a')
  assert.equal(back[1].kind, 'own')
  assert.equal(lineCost(back[1]), 16)
  assert.equal(back[2].kind, 'fixed')
  assert.deepEqual(recipeCost(back), { total: 90 + 16 + 20, complete: true })
})

test('missing bottle size or price leaves the cost incomplete', () => {
  const lines = parseRecipe('Orange Juice 150ml + mystery 10ml + garnish', produtos)
  assert.equal(lines[0].kind, 'jbm')
  assert.equal(lineCost(lines[0]), null)
  assert.equal(lines[1].kind, 'own')
  assert.equal(lines[2].kind, 'fixed')
  assert.equal(recipeCost(lines).complete, false)
  assert.equal(recipeCost([]).complete, false)
})

test('suggested prices reach the target margin', () => {
  const s = suggestPrices(222)
  assert.deepEqual(s.map(x => x.price), [750, 900, 1200])
  s.forEach(x => assert.ok(x.margin >= x.target))
  assert.equal(marginPct(1000, 284), 72)
  assert.equal(marginPct(0, 10), null)
  assert.deepEqual(suggestPrices(0), [])
})
