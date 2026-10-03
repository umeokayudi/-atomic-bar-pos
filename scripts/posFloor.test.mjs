import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  addTicketItem,
  applyBottleTakes,
  bottlePerformance,
  cardFee,
  cashLines,
  closeTicket,
  commitClose,
  expandRecipe,
  fifoTakes,
  groupSpaces,
  lineDeductions,
  openBottle,
  openBottlesConcurrent,
  openOrResume,
  operationalNight,
  posPermission,
  postBottleMove,
  previewSale,
  rememberClose,
  removeTicketItem,
  voidSale,
} from '../src/lib/posFloor.js'
import { movementOperationalDay, nightSettlement, reconcileNight, summarizeNight } from '../src/lib/nightClose.js'
import { tokyoWallToUtcMs } from '../src/lib/tokyo.js'
import { readPosDeviceMode, suggestPosDeviceMode, writePosDeviceMode } from '../src/lib/posDeviceMode.js'

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
assert.throws(() => openBottle({ stockUnits: 1, product: hennessy, code: 'X', volumeMl: 70, employeeId: 'emp-1', barId: 'bar-a' }), /volume must match the product/)
assert.throws(() => openBottle({ stockUnits: 1, product: { id: 'prod-h' }, code: 'X', employeeId: 'emp-1', barId: 'bar-a' }), /product volume missing/)
assert.equal(opened.bottle.custo, 18000)
assert.equal(opened.bottle.volume_original, 700)

const race = openBottlesConcurrent(1, [
  { product: hennessy, code: 'A', employeeId: 'emp-1', barId: 'bar-a' },
  { product: hennessy, code: 'B', employeeId: 'emp-2', barId: 'bar-a' },
])
assert.equal(race.results.filter(row => row.ok).length, 1)
assert.equal(race.results.filter(row => !row.ok)[0].error, 'bottle not in stock')
assert.equal(race.stock, 0)

const drinkParts = lineDeductions({ drink_menu_id: 'drink-1', qtd: 2 }, [{ produto_id: 'prod-h', volume_ml: 30 }])
assert.deepEqual(drinkParts, [{ mode: 'ml', produto_id: 'prod-h', volume_ml: 60 }])
const sealedParts = lineDeductions({ produto_id: 'prod-h', qtd: 1 })
assert.deepEqual(sealedParts, [{ mode: 'unit', produto_id: 'prod-h', qtd: 1 }])
assert.throws(() => lineDeductions({ drink_menu_id: 'drink-1', qtd: 1 }, []), /recipe required/)
assert.throws(() => lineDeductions({ drink_menu_id: 'drink-1', qtd: 1 }, [{ produto_id: 'prod-h', volume_ml: 30, quantity: 1 }]), /mixes unit and ml/)

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
assert.equal(sale.consumption.every(row => row.mode === 'ml'), true)
assert.equal(sale.stockMoves.some(row => row.mode === 'ml'), false)
assert.equal(sale.stockMoves[0].qtd, 1)
assert.equal(sale.requirements[0].available, 740)
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

const partialSale = {
  id: 'venda-1',
  total: 6000,
  refunded: 0,
  metodo_pagamento: 'card',
  card_fee: 227,
  comissao_valor: 2000,
  items: [{
    id: 'line-1', qtd: 2, refunded_qtd: 0, unit_price: 3000, comissao_valor: 2000, stock_mode: 'ml', consumed_ml: 60,
  }],
}
const voided = voidSale(partialSale, {
  kind: 'partial_refund', qty: 1, itemId: 'line-1', reason: 'wrong drink', employeeId: 'emp-1', approverId: 'mgr-1',
})
assert.equal(voided.sale.total, 6000)
assert.equal(voided.sale.refunded, 3000)
assert.equal(voided.sale.comissao_valor, 2000)
assert.equal(voided.sale.comissao_estornada, 1000)
assert.equal(voided.feeReversal, Math.round(227 * 3000 / 6000))
assert.equal(voided.cash.filter(row => row.referencia_tipo === 'taxa_cartao').length, 0)
assert.equal(voided.cash.find(row => row.referencia_tipo === 'taxa_cartao_estorno').tipo, 'entrada')
assert.equal(voided.restores[0].volume_ml, 30)
assert.equal(voided.event.kind, 'partial_refund')
assert.throws(() => voidSale(voided.sale, {
  kind: 'partial_refund', qty: 2, itemId: 'line-1', reason: 'again', employeeId: 'emp-1', approverId: 'mgr-1',
}), /refund exceeds item/)
const rest = voidSale(voided.sale, { kind: 'void', reason: 'close it', employeeId: 'emp-1', approverId: 'mgr-1' })
assert.equal(rest.sale.refunded, 6000)
assert.equal(rest.sale.void_status, 'void')
assert.equal(rest.sale.comissao_estornada, 2000)
assert.equal(rest.sale.card_fee_reversed, 227)
assert.equal(rest.sale.total, 6000)
assert.throws(() => voidSale(rest.sale, {
  kind: 'refund', reason: 'x', employeeId: 'emp-1', approverId: 'mgr-1',
}), /already void/)

const cashVoid = voidSale({
  id: 'venda-cash', total: 4000, refunded: 0, metodo_pagamento: 'cash', card_fee: 0, comissao_valor: 0,
  items: [{ id: 'u1', qtd: 1, unit_price: 4000, stock_mode: 'unit', produto_id: 'prod-h', comissao_valor: 0 }],
}, { kind: 'void', reason: 'cash back', employeeId: 'emp-1', approverId: 'mgr-1' })
assert.equal(cashVoid.feeReversal, 0)
assert.equal(cashVoid.restores[0].mode, 'unit')
assert.equal(cashVoid.restores.some(row => row.mode === 'ml'), false)

const creditFee = cardFee(10000, 'credit')
assert.equal(creditFee, 378)
assert.equal(cardFee(10000, 'other'), 0)

const night = summarizeNight([
  { total: 10000, refunded: 3000, metodo_pagamento: 'card', card_fee: 378, card_fee_reversed: 113, data: '2026-09-27', criado_em: '2026-09-27T12:00:00Z' },
  { total: 4000, refunded: 0, metodo_pagamento: 'cash', card_fee: 0, data: '2026-09-27', criado_em: '2026-09-27T13:00:00Z' },
], '2026-09-27')
assert.equal(night.grossSales, 14000)
assert.equal(night.refunds, 3000)
assert.equal(night.netSales, 11000)
assert.equal(night.drinksTotal, 11000)
assert.equal(night.cardFees, 378 - 113)
assert.equal(night.cashTotal, 4000)
assert.deepEqual(nightSettlement([
  { total: 10000, refunded: 0, metodo_pagamento: 'credit', card_fee: 378 },
]), { gross_sales: 10000, refunds: 0, net_sales: 10000, card_fees: 378 })

const low = previewSale({
  items: [{ drink_menu_id: 'cheap', qtd: 1, forCast: true }],
  catalog: [{ id: 'cheap', nome: 'Beer', preco_venda: 2000, bar_id: 'bar-a' }],
  recipes: { cheap: [{ produto_id: 'prod-h', volume_ml: 30 }] },
  bottles,
  agent: { id: 'cast-1', comissao_pct: 50 },
  payment: 'cash',
  barId: 'bar-a',
})
assert.equal(low.commission, 0)
assert.throws(() => previewSale({
  items: [{ drink_menu_id: 'missing', qtd: 1 }],
  catalog: [{ id: 'missing', nome: 'Mystery', preco_venda: 3000, bar_id: 'bar-a' }],
  recipes: {},
  bottles,
  payment: 'cash',
  barId: 'bar-a',
}), /recipe required/)

let book = []
const openedTicket = openOrResume(book, { barId: 'bar-a', spaceId: 'table-12', employeeId: 'emp-open', id: 'ticket-1' })
assert.equal(openedTicket.created, true)
book = [openedTicket.ticket]
const withItem = addTicketItem(openedTicket.ticket, { drinkMenuId: 'drink-1', employeeId: 'emp-open', forCast: true, id: 'item-1' })
book = [withItem]
const otherDevice = openOrResume(book, { barId: 'bar-a', spaceId: 'table-12', employeeId: 'emp-2' })
assert.equal(otherDevice.created, false)
assert.equal(otherDevice.ticket.id, 'ticket-1')
const switched = addTicketItem(otherDevice.ticket, { drinkMenuId: 'drink-1', employeeId: 'emp-2', id: 'item-2' })
assert.equal(switched.created_by, 'emp-open')
assert.equal(switched.items[1].added_by, 'emp-2')
const removed = removeTicketItem(switched, 'item-2')
assert.equal(removed.items.length, 1)
assert.throws(() => removeTicketItem(removed, 'item-2'), /item missing/)
const refreshed = openOrResume([removed], { barId: 'bar-a', spaceId: 'table-12', employeeId: 'emp-3' })
assert.equal(refreshed.ticket.items.length, 1)
const keys = new Map()
const paid = closeTicket(refreshed.ticket, { key: 'close-1', store: keys, vendaId: 'venda-9', employeeId: 'emp-pay' })
assert.equal(paid.duplicate, false)
assert.equal(paid.ticket.closed_by, 'emp-pay')
assert.equal(paid.ticket.created_by, 'emp-open')
const paidAgain = closeTicket(paid.ticket, { key: 'close-2', store: keys, vendaId: 'venda-x', employeeId: 'emp-pay' })
assert.equal(paidAgain.duplicate, true)
assert.equal(paidAgain.vendaId, 'venda-9')
assert.throws(() => addTicketItem(paid.ticket, { drinkMenuId: 'drink-1', employeeId: 'emp-open' }), /ticket not open/)

const retryStore = new Map()
assert.throws(() => commitClose(retryStore, 'same', 'venda-a', { failBeforeWrite: true }))
const retried = commitClose(retryStore, 'same', 'venda-a')
const replay = commitClose(retryStore, 'same', 'venda-b')
const otherKey = commitClose(retryStore, 'other', 'venda-c')
assert.equal(retried.created, true)
assert.equal(replay.created, false)
assert.equal(replay.vendaId, 'venda-a')
assert.equal(otherKey.created, true)

function tokyoAt(year, month, day, hour, minute) {
  return new Date(tokyoWallToUtcMs(year, month, day, hour, minute)).toISOString()
}
assert.equal(operationalNight(tokyoAt(2026, 9, 28, 5, 59)), '2026-09-27')
assert.equal(operationalNight(tokyoAt(2026, 9, 28, 6, 0)), '2026-09-28')
assert.equal(operationalNight(tokyoAt(2026, 9, 27, 23, 59)), '2026-09-27')
assert.equal(operationalNight(tokyoAt(2026, 9, 28, 0, 1)), '2026-09-27')
assert.equal(operationalNight('2026-09-27T20:30:00Z'), '2026-09-27')
assert.equal(operationalNight('2026-09-27T12:00:00Z'), '2026-09-27')

const wastedOut = postBottleMove(
  { id: 'b9', status: 'opened', volume_atual: 20, volume_original: 700 },
  { kind: 'breakage', volumeMl: 20, employeeId: 'emp-1', reason: 'floor' },
)
assert.equal(wastedOut.bottle.status, 'wasted')
const complimentary = postBottleMove(
  { id: 'b8', status: 'opened', volume_atual: 30, volume_original: 700 },
  { kind: 'complimentary', volumeMl: 30, employeeId: 'emp-1', reason: 'guest' },
)
assert.equal(complimentary.bottle.status, 'depleted')
assert.throws(() => postBottleMove(
  { id: 'b8', status: 'opened', volume_atual: 30, volume_original: 700 },
  { kind: 'waste', volumeMl: 5, employeeId: 'emp-1' },
), /reason required/)
assert.throws(() => lineFromCatalogCross())

function lineFromCatalogCross() {
  return previewSale({
    items: [{ drink_menu_id: 'drink-1', qtd: 1, bar_id: 'bar-b' }],
    catalog: [{ id: 'drink-1', nome: 'Hennessy Coca', preco_venda: 3000, bar_id: 'bar-a' }],
    recipes: { 'drink-1': [{ produto_id: 'prod-h', volume_ml: 30 }] },
    bottles,
    payment: 'cash',
    barId: 'bar-b',
  })
}

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
assert.match(sql, /recipe required/)
assert.match(sql, /product volume missing/)
assert.match(sql, /pg_advisory_xact_lock/)
assert.match(sql, /pos_tickets_one_open_space/)
assert.match(sql, /added_by/)
assert.match(sql, /ticket_created/)
assert.match(sql, /bottle_opened/)
assert.match(sql, /bottle_consumed/)
assert.match(sql, /payment_completed/)
assert.match(sql, /comissao_estornada/)
assert.match(sql, /taxa_cartao_estorno/)
assert.match(sql, /remaining_pct/)
assert.match(sql, /waste_ml/)
assert.match(sql, /stock_mode/)
assert.match(sql, /bar not allowed/)
assert.doesNotMatch(sql, /dblink/)
assert.match(sql, /RETURN NULL/)
assert.match(sql, /admin', 'jbm'/)
assert.match(sql, /user_can_access_bar/)
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.pos_open_bottle\(uuid, uuid, text\)/)
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.pos_open_bottle\(uuid, uuid, text, integer\)/)
assert.doesNotMatch(sql, /DELETE FROM public\.pos_vendas/)
assert.doesNotMatch(sql, /procurement_tasks/)

const authSql = readFileSync('sql/pos_sale_security.sql', 'utf8')
assert.match(authSql, /'cliente', 'gerente', 'caixa', 'bar_staff'/)
assert.doesNotMatch(authSql, /fornecedor/)

const floor = readFileSync('src/components/PosFloor.jsx', 'utf8')
assert.match(floor, /pos_close_ticket/)
assert.match(floor, /pos_load_ticket/)
assert.match(floor, /pos_preview_ticket/)
assert.match(floor, /pos_ticket_item/)
assert.doesNotMatch(floor, /preco_unitario:/)
assert.doesNotMatch(floor, /previewSale/)
assert.match(floor, /pos_bottle_move/)
assert.doesNotMatch(floor.slice(0, floor.indexOf('pos_bottle_move')), /p_volume/)
assert.match(floor, /error\.message/)

const panel = readFileSync('src/components/AtomicPos.jsx', 'utf8')
assert.match(panel, /access !== 'cashier'/)
assert.match(panel, /legacyIsolated/)
assert.match(sql, /operational_day/)
assert.match(sql, /reason required/)
assert.doesNotMatch(floor, /commitPosSale|create_order|syncPosStockAndReorder|deductBottlesForPosSale/)
assert.match(panel, /commitPosSale/)
assert.match(panel, /syncPosStockAndReorder/)

const at0530 = new Date(tokyoWallToUtcMs(2026, 9, 28, 5, 30)).toISOString()
const at0600 = new Date(tokyoWallToUtcMs(2026, 9, 28, 6, 0)).toISOString()
assert.equal(movementOperationalDay({ data: at0530 }), '2026-09-27')
assert.equal(movementOperationalDay({ data: at0600 }), '2026-09-28')
assert.equal(movementOperationalDay({ data: at0600, operational_day: '2026-09-27' }), '2026-09-27')
assert.equal(movementOperationalDay({ data: '2026-09-28' }), '2026-09-28')
const books = reconcileNight(
  [{ total: 10000, refunded: 2000, metodo_pagamento: 'card', card_fee: 378, card_fee_reversed: 76, data: '2026-09-27', criado_em: at0530 }],
  [
    { tipo: 'entrada', valor: 10000, referencia_tipo: 'pos_venda', data: at0530 },
    { tipo: 'saida', valor: 378, referencia_tipo: 'taxa_cartao', data: at0530 },
    { tipo: 'saida', valor: 2000, referencia_tipo: 'pos_void', operational_day: '2026-09-27', data: at0600 },
    { tipo: 'entrada', valor: 76, referencia_tipo: 'taxa_cartao_estorno', operational_day: '2026-09-27', data: at0600 },
    { tipo: 'entrada', valor: 999, referencia_tipo: 'venda', data: at0530 },
  ],
  '2026-09-27',
)
assert.equal(books.gross_sales, 10000)
assert.equal(books.refunds, 2000)
assert.equal(books.net_sales, 8000)
assert.equal(books.card_fees, 378 - 76)
assert.equal(books.cashNet, 10000 - 2000 - 378 + 76)
assert.equal(books.aligned, true)
assert.equal(books.cashIn, 10000)

const roles = ['admin', 'jbm', 'gerente', 'caixa', 'bar_staff', 'cliente', 'fornecedor', 'funcionario', 'staff']
const matrix = Object.fromEntries(roles.map(role => [role, posPermission(role, { sameBar: true })]))
for (const role of ['gerente', 'caixa', 'bar_staff', 'cliente']) {
  assert.equal(matrix[role].openPos, true)
  assert.equal(matrix[role].openBottle, true)
  assert.equal(matrix[role].sell, true)
  assert.equal(matrix[role].close, true)
  assert.equal(matrix[role].voidSale, true)
  assert.equal(matrix[role].waste, true)
  assert.equal(matrix[role].seeBottles, true)
  assert.equal(matrix[role].rpc, true)
  assert.equal(matrix[role].select, true)
  assert.equal(posPermission(role, { sameBar: false }).rpc, false)
  assert.equal(posPermission(role, { sameBar: false }).select, false)
}
assert.equal(matrix.admin.openPos, false)
assert.equal(matrix.admin.rpc, true)
assert.equal(matrix.admin.select, true)
assert.equal(matrix.admin.otherBarRpc, true)
assert.equal(matrix.admin.otherBarSelect, true)
assert.equal(matrix.jbm.openPos, false)
assert.equal(matrix.jbm.rpc, true)
assert.equal(matrix.jbm.select, false)
assert.equal(matrix.jbm.seeBottles, false)
assert.equal(matrix.jbm.otherBarRpc, true)
assert.equal(matrix.jbm.otherBarSelect, false)
for (const role of ['fornecedor', 'funcionario', 'staff']) {
  assert.equal(matrix[role].openPos, false)
  assert.equal(matrix[role].rpc, false)
  assert.equal(matrix[role].select, false)
  assert.equal(matrix[role].openBottle, false)
  assert.equal(matrix[role].voidSale, false)
  assert.equal(matrix[role].waste, false)
}

const memory = new Map()
const storage = {
  getItem: key => (memory.has(key) ? memory.get(key) : null),
  setItem: (key, value) => memory.set(key, value),
}
assert.equal(readPosDeviceMode('cashier-1', storage), null)
writePosDeviceMode('cashier-1', 'mobile', storage)
assert.equal(storage.getItem('POS_DEVICE_MODE:cashier-1'), 'mobile')
assert.equal(storage.getItem('POS_DEVICE_MODE'), 'mobile')
assert.equal(readPosDeviceMode('cashier-1', storage), 'mobile')
writePosDeviceMode('cashier-1', 'tablet', storage)
assert.equal(readPosDeviceMode('cashier-1', storage), 'tablet')
assert.equal(suggestPosDeviceMode({ width: 390, height: 844 }), 'mobile')
assert.equal(suggestPosDeviceMode({ width: 375, height: 667 }), 'mobile')
assert.equal(suggestPosDeviceMode({ width: 430, height: 932 }), 'mobile')
assert.equal(suggestPosDeviceMode({ width: 768, height: 1024 }), 'tablet')
assert.equal(suggestPosDeviceMode({ width: 1024, height: 768 }), 'tablet')
assert.equal(suggestPosDeviceMode({ width: 1280, height: 800 }), 'tablet')
assert.equal(suggestPosDeviceMode({ width: 932, height: 430 }), 'mobile')

const mobileHtml = readFileSync('src/components/pos/PosMobile.jsx', 'utf8')
const tabletHtml = readFileSync('src/components/pos/PosTablet.jsx', 'utf8')
assert.match(mobileHtml, /data-pos-mode="mobile"/)
assert.match(mobileHtml, /pos-m-nav/)
assert.match(mobileHtml, /pos-m-charge/)
assert.doesNotMatch(mobileHtml, /pos-t-board/)
assert.match(tabletHtml, /data-pos-mode="tablet"/)
assert.match(tabletHtml, /pos-t-board/)
assert.match(tabletHtml, /pos-t-spaces/)
assert.match(tabletHtml, /pos-t-products/)
assert.match(tabletHtml, /pos-t-ticket/)
assert.match(tabletHtml, /pos-t-charge/)
assert.doesNotMatch(tabletHtml, /pos-m-nav/)
const floorSource = readFileSync(new URL('../src/components/PosFloor.jsx', import.meta.url), 'utf8')
assert.match(floorSource, /pos_load_ticket/)
assert.match(floorSource, /pos_ticket_item/)
assert.match(floorSource, /pos_close_ticket/)
assert.match(floorSource, /pos_open_bottle/)
assert.match(floorSource, /pos_bottle_move/)
assert.doesNotMatch(floorSource, /pos_void_sale/)

console.log('pos floor tests passed')
