import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  canConfigurePos,
  configToRow,
  favoriteProducts,
  normalizeWeights,
  paymentProblem,
  productProblem,
  quoteSale,
  recommendProducts,
  searchProducts,
} from '../src/lib/posEngine.js'

const heineken = { id: 'h1', kind: 'drink', nome: 'Heineken 330ml', nome_en: 'Heineken', sku: 'BEER-001', preco_venda: 700, categoria: 'Beer', ativo: true }
const heinekenLarge = { id: 'h2', kind: 'drink', nome: 'Heineken 500ml', sku: 'BEER-002', preco_venda: 900, categoria: 'Beer', ativo: true }
const highball = { id: 'hb', kind: 'drink', nome: 'Highball', nome_ja: 'ハイボール', preco_venda: 900, categoria: 'Highball', ativo: true, custo: 200 }
const dead = { id: 'x', kind: 'drink', nome: 'Closed', sku: 'OLD', preco_venda: 500, ativo: false }
const noPrice = { id: 'y', kind: 'drink', nome: 'No price', sku: 'NOP', preco_venda: 0, ativo: true }
const catalog = [heineken, heinekenLarge, highball, dead, noPrice]

const byName = searchProducts(catalog, 'HEE')
assert.deepEqual(byName.map(row => row.sku), ['BEER-001', 'BEER-002'])
assert.equal(searchProducts(catalog, 'BEER-001')[0].id, 'h1')
assert.equal(searchProducts(catalog, 'ハイボール')[0].id, 'hb')
assert.equal(searchProducts(catalog, 'highball')[0].id, 'hb')
assert.equal(searchProducts(catalog, '').length, 0)

assert.equal(productProblem(dead), 'inactive')
assert.equal(productProblem(noPrice), 'no-price')
assert.equal(productProblem(heineken), '')

const fav = favoriteProducts(catalog, ['drink:h1', 'drink:missing'])
assert.deepEqual(fav.map(row => row.id), ['h1'])
assert.deepEqual(favoriteProducts(catalog, ['drink:other-bar']), [])

const weights = normalizeWeights({ bestsellers: 40, profit: 20, customer: 20, new: 10, premium: 10, quality: -5 })
assert.equal(Math.round(weights.bestsellers * 100), 40)
assert.equal(Math.round((weights.bestsellers + weights.profit + weights.customer + weights.new + weights.premium) * 100), 100)
assert.equal(weights.quality, 0)

const card = quoteSale({
  subtotal: 10000,
  method: 'credit',
  config: {
    service_enabled: true,
    service_type: 'percentage',
    service_value: 10,
    service_dine_in: true,
    tax_enabled: false,
    card_surcharge_enabled: true,
    card_credit_pct: 3,
  },
})
assert.equal(card.service, 1000)
assert.equal(card.tax, 0)
assert.equal(card.surcharge, 330)
assert.equal(card.total, 11330)
assert.equal(card.total, card.subtotal + card.service + card.tax + card.surcharge)

const both = quoteSale({
  subtotal: 10000,
  method: 'credit',
  config: {
    service_enabled: true,
    service_value: 10,
    service_dine_in: true,
    tax_enabled: true,
    tax_rate: 10,
    card_surcharge_enabled: true,
    card_credit_pct: 3,
  },
})
assert.equal(both.service, 1000)
assert.equal(both.tax, 1000)
assert.equal(both.surcharge, 360)
assert.equal(both.total, 12360)

const cash = quoteSale({ subtotal: 10000, method: 'cash', config: { service_enabled: true, service_value: 10, card_surcharge_enabled: true, card_credit_pct: 3 } })
assert.equal(cash.surcharge, 0)
assert.equal(cash.service, 1000)

const takeaway = quoteSale({
  subtotal: 1000,
  method: 'cash',
  servicePoint: 'takeaway',
  config: { service_enabled: true, service_value: 10, service_dine_in: true, service_takeaway: false },
})
assert.equal(takeaway.service, 0)

const off = quoteSale({ subtotal: 2300, method: 'card' })
assert.equal(off.total, 2300)

assert.equal(paymentProblem({ method: 'cash', lineCount: 1, quote: off, charging: true }), 'busy')
assert.equal(paymentProblem({ method: '', lineCount: 1, quote: off }), 'no-method')
assert.equal(paymentProblem({ method: 'cash', lineCount: 0, quote: off }), 'empty')
assert.equal(paymentProblem({ method: 'cash', lineCount: 1, quote: { ...off, total: 1 } }), 'bad-total')

const rec = recommendProducts({
  catalog,
  cartKeys: [],
  config: { ai_enabled: true, ai_weights: { promote: 50, profit: 50 }, featured: ['drink:h1'] },
})
assert.ok(rec.some(row => row.product.id === 'h1' && row.reason === 'Featured by your manager.'))
assert.ok(rec.every(row => row.product.ativo !== false && row.product.preco_venda > 0))
assert.equal(recommendProducts({ catalog, config: { ai_enabled: false, featured: ['drink:h1'] } }).length, 0)
assert.equal(recommendProducts({ catalog: [dead], config: { ai_enabled: true, ai_weights: { promote: 1 }, featured: ['drink:x'] } }).length, 0)

assert.equal(canConfigurePos('caixa'), false)
assert.equal(canConfigurePos('bar_staff'), false)
assert.equal(canConfigurePos('gerente'), true)
assert.equal(canConfigurePos('cliente'), true)
assert.equal(configToRow('bar-a', { service_enabled: true }).bar_id, 'bar-a')
assert.notEqual(configToRow('bar-a', {}).bar_id, configToRow('bar-b', {}).bar_id)

const mobile = readFileSync(new URL('../src/components/pos/PosMobile.jsx', import.meta.url), 'utf8')
const tablet = readFileSync(new URL('../src/components/pos/PosTablet.jsx', import.meta.url), 'utf8')
const floor = readFileSync(new URL('../src/components/PosFloor.jsx', import.meta.url), 'utf8')
const sql = readFileSync(new URL('../sql/pos_ux.sql', import.meta.url), 'utf8')
for (const source of [mobile, tablet]) {
  assert.match(source, /PosSearch/)
  assert.match(source, /askCharge/)
  assert.match(source, /floor\.favorites/)
  assert.match(source, /ConfirmPay/)
}
assert.match(floor, /posEngine/)
assert.match(floor, /function scanCode/)
assert.match(floor, /err_closed/)
assert.match(floor, /pos_close_ticket/)
assert.match(floor, /pos_close_with_charges/)
assert.match(floor, /chargeLock/)
assert.doesNotMatch(sql, /DROP TABLE/i)
assert.match(sql, /pos_bar_config/)
assert.match(sql, /ENABLE ROW LEVEL SECURITY/)
assert.match(sql, /p\.bar_id = pos_bar_config\.bar_id/)
assert.match(sql, /p\.role IN \('cliente', 'gerente'\)/)
assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS public\.produtos/)
assert.doesNotMatch(sql, /CREATE TABLE IF NOT EXISTS public\.pos_vendas/)
assert.match(sql, /pos_close_ticket/)

console.log('pos engine tests passed')
