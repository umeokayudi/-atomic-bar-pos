import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  applyBottleTakes,
  bottlePerformance,
  cardFee,
  cashLines,
  expandRecipe,
  fifoTakes,
  groupSpaces,
  openBottle,
  operationalNight,
  postBottleMove,
  previewSale,
  rememberClose,
  voidSale,
} from '../src/lib/posFloor.js'

const hennessy = { id: 'prod-h', nome: 'Hennessy XO', custo: 18000, volume_ml: 700 }
const opened = openBottle({
  stockUnits: 2,
  product: hennessy,
  code: 'HNX-00124',
  volumeMl: 700,
  employeeId: 'emp-1',
  barId: 'bar-a',
  openedAt: '2026-09-27T10:00:00Z',
})
assert.equal(opened.stockUnits, 1)
assert.equal(opened.stockMove.motivo, 'bottle_open')
assert.equal(opened.stockMove.qtd, 1)
assert.equal(opened.bottle.volume_atual, 700)
assert.throws(() => openBottle({ stockUnits: 0, product: hennessy, code: 'X', volumeMl: 700, employeeId: 'emp-1', barId: 'bar-a' }))

const recipe = expandRecipe([{ produto_id: 'prod-h', volume_ml: 30 }, { produto_id: 'coke', quantity: 1 }], 2)
assert.equal(recipe[0].volume_ml, 60)
assert.equal(recipe[1].quantity, 2)

const bottles = [
  { id: 'b1', code: 'HNX-001', produto_id: 'prod-h', bar_id: 'bar-a', status: 'opened', volume_atual: 40, volume_original: 700, opened_at: '2026-09-01T00:00:00Z', custo: 18000 },
  { id: 'b2', code: 'HNX-002', produto_id: 'prod-h', bar_id: 'bar-a', status: 'opened', volume_atual: 700, volume_original: 700, opened_at: '2026-09-02T00:00:00Z', custo: 18000 },
  { id: 'b3', code: 'OTHER', produto_id: 'prod-h', bar_id: 'bar-b', status: 'opened', volume_atual: 700, volume_original: 700, opened_at: '2026-09-01T00:00:00Z', custo: 1 },
]
const takes = fifoTakes(bottles, 60, { barId: 'bar-a', produtoId: 'prod-h' })
assert.deepEqual(takes.map(row => row.bottle_id), ['b1', 'b2'])
assert.equal(takes[0].volume_ml, 40)
assert.equal(takes[1].volume_ml, 20)
const after = applyBottleTakes(bottles, takes)
assert.equal(after.find(row => row.id === 'b1').status, 'depleted')
assert.equal(after.find(row => row.id === 'b2').volume_atual, 680)
assert.throws(() => fifoTakes(bottles, 5000, { barId: 'bar-a', produtoId: 'prod-h' }))

const wasted = postBottleMove(after.find(row => row.id === 'b2'), { kind: 'waste', volumeMl: 50, employeeId: 'emp-1', reason: 'spill check' })
assert.equal(wasted.bottle.volume_atual, 630)
assert.equal(wasted.move.kind, 'waste')
assert.throws(() => postBottleMove(wasted.bottle, { kind: 'breakage', volumeMl: 9999, employeeId: 'emp-1' }))

const catalog = [
  { id: 'drink-1', nome: 'Hennessy Coca', preco_venda: 3000, bar_id: 'bar-a' },
  { id: 'prod-h', nome: 'Hennessy XO', preco_venda: 2500, bar_id: 'bar-a', produto_id: 'prod-h' },
]
const sale = previewSale({
  items: [
    { drink_menu_id: 'drink-1', qtd: 2, forCast: true },
    { produto_id: 'prod-h', qtd: 1 },
  ],
  catalog,
  recipes: { 'drink-1': [{ produto_id: 'prod-h', volume_ml: 30 }] },
  bottles,
  agent: { id: 'cast-1', comissao_pct: 50 },
  payment: 'card',
  barId: 'bar-a',
  employeeId: 'emp-1',
})
assert.equal(sale.lines[0].unit_price, 3000)
assert.equal(sale.subtotal, 8500)
assert.equal(sale.commission, 2000)
assert.equal(sale.consumption.reduce((sum, row) => sum + row.volume_ml, 0), 60)
assert.equal(sale.fee, cardFee(sale.subtotal, 'card'))
assert.equal(sale.caixa.filter(row => row.referencia_tipo === 'taxa_cartao').length, 1)
assert.equal(sale.caixa.filter(row => row.referencia_tipo === 'pos_venda').length, 1)
assert.equal(cashLines({ total: 10000, method: 'card' }).net, 10000 - 378)
assert.equal(cardFee(10000, 'cash'), 0)

const perf = bottlePerformance(
  { id: 'b1', custo: 18000, volume_atual: 220 },
  [{ bottle_id: 'b1', volume_ml: 480, kind: 'consume' }],
  { b1: 34500 },
)
assert.equal(perf.margin, 16500)
assert.equal(perf.consumed, 480)
assert.equal(bottlePerformance({ id: 'b9', custo: null, volume_atual: 10 }, [], {}).costLabel, 'custo não disponível')

const store = new Map()
const first = rememberClose(store, 'key-1', 'venda-1')
const second = rememberClose(store, 'key-1', 'venda-2')
assert.equal(first.created, true)
assert.equal(second.created, false)
assert.equal(second.vendaId, 'venda-1')

const voided = voidSale({ id: 'venda-1', total: 6500, refunded: 0 }, {
  kind: 'partial_refund', amount: 2000, reason: 'wrong drink', employeeId: 'emp-1', approverId: 'mgr-1',
})
assert.equal(voided.sale.refunded, 2000)
assert.equal(voided.event.kind, 'partial_refund')
assert.throws(() => voidSale({ id: 'venda-1', total: 1000, refunded: 0, void_status: 'void' }, {
  kind: 'refund', reason: 'x', employeeId: 'emp-1', approverId: 'mgr-1',
}))

assert.equal(operationalNight('2026-09-27T20:30:00Z'), '2026-09-27')
assert.equal(operationalNight('2026-09-27T12:00:00Z'), '2026-09-27')

const groups = groupSpaces([
  { id: '1', tipo: 'table', nome: '12', ativo: true },
  { id: '2', tipo: 'vip_room', zona: 'vip', nome: 'VIP', ativo: true },
  { id: '3', tipo: 'counter', nome: 'Bar', ativo: true },
])
assert.equal(groups.table.length, 1)
assert.equal(groups.vip.length, 1)
assert.equal(groups.counter.length, 1)

const sql = readFileSync('sql/pos_floor.sql', 'utf8')
assert.match(sql, /SECURITY DEFINER/)
assert.match(sql, /SET search_path = public/)
assert.match(sql, /auth\.uid\(\)/)
assert.match(sql, /idempotency key required/)
assert.match(sql, /insufficient bottle volume/)
assert.match(sql, /bottle not in stock/)
assert.match(sql, /0\.0378/)
assert.match(sql, /Asia\/Tokyo/)
assert.match(sql, /round\(2000 \* pct \/ 100\)/)
assert.doesNotMatch(sql, /procurement_tasks/)
assert.doesNotMatch(sql, /INSERT INTO public\.vendas/)
assert.match(sql, /pos_vendas/)
assert.match(sql, /caixa_movimentos/)
assert.match(sql, /estoque_movimentos/)

const floor = readFileSync('src/components/PosFloor.jsx', 'utf8')
assert.match(floor, /pos_close_ticket/)
assert.doesNotMatch(floor, /preco_unitario:/)
assert.match(floor, /error\.message/)

console.log('pos floor tests passed')
