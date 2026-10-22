import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import {
  addTicketItem,
  applyBottleTakes,
  bottlePerformance,
  cardFee,
  cardMethodLabel,
  cardPaymentsFee,
  cardSurcharge,
  cashLines,
  machineFee,
  normalizeCardMachines,
  parseCardMethod,
  pickCardMachine,
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
import { movementOperationalDay, nightSettlement, reconcileNight, saleCardFee, summarizeNight } from '../src/lib/nightClose.js'
import { cardSurchargeLine, packTicketObs, readTicketMeta, settingsFromRow } from '../src/lib/nightTicket.js'
import { tabMoney } from '../src/lib/comandas.js'
import { orderDetailsFromObs } from '../src/lib/orderMeta.js'
import { tokyoWallToUtcMs } from '../src/lib/tokyo.js'
import { itemVisual, rankTopSellers, starterPicks } from '../src/lib/posVisual.js'
import {
  ON_ACCOUNT, discountGuestError, guestBalance, hasDiscount, isCrmGuest, ledgerBalances, ledgerTotal, methodDisplay,
  onAccountError, onAccountGuestId, onAccountMethod, parseOnAccountMethod, queueRows, receivePaymentRow, saleOnAccountRow,
  searchCrm, tabOnAccountRows, tonightGlance,
} from '../src/lib/onAccount.js'

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

// Card machines: per-machine rate, default machine, surcharge, labels, settings.
assert.equal(cardFee(10000, 'card', 0.0324), 324)
assert.equal(cardFee(10000, 'card', undefined), 378)
assert.equal(cardFee(10000, 'cash', 0.05), 0)
assert.equal(cashLines({ total: 10000, method: 'card', rate: 0.0198 }).fee, 198)
assert.equal(cashLines({ total: 10000, method: 'card' }).fee, 378)
assert.deepEqual(normalizeCardMachines(), [{ id: 'card-1', nome: 'Card', fee_pct: 3.78 }])
assert.deepEqual(normalizeCardMachines([{ nome: '', fee_pct: 3 }, { nome: 'X', fee_pct: 99 }]), [{ id: 'card-1', nome: 'Card', fee_pct: 3.78 }])
const twoMachines = normalizeCardMachines([{ id: 'sq', nome: 'Square', fee_pct: 3.25 }, { id: 'air', nome: 'Airペイ', fee_pct: '3.74' }])
assert.equal(twoMachines.length, 2)
assert.equal(pickCardMachine(twoMachines, 'air').nome, 'Airペイ')
assert.equal(pickCardMachine(twoMachines, 'gone').id, 'sq')
assert.equal(machineFee(10000, twoMachines[1]), 374)
assert.equal(machineFee(10000, null), 378)
assert.equal(cardSurcharge(10000, 3), 300)
assert.equal(cardSurcharge(10000, 0), 0)
assert.equal(cardMethodLabel({ method: 'Credit card', machine: twoMachines[1], surcharge: 300 }), 'Credit card · Airペイ · +300')
assert.equal(cardMethodLabel({ method: 'Credit card', machine: twoMachines[0], named: false }), 'Credit card')
assert.deepEqual(parseCardMethod('Credit card · Airペイ · +300'), { card: true, machine: 'Airペイ', surcharge: 300 })
assert.deepEqual(parseCardMethod('Credit card'), { card: true, machine: null, surcharge: 0 })
assert.deepEqual(parseCardMethod('Cash'), { card: false, machine: null, surcharge: 0 })
const tabFees = cardPaymentsFee([
  { valor: 5150, metodo: 'Credit card · Airペイ · +150' },
  { valor: 3000, metodo: 'Credit card' },
  { valor: 2000, metodo: 'Cash' },
  { valor: 9999, metodo: 'Credit card · Airペイ', estornado_em: '2026-09-27T12:00:00Z' },
], twoMachines)
assert.equal(tabFees.fee, Math.round(5150 * 0.0374) + Math.round(3000 * 0.0325))
assert.equal(tabFees.note, 'Airペイ 3.74% + Square 3.25%')
const barSettings = settingsFromRow({ service_pct: 15, card_surcharge_pct: 3, card_machines: twoMachines })
assert.equal(barSettings.service_pct, 15)
assert.equal(barSettings.card_surcharge_pct, 3)
assert.equal(barSettings.card_machines.length, 2)
assert.equal(settingsFromRow(null).card_surcharge_pct, 0)
assert.equal(settingsFromRow(null).card_machines.length, 1)
const surLine = cardSurchargeLine(300, 3)
assert.equal(surLine.preco_unitario, 300)
assert.equal(surLine.tipo_preco, 'service') // exempt from the tab drink-line check in pos_commit_sale
assert.equal(cardSurchargeLine(0, 3), null)
const cardObs = packTicketObs({ payNote: 'Pay: Credit card record-only', cardNote: 'Airペイ 3.74%', cardFee: 386, cardSurcharge: 300, details: 'Table 4' })
const cardMeta = readTicketMeta(cardObs)
assert.equal(cardMeta.cardNote, 'Airペイ 3.74%')
assert.equal(cardMeta.cardFee, 386)
assert.equal(cardMeta.cardSurcharge, 300)
assert.equal(orderDetailsFromObs(cardObs), 'Table 4')
assert.equal(saleCardFee({ total: 10300, refunded: 0, metodo_pagamento: 'Credit card', card_fee: 0, obs: cardObs }), 386)
assert.equal(saleCardFee({ total: 10300, refunded: 5150, metodo_pagamento: 'Credit card', card_fee: 0, obs: cardObs }), 193)
assert.equal(saleCardFee({ total: 10000, refunded: 0, metodo_pagamento: 'card', card_fee: 378, obs: cardObs }), 378)
assert.equal(saleCardFee({ total: 10000, refunded: 0, metodo_pagamento: 'Cash', card_fee: 0, obs: 'Pay: Cash exact 10000' }), 0)
// Tab: a card payment with surcharge pays the bill plus the surcharge; the surcharge never reduces what is due.
const surTab = tabMoney({ service_pct: 0 }, [{ id: 'i1', nome: 'Gin', qtd: 2, preco_unitario: 5000 }], [
  { valor: 5150, metodo: 'Credit card · Airペイ · +150' },
])
assert.equal(surTab.total, 10000)
assert.equal(surTab.paid, 5150)
assert.equal(surTab.surchargePaid, 150)
assert.equal(surTab.due, 5000)
assert.equal(tabMoney({ service_pct: 0 }, [{ id: 'i1', nome: 'Gin', qtd: 1, preco_unitario: 5000 }], [{ valor: 2000, metodo: 'Cash' }]).due, 3000)

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
assert.match(sql, /admin', 'jbm'/)
assert.match(sql, /user_can_access_bar/)
assert.match(sql, /GRANT EXECUTE ON FUNCTION public\.pos_open_bottle\(uuid, uuid, text\)/)
assert.doesNotMatch(sql, /GRANT EXECUTE ON FUNCTION public\.pos_open_bottle\(uuid, uuid, text, integer\)/)
assert.doesNotMatch(sql, /DELETE FROM public\.pos_vendas/)
assert.doesNotMatch(sql, /procurement_tasks/)

const authSql = readFileSync('sql/pos_sale_security.sql', 'utf8')
assert.match(authSql, /'cliente', 'gerente', 'caixa', 'bar_staff'/)
assert.doesNotMatch(authSql, /fornecedor/)

const panel = readFileSync('src/components/AtomicPos.jsx', 'utf8')
assert.match(panel, /access !== 'cashier'/)
assert.match(sql, /operational_day/)
assert.match(sql, /reason required/)
// The till (PosQuick, the only checkout) commits through posCommit (one atomic RPC; commitPosSale only as fallback before the migration).
const quickTill = readFileSync('src/components/pos/PosQuick.jsx', 'utf8')
assert.match(quickTill, /commitSaleAtomic/)
const commitSource = readFileSync('src/lib/posCommit.js', 'utf8')
assert.match(commitSource, /pos_commit_sale/)
assert.match(commitSource, /commitPosSale/)
assert.match(quickTill, /syncPosStockAndReorder/)
assert.match(panel, /PosQuick/)
assert.doesNotMatch(panel, /PosCheckoutTab|classicTill/)

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


// Till tiles: photo when present, otherwise a category icon.
assert.equal(itemVisual({ categoria: 'Beer', nome: 'Asahi' }).emoji, '🍺')
assert.equal(itemVisual({ categoria: 'Tequila Base', nome: 'Paloma' }).emoji, '🌵')
assert.equal(itemVisual({ categoria: 'Shots', nome: 'Jack Daniels' }).emoji, '🔥')
assert.equal(itemVisual({ categoria: 'Whisky Base', imagem_url: 'https://x/y.jpg' }).image, 'https://x/y.jpg')
assert.ok(itemVisual({ categoria: '???' }).emoji)

// Most ordered: summed quantity, drinks and shots apart, highest first.
assert.deepEqual(rankTopSellers([
  { drink_menu_id: 'a', qtd: 1 },
  { drink_menu_id: 'b', qtd: 3 },
  { produto_id: 'a', qtd: 2 },
  { drink_menu_id: 'a', qtd: 1 },
  { qtd: 9 },
]), ['d-b', 'd-a', 'p-a'])
assert.deepEqual(rankTopSellers([{ drink_menu_id: 'a', qtd: 1 }, { drink_menu_id: 'b', qtd: 2 }], 1), ['d-b'])
assert.deepEqual(starterPicks([
  { key: 'd-1', categoria: 'Beer' },
  { key: 'd-2', categoria: 'Beer' },
  { key: 'd-3', categoria: 'Wine' },
]), ['d-1', 'd-3'])

const quickSource = readFileSync(new URL('../src/components/pos/PosQuick.jsx', import.meta.url), 'utf8')
assert.match(quickSource, /commitSaleAtomic/)
assert.match(quickSource, /pq-charge/)
assert.match(quickSource, /posQuick\.top/)
assert.doesNotMatch(quickSource, /pos_void_sale/)

// ── On account (ツケ) and CRM-only discounts ────────────────────────────────────────────────
{
  const kenji = { id: 'g-kenji', nome: 'Kenji Sato', ativo: true }
  const mika = { id: 'g-mika', nome: 'Mika · Tanaka #1', ativo: true, vip_member_id: 'vip-1', tags: ['vip'] }

  // Method text round trip; the customer id never shows to people; never read as a card payment.
  const m = onAccountMethod(kenji)
  assert.equal(m, 'On account · Kenji Sato #g-kenji')
  assert.deepEqual(parseOnAccountMethod(m), { onAccount: true, nome: 'Kenji Sato', guestId: 'g-kenji' })
  assert.equal(methodDisplay(m), 'On account · Kenji Sato')
  assert.equal(methodDisplay('Credit card · Square · +300'), 'Credit card · Square · +300')
  assert.equal(parseOnAccountMethod('Cash').onAccount, false)
  assert.equal(parseCardMethod(m).card, false)
  // Separators in a name cannot break the parse.
  assert.equal(parseOnAccountMethod(onAccountMethod(mika)).guestId, 'g-mika')
  assert.equal(parseOnAccountMethod(onAccountMethod(mika)).nome, 'Mika Tanaka 1')

  // CRM membership and the discount rule.
  assert.equal(isCrmGuest(kenji), true)
  assert.equal(isCrmGuest({ id: 'x', ativo: false }), false)
  assert.equal(isCrmGuest(null), false)
  assert.equal(hasDiscount({}), false)
  assert.equal(hasDiscount({ codeId: 'c1' }), true)
  assert.equal(hasDiscount({ priceType: 'vip' }), true)
  assert.equal(discountGuestError({ priceType: 'regular' }), '')
  assert.equal(discountGuestError({ codeId: 'c1', guest: null }), 'onAccount.errDiscountGuest')
  assert.equal(discountGuestError({ priceType: 'vip', vipId: 'vip-1', guest: mika }), '')
  assert.equal(discountGuestError({ priceType: 'vip', guest: { id: 'gone', ativo: false } }), 'onAccount.errDiscountGuest')

  // Amount put on account: CRM customer, positive, not more than what is due.
  assert.equal(onAccountError({ guest: null, amount: 1000, due: 1000 }), 'onAccount.errGuest')
  assert.equal(onAccountError({ guest: kenji, amount: 0, due: 1000 }), 'onAccount.errAmount')
  assert.equal(onAccountError({ guest: kenji, amount: 1200, due: 1000 }), 'onAccount.errOverDue')
  assert.equal(onAccountError({ guest: kenji, amount: 600, due: 1000 }), '')

  // A tab paid 4,000 cash + 6,000 on account is fully paid; the on-account part is not a card surcharge.
  const tab = { service_pct: 0 }
  const items = [{ id: 'i1', nome: 'Champagne', qtd: 1, preco_unitario: 10000 }]
  const tabPays = [
    { id: 'p1', comanda_id: 't1', valor: 4000, metodo: 'Cash' },
    { id: 'p2', comanda_id: 't1', valor: 6000, metodo: onAccountMethod(kenji), pagador: 'Kenji Sato' },
    { id: 'p3', comanda_id: 't1', valor: 500, metodo: onAccountMethod(mika), estornado_em: '2026-10-10T20:00:00Z' },
  ]
  const money = tabMoney(tab, items, tabPays, {})
  assert.equal(money.paid, 10000)
  assert.equal(money.surchargePaid, 0)
  assert.equal(money.due, 0)

  // Closing the tab: one ledger charge per live on-account payment, id = payment id (a retry cannot double it).
  const rows = tabOnAccountRows(tabPays, { barId: 'bar', vendaId: 'v1', guests: [kenji], now: '2026-10-10T21:00:00Z' })
  assert.equal(rows.length, 1)
  assert.deepEqual(
    { id: rows[0].id, guest_id: rows[0].guest_id, guest_nome: rows[0].guest_nome, tipo: rows[0].tipo, valor: rows[0].valor, venda_id: rows[0].venda_id, comanda_id: rows[0].comanda_id },
    { id: 'p2', guest_id: 'g-kenji', guest_nome: 'Kenji Sato', tipo: 'charge', valor: 6000, venda_id: 'v1', comanda_id: 't1' },
  )
  assert.equal(onAccountGuestId(tabPays), 'g-kenji')
  assert.equal(onAccountGuestId([{ metodo: onAccountMethod(kenji) }, { metodo: onAccountMethod(mika) }]), null)
  assert.equal(onAccountGuestId([{ metodo: 'Cash' }]), null)

  // Counter sale fully on account: ledger id = sale id.
  const counter = saleOnAccountRow({ barId: 'bar', vendaId: 'v2', guest: mika, valor: 3000.4, now: '2026-10-11T01:00:00Z' })
  assert.equal(counter.id, 'v2')
  assert.equal(counter.valor, 3000)
  assert.equal(counter.tipo, 'charge')

  // Balances: charges − payments, reversed rows ignored, biggest debt first, settled customers hidden.
  const ledger = [
    ...rows,
    counter,
    { id: 'x1', guest_id: 'g-kenji', guest_nome: 'Kenji Sato', tipo: 'payment', valor: 2500, criado_em: '2026-10-12T20:00:00Z' },
    { id: 'x2', guest_id: 'g-kenji', guest_nome: 'Kenji Sato', tipo: 'payment', valor: 9999, estornado_em: '2026-10-12T21:00:00Z' },
    { id: 'x3', guest_id: 'g-old', guest_nome: 'Old', tipo: 'charge', valor: 1000 },
    { id: 'x4', guest_id: 'g-old', guest_nome: 'Old', tipo: 'payment', valor: 1000 },
  ]
  const bal = ledgerBalances(ledger)
  assert.deepEqual(bal.map(b => [b.guest_id, b.balance]), [['g-kenji', 3500], ['g-mika', 3000]])
  assert.equal(ledgerBalances(ledger, { all: true }).length, 3)
  assert.equal(bal[0].last, '2026-10-12T20:00:00Z')
  assert.equal(guestBalance(ledger, 'g-kenji'), 3500)
  assert.equal(guestBalance(ledger, 'nobody'), 0)
  assert.equal(ledgerTotal(ledger), 6500)

  // Receiving a later payment: positive, not more than owed.
  const owedKenji = bal[0]
  assert.equal(receivePaymentRow({ id: 'r1', barId: 'bar', guest: owedKenji, valor: 0, balance: 3500 }).error, 'onAccount.errAmount')
  assert.equal(receivePaymentRow({ id: 'r1', barId: 'bar', guest: owedKenji, valor: 4000, balance: 3500 }).error, 'onAccount.errOverBalance')
  assert.equal(receivePaymentRow({ id: 'r1', barId: 'bar', guest: null, valor: 100 }).error, 'onAccount.errGuest')
  const got = receivePaymentRow({ id: 'r1', barId: 'bar', guest: owedKenji, valor: '3500', metodo: 'PayPay', balance: 3500 })
  assert.equal(got.row.tipo, 'payment')
  assert.equal(got.row.guest_id, 'g-kenji')
  assert.equal(got.row.valor, 3500)
  assert.equal(guestBalance([...ledger, got.row], 'g-kenji'), 0)

  // Offline queue: replaying the same id replaces, never adds.
  assert.deepEqual(queueRows([{ id: 'a', valor: 1 }], [{ id: 'a', valor: 2 }, { id: 'b', valor: 3 }]), [{ id: 'a', valor: 2 }, { id: 'b', valor: 3 }])
  assert.deepEqual(queueRows([], [{ valor: 1 }]), [])

  // CRM search: active only, by name / LINE / tag.
  const crm = [kenji, mika, { id: 'g-x', nome: 'Gone', ativo: false }, { id: 'g-l', nome: 'Lin', line_id: 'lin.vip' }]
  assert.deepEqual(searchCrm(crm, '').map(g => g.id), ['g-kenji', 'g-mika', 'g-l'])
  assert.deepEqual(searchCrm(crm, 'vip').map(g => g.id), ['g-mika', 'g-l'])
  assert.deepEqual(searchCrm(crm, 'gone'), [])
  assert.equal(ON_ACCOUNT, 'On account')
}

// ── Tonight card: closed sales + what is open on tabs ──────────────────────────────────────
{
  const night = '2026-10-10'
  const at = (h, m = 0, day = 10) => new Date(tokyoWallToUtcMs(2026, 10, day, h, m)).toISOString()
  // No closed sale yet, a VIP tab with ¥10,000 open: sold 0, open 10,000 on 1 tab (this is what the owner saw).
  const none = summarizeNight([], night)
  assert.deepEqual(tonightGlance({ summary: none, tabs: [{ total: 10000, paid: 0 }, { total: 0, paid: 0 }] }),
    { soldTotal: 0, soldCount: 0, openTotal: 10000, openPaid: 0, openCount: 1 })
  // Sales after midnight belong to the night that started the evening before; yesterday's and refunds are out.
  const sales = [
    { total: 5000, criado_em: at(22), data: night },
    { total: 3000, refunded: 1000, criado_em: at(2, 30, 11), data: night },
    { total: 9000, criado_em: at(23, 0, 9), data: '2026-10-09' },
  ]
  const g = tonightGlance({ summary: summarizeNight(sales, night), tabs: [{ total: 7700, paid: 2000 }] })
  assert.equal(g.soldTotal, 7000)
  assert.equal(g.soldCount, 2)
  assert.equal(g.openTotal, 7700)
  assert.equal(g.openPaid, 2000)
  assert.deepEqual(tonightGlance(), { soldTotal: 0, soldCount: 0, openTotal: 0, openPaid: 0, openCount: 0 })
}

// The till and the tab panel offer "on account" and require a CRM customer.
{
  const quick = readFileSync(new URL('../src/components/pos/PosQuick.jsx', import.meta.url), 'utf8')
  const panel = readFileSync(new URL('../src/components/floor/TabPanel.jsx', import.meta.url), 'utf8')
  assert.match(quick, /discountGuestError/)
  assert.match(quick, /tabOnAccountRows/)
  assert.match(quick, /pq-glance/)
  assert.doesNotMatch(quick, /pq-night/)
  assert.match(panel, /ON_ACCOUNT/)
  assert.match(panel, /CustomerPicker/)
  const live = readFileSync(new URL('../src/lib/barLiveClient.js', import.meta.url), 'utf8')
  const store = readFileSync(new URL('../api/_barLiveStore.js', import.meta.url), 'utf8')
  assert.match(live, /'bar_guest_ledger'/)
  assert.match(store, /'bar_guest_ledger'/)
}

console.log('pos floor tests passed')
