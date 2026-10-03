import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { computeDayMetrics } from '../src/lib/atomicPos.js'
import { periodReport, tenderOf } from '../src/lib/barClose.js'
import { buildMonthSeries } from '../src/lib/hqFilters.js'
import { pedidoTotal } from '../src/lib/pedidoVenda.js'
import {
  countTillValid,
  jbmNet,
  sumJbmGross,
  sumJbmNet,
  sumTillGross,
  sumTillNet,
  tillGross,
  tillNet,
} from '../src/lib/saleBooks.js'

const normal = { total: 1000, refunded: 0, void_status: null, metodo_pagamento: 'cash', data: '2026-10-01' }
const voided = { total: 2400, refunded: 2400, void_status: 'void', metodo_pagamento: 'cash', data: '2026-10-01' }
const partial = { total: 1000, refunded: 400, void_status: 'partial_refund', metodo_pagamento: 'card', data: '2026-10-01' }
const jbmOk = { total: 1000, status: 'confirmada', data: '2026-10-01' }
const jbmCancel = { total: 400, status: 'cancelada', data: '2026-10-02' }

assert.equal(tillNet(normal), 1000)
assert.equal(tillGross(normal), 1000)
assert.equal(tillNet(voided), 0)
assert.equal(tillGross(voided), 2400)
assert.equal(tillNet(partial), 600)
assert.equal(tillGross(partial), 1000)
assert.equal(sumTillNet([normal, voided, partial]), 1600)
assert.equal(sumTillGross([normal, voided, partial]), 4400)
assert.equal(countTillValid([normal, voided, partial]), 2)

assert.equal(jbmNet(jbmOk), 1000)
assert.equal(jbmNet(jbmCancel), 0)
assert.equal(sumJbmNet([jbmOk, jbmCancel]), 1000)
assert.equal(sumJbmGross([jbmOk, jbmCancel]), 1400)
assert.equal(sumTillNet([normal, voided, partial]) + sumJbmNet([jbmOk, jbmCancel]), 2600)

const series = buildMonthSeries({
  keys: ['2026-10'],
  vendas: [jbmOk, jbmCancel],
  posRows: [normal, voided, partial],
  pedidos: [],
  rentRows: [],
})
assert.equal(series[0].pos, 1600)
assert.equal(series[0].posGross, 4400)
assert.equal(series[0].jbm, 1000)
assert.equal(series[0].jbmGross, 1400)
assert.notEqual(series[0].pos, series[0].pos + series[0].jbm)

const report = periodReport({
  tickets: [normal, voided, partial],
  start: '2026-10-01',
  end: '2026-10-01',
  registry: [],
  hq: null,
  monthKey: '2026-10',
})
assert.equal(report.sales, 1600)
assert.equal(report.gross, 4400)
assert.equal(report.count, 2)

const tender = tenderOf([
  { total: 1000, refunded: 0, metodo_pagamento: 'cash' },
  { total: 2000, refunded: 2000, void_status: 'void', metodo_pagamento: 'cash' },
  { total: 1000, refunded: 400, void_status: 'partial_refund', metodo_pagamento: 'card' },
])
assert.equal(tender.cash, 1000)
assert.equal(tender.card, 600)

const day = computeDayMetrics([normal, voided, partial])
assert.equal(day.total, 1600)
assert.equal(day.count, 2)

assert.equal(pedidoTotal({ total_estimado: 500, pedidos_itens: [{ preco_unitario: 10, qtd: 1 }] }), 500)
assert.equal(pedidoTotal({ pedidos_itens: [{ preco_unitario: 100, qtd: 2 }] }), 200)
assert.equal(pedidoTotal({ pedidos_itens: [{ preco_unitario: 0, qtd: 2 }] }), null)
assert.equal(pedidoTotal({ pedidos_itens: [{ preco_unitario: null, qtd: 1 }], produtos: { preco_venda: 900 } }), null)

const analyticsSrc = readFileSync(new URL('../src/lib/clientAnalytics.js', import.meta.url), 'utf8')
assert.equal(analyticsSrc.includes('2.8'), false)
assert.equal(/preco_venda/.test(analyticsSrc.slice(analyticsSrc.indexOf('function projectItemRevenue'), analyticsSrc.indexOf('function analyzePurchases'))), false)
const isolated = (
  analyticsSrc.slice(
    analyticsSrc.indexOf('export function projectItemRevenue'),
    analyticsSrc.indexOf('export function monthlyAccountSummary'),
  ) + analyticsSrc.slice(
    analyticsSrc.indexOf('export function categoryAnalysis'),
    analyticsSrc.indexOf('export function weeklySpendSeries'),
  )
).replaceAll('export function', 'function')
const { projectItemRevenue, analyzePurchases, categoryAnalysis } = new Function(`${isolated}; return { projectItemRevenue, analyzePurchases, categoryAnalysis }`)()
const missingPrice = projectItemRevenue(
  { produto_id: 'p1', qtd: 2, preco_unitario: 900, produtos: { preco_venda: 900 } },
  {},
)
assert.equal(missingPrice.posTotal, null)
assert.equal(missingPrice.source, 'unavailable')
assert.equal(missingPrice.confirmed, false)
assert.equal(JSON.stringify(missingPrice).includes('2520'), false)
const confirmedPrice = projectItemRevenue(
  { produto_id: 'p1', qtd: 2, preco_unitario: 900 },
  { p1: { preco_drink: 500, drinks_por_garrafa: 8 } },
)
assert.equal(confirmedPrice.source, 'pos')
assert.equal(confirmedPrice.confirmed, true)
assert.equal(confirmedPrice.posTotal, 8000)
assert.equal(confirmedPrice.jbmTotal, 1800)
const month = analyzePurchases([
  { qtd: 1, preco_unitario: null, produto_id: 'p1', produtos: { nome: 'A', preco_venda: 900, categoria: 'Whisky' }, vendas: { data: '2026-10-01' } },
], {}, { monthKey: '2026-10' })
assert.equal(month.posTotal, null)
assert.equal(month.jbmTotal, null)
assert.equal(month.margin, null)
assert.equal(month.priceState, 'unavailable')
const categories = categoryAnalysis([
  { qtd: 1, preco_unitario: null, produto_id: 'p1', produtos: { nome: 'A', categoria: 'Whisky' }, vendas: { data: '2026-10-01' } },
], {}, { monthKey: '2026-10' })
assert.equal(Number.isNaN(categories[0].sharePct), false)
assert.equal(categories[0].posTotal, null)

console.log('sale books ok')
