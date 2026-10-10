import assert from 'node:assert/strict'
import { HQ_AREAS, HQ_ADMIN_TABS, aiModuleForTab, groupTabs, pathForTab, tabFromPath } from '../src/lib/navigation.js'
import {
  buildClientRows, campaignLift, campaignRow, clientSignals, invoiceOwed, kpiDelta, planProgress, sortClientRows, validateCampaign,
} from '../src/lib/growth.js'
import { buildCatalog, searchCatalog, toggleFavorite } from '../src/lib/posCatalog.js'
import { buildSaleArgs, commitSaleAtomic } from '../src/lib/posCommit.js'
import { pendingToLines, splitEvenly, tableState, tabMoney, validateMoves } from '../src/lib/comandas.js'
import { resolveItemPrice } from '../src/lib/atomicPos.js'
import * as fe from '../src/lib/floorEditor.js'

let n = 0
const queue = []
const test = (name, fn) => queue.push([name, fn])

test('every HQ area id is unique and every admin tab has an area', () => {
  const ids = HQ_AREAS.flatMap(a => a.ids)
  assert.equal(new Set(ids).size, ids.length)
  for (const tab of HQ_ADMIN_TABS) assert.ok(ids.includes(tab), `${tab} has no area`)
})

test('groupTabs keeps unknown tabs in a trailing group instead of dropping them', () => {
  const g = groupTabs(['cashflow', 'dashboard', 'legacyThing'])
  assert.deepEqual(g.map(x => x.id), ['overview', 'finance', 'more'])
  assert.deepEqual(g.at(-1).ids, ['legacyThing'])
})

test('URL routing: /hq/<tab> only for allowed tabs, round trip', () => {
  assert.equal(tabFromPath('/hq/cashflow', 'hq', ['cashflow'], 'dashboard'), 'cashflow')
  assert.equal(tabFromPath('/hq/usuarios', 'hq', ['cashflow'], 'dashboard'), 'dashboard')
  assert.equal(tabFromPath('/', 'hq', ['cashflow'], 'dashboard'), 'dashboard')
  assert.equal(tabFromPath(pathForTab('hq', 'crm'), 'hq', ['crm'], 'x'), 'crm')
})

test('AI module per screen', () => {
  assert.equal(aiModuleForTab('cashflow'), 'finance')
  assert.equal(aiModuleForTab('mesas'), 'floor')
  assert.equal(aiModuleForTab('nope'), 'overview')
})

const today = '2026-10-10'
const bars = [{ id: 'a', nome: 'Alpha' }, { id: 'b', nome: 'Beta' }]
const sales = [
  { bar_id: 'a', total: 1000, data: '2026-10-01' },
  { bar_id: 'a', total: 500, data: '2026-09-01' }, // previous 30d window
  { bar_id: 'b', total: 200, data: '2026-08-01' }, // outside both
]
const invoices = [
  { bar_id: 'a', total: 3000, pago: 1000, status: 'parcial', vencimento: '2026-10-01' },
  { bar_id: 'a', total: 999, pago: 0, status: 'pago', vencimento: '2026-01-01' },
  { bar_id: 'b', valor: 400, pago: 0, status: 'pendente', data_vencimento: '2026-12-01' },
]

test('invoice owed ignores paid invoices and uses valor when total is missing', () => {
  assert.equal(invoiceOwed(invoices[0]), 2000)
  assert.equal(invoiceOwed(invoices[1]), 0)
  assert.equal(invoiceOwed(invoices[2]), 400)
})

test('client rows: revenue windows, growth, receivable and overdue', () => {
  const rows = buildClientRows({ bars, sales, invoices, orders: [{ bar_id: 'b', status: 'pendente', data_pedido: '2026-10-05' }], today, days: 30 })
  const a = rows.find(r => r.id === 'a')
  const b = rows.find(r => r.id === 'b')
  assert.equal(a.revenue, 1000)
  assert.equal(a.prevRevenue, 500)
  assert.equal(a.growthPct, 100)
  assert.equal(a.receivable, 2000)
  assert.equal(a.overdue, 2000)
  assert.equal(b.revenue, 0)
  assert.equal(b.growthPct, null, 'no base → no invented growth')
  assert.equal(b.lastOrder, '2026-10-05')
  assert.equal(b.openOrders, 1)
  assert.equal(b.overdue, 0)
  assert.deepEqual(clientSignals(a), ['overdue'])
  assert.deepEqual(clientSignals(b), [])
  assert.equal(sortClientRows(rows, 'name')[0].nome, 'Alpha')
})

test('campaign validation and row normalisation', () => {
  assert.equal(validateCampaign({ nome: '' }), 'growth.errName')
  assert.equal(validateCampaign({ nome: 'x', inicio: '2026-10-10', fim: '2026-10-01' }), 'growth.errDates')
  assert.equal(validateCampaign({ nome: 'x', orcamento: '-1' }), 'growth.errBudget')
  assert.equal(validateCampaign({ nome: 'x', orcamento: '' }), '')
  const row = campaignRow({ nome: ' Happy hour ', orcamento: '', bar_id: '' })
  assert.equal(row.nome, 'Happy hour')
  assert.equal(row.orcamento, null)
  assert.equal(row.bar_id, null)
})

test('campaign lift compares the window with the same number of days before', () => {
  const s = [
    { bar_id: 'a', total: 300, data: '2026-10-02' },
    { bar_id: 'a', total: 100, data: '2026-09-29' },
    { bar_id: 'b', total: 999, data: '2026-10-02' },
  ]
  const lift = campaignLift(s, { bar_id: 'a', inicio: '2026-10-01', fim: '2026-10-03' }, today)
  assert.deepEqual(lift, { days: 3, during: 300, before: 100, pct: 200 })
  assert.equal(campaignLift(s, { bar_id: 'a', inicio: null }), null)
})

test('plan progress and KPI delta', () => {
  const p = planProgress([{ status: 'done' }, { status: 'todo', prazo: '2026-10-01' }, { status: 'doing' }], today)
  assert.deepEqual(p, { total: 3, done: 1, overdue: 1, pct: 33 })
  assert.deepEqual(kpiDelta(100, 150), { delta: 50, pct: 50 })
  assert.deepEqual(kpiDelta(0, 10), { delta: 10, pct: null })
  assert.equal(kpiDelta(undefined, 10), null)
})

// ── till catalog, sale payload, tabs ──────────────────────────────────────
const catalog = buildCatalog(
  [{ id: 'd1', nome: 'Highball', categoria: 'Whisky', preco_venda: 800, codigo: 'HB' },
   { id: 'd2', nome: 'Gin Tonic', categoria: 'Cocktail', preco_venda: 900, codigo: '12' },
   { id: 'd3', nome: 'Água', categoria: 'Soft', preco_venda: 300 },
   { id: 'd4', nome: 'Free water', categoria: 'Soft', preco_venda: 0 }],
  [{ produto_id: 'p1', preco_drink: 1000, produtos: { nome: 'Tequila shot', categoria: 'Tequila' } }],
)

test('catalog drops items without price and keys drinks/shots apart', () => {
  assert.deepEqual(catalog.map(i => i.key), ['d-d1', 'd-d2', 'd-d3', 'p-p1'])
})

test('search by code beats name, multi-word, accents, category', () => {
  assert.equal(searchCatalog(catalog, '12')[0].nome, 'Gin Tonic')
  assert.equal(searchCatalog(catalog, 'hb')[0].nome, 'Highball')
  assert.equal(searchCatalog(catalog, 'gin ton')[0].nome, 'Gin Tonic')
  assert.equal(searchCatalog(catalog, 'agua')[0].nome, 'Água')
  assert.equal(searchCatalog(catalog, 'tequila')[0].key, 'p-p1')
  assert.deepEqual(searchCatalog(catalog, 'whisky').map(i => i.nome), ['Highball'])
  assert.deepEqual(searchCatalog(catalog, ''), [])
  assert.deepEqual(toggleFavorite(toggleFavorite([], 'a'), 'a'), [])
})

test('sale payload: total = Σ lines incl. service, bottles only for shots, charges excluded from stock', () => {
  const cart = [
    { drink_menu_id: 'd1', nome: 'Highball', qtd: 2, preco_unitario: 800, preco_lista: 800, tipo_preco: 'regular' },
    { produto_id: 'p1', nome: 'Tequila shot', qtd: 4, preco_unitario: 1000, preco_lista: 1000, tipo_preco: 'regular' },
    { nome: 'Service 10%', qtd: 1, preco_unitario: 560, preco_lista: 560, tipo_preco: 'service' },
  ]
  const args = buildSaleArgs({ barId: 'b', cart, payMethod: 'Cash', pricingByProduto: { p1: { drinks_por_garrafa: 16 } }, commission: 120.4 })
  assert.equal(args.sale.total, 6160)
  assert.equal(args.sale.tipo, 'balcao')
  assert.equal(args.sale.comissao_valor, 120)
  assert.deepEqual(args.stock, [{ produto_id: 'p1', qtd: 0.25 }])
  assert.equal(args.items.length, 3)
  assert.equal(buildSaleArgs({ barId: 'b', cart, vipId: 'v' }).sale.tipo, 'vip')
  assert.equal(buildSaleArgs({ barId: 'b', cart, codeId: 'c' }).sale.tipo, 'desconto')
})

test('VIP/code prices: line price is already net, discount kept per unit', () => {
  const vip = resolveItemPrice({ preco_venda: 1000, preco_desconto: 500 }, 'vip')
  assert.equal(vip.preco_unitario, 500)
  assert.equal(vip.desconto_valor, 500)
  const code = resolveItemPrice({ preco_venda: 1000, id: 'x', kind: 'drink' }, 'regular', { tipo: 'percent', valor: 10 })
  assert.equal(code.preco_unitario, 900)
  const args = buildSaleArgs({ barId: 'b', cart: [{ ...vip, drink_menu_id: 'x', nome: 'X', qtd: 2 }], vipId: 'v' })
  assert.equal(args.sale.total, 1000)
  assert.equal(args.sale.desconto_total, 1000)
})

test('commitSaleAtomic: one RPC per key even with a double tap', async () => {
  let calls = 0
  const sb = { rpc: async () => { calls++; await new Promise(r => setTimeout(r, 10)); return { data: 'venda-1', error: null } } }
  const opts = { key: 'sale-abc12345', barId: 'b', cart: [{ nome: 'X', qtd: 1, preco_unitario: 100 }] }
  const [a, b] = await Promise.all([commitSaleAtomic(sb, opts), commitSaleAtomic(sb, opts)])
  assert.equal(calls, 1)
  assert.equal(a.vendaId, 'venda-1')
  assert.equal(b.vendaId, 'venda-1')
})

test('commitSaleAtomic surfaces conflicts and refuses tabs without the migration', async () => {
  const conflict = { rpc: async () => ({ data: null, error: { code: '40001', message: 'tab changed on another device' } }) }
  const r = await commitSaleAtomic(conflict, { key: 'sale-conflict1', barId: 'b', cart: [{ nome: 'X', qtd: 1, preco_unitario: 1 }] })
  assert.equal(r.ok, false)
  assert.equal(r.conflict, true)
  const missing = { rpc: async () => ({ data: null, error: { code: 'PGRST202', message: 'Could not find the function' } }) }
  const m = await commitSaleAtomic(missing, { key: 'sale-missing1', barId: 'b', comandaId: 'c', cart: [{ nome: 'X', qtd: 1, preco_unitario: 1 }] })
  assert.equal(m.ok, false)
})

test('table states: manual, waiting to order, consuming, occupied, waiting to pay', () => {
  const now = Date.parse('2026-10-10T22:00:00Z')
  const table = { id: 't1', estado_manual: null }
  assert.equal(tableState(table, [], now), 'free')
  assert.equal(tableState({ ...table, estado_manual: 'reserved' }, [], now), 'reserved')
  assert.equal(tableState(table, [{ table_id: 't1', status: 'open', itens_qtd: 0, aberta_em: '2026-10-10T21:50:00Z' }], now), 'awaiting_order')
  assert.equal(tableState(table, [{ table_id: 't1', status: 'open', itens_qtd: 2, ultimo_item_em: '2026-10-10T21:40:00Z' }], now), 'consuming')
  assert.equal(tableState(table, [{ table_id: 't1', status: 'open', itens_qtd: 2, ultimo_item_em: '2026-10-10T21:00:00Z' }], now), 'occupied')
  assert.equal(tableState(table, [{ table_id: 't1', status: 'awaiting_payment', itens_qtd: 2 }], now), 'awaiting_payment')
  assert.equal(tableState({ ...table, estado_manual: 'cleaning' }, [{ table_id: 't1', status: 'closed' }], now), 'cleaning')
})

test('tab money: service on drinks, partial payments, due never negative', () => {
  const items = [{ id: 'i1', nome: 'HB', qtd: 3, preco_unitario: 800 }, { id: 'i2', nome: 'Old', qtd: 1, preco_unitario: 500, removido_em: 'x' }]
  const m = tabMoney({ service_pct: 10 }, items, [{ valor: 1000 }, { valor: 999, estornado_em: 'x' }])
  assert.equal(m.drinksTotal, 2400)
  assert.equal(m.total, 2640)
  assert.equal(m.paid, 1000)
  assert.equal(m.due, 1640)
  assert.equal(tabMoney({}, items, [{ valor: 9999 }]).due, 0)
})

test('split evenly adds up exactly; move validation', () => {
  assert.deepEqual(splitEvenly(1000, 3), [334, 333, 333])
  assert.equal(splitEvenly(1001, 4).reduce((a, b) => a + b, 0), 1001)
  const lines = [{ item_id: 'i1', qtd: 2 }]
  assert.equal(validateMoves([], lines), 'tabs.errNothingSelected')
  assert.equal(validateMoves([{ item: 'i1', qtd: 3 }], lines), 'tabs.errQty')
  assert.equal(validateMoves([{ item: 'zz', qtd: 1 }], lines), 'tabs.errLineGone')
  assert.equal(validateMoves([{ item: 'i1', qtd: 2 }], lines), '')
  assert.deepEqual(pendingToLines([{ nome: 'A', qtd: 0, preco_unitario: 1 }, { nome: 'B', qtd: 2, preco_unitario: 5, drink_menu_id: 'd' }]).map(l => l.nome), ['B'])
})

const base = () => ({ layout: { id: 'L', versao: 3, nome: 'Salão', largura: 600, altura: 400 }, sectors: [{ id: 's1', nome: 'VIP', cor: '#000' }],
  tables: [{ id: 't1', nome: '1', forma: 'square', x: 20, y: 20, largura: 90, altura: 90, capacidade: 4, sector_id: 's1', ativo: true }], selected: null })

test('floor editor: add, duplicate and names never collide; tables stay inside the floor', () => {
  let st = fe.addTable(base(), 'rect')
  assert.equal(st.tables.length, 2)
  assert.equal(st.tables[1].nome, '2')
  assert.ok(!fe.overlaps(st.tables[0], st.tables[1]))
  st = fe.duplicateTable(st, 't1')
  assert.equal(st.tables[2].nome, '3')
  st = fe.updateTable(st, 't1', { x: 9999, y: -50 })
  assert.equal(st.tables[0].x, 600 - 90)
  assert.equal(st.tables[0].y, 0)
  st = fe.updateTable(st, 't1', { forma: 'round', largura: 120 })
  assert.equal(st.tables[0].largura, st.tables[0].altura)
  assert.deepEqual(fe.validateLayout(fe.updateTable(st, 't1', { nome: '2' })), ['floor.errDupName'])
})

test('floor editor: a table with an open tab cannot be removed; sectors unlink cleanly', () => {
  const st = fe.removeTable(base(), 't1', new Set(['t1']))
  assert.equal(st.error, 'floor.errBusyTable')
  assert.equal(fe.removeTable(base(), 't1').tables.length, 0)
  const noSector = fe.removeSector(base(), 's1')
  assert.equal(noSector.tables[0].sector_id, null)
})

test('floor editor: save payload keeps ids, new rows without id, new sectors by key', () => {
  let st = fe.addSector(base(), 'Terraço')
  const newSector = st.sectors[1].id
  st = fe.addTable(st, 'round', { sector_id: newSector })
  const p = fe.toSavePayload(st)
  assert.equal(p.versao, 3)
  assert.equal(p.tables[0].id, 't1')
  assert.equal(p.tables[0].sector_id, 's1')
  assert.equal(p.tables[1].id, undefined)
  assert.equal(p.tables[1].sector_key, newSector)
  assert.equal(p.sectors[1].key, newSector)
  assert.equal(p.sectors[1].id, undefined)
  assert.ok(fe.isDirty(base(), st))
  assert.ok(!fe.isDirty(base(), { ...base(), selected: 't1' }))
})

test('floor editor: undo/redo', () => {
  let h = fe.createHistory(base())
  h = fe.pushHistory(h, fe.addTable(h.present, 'bar'))
  assert.equal(h.present.tables.length, 2)
  h = fe.undo(h)
  assert.equal(h.present.tables.length, 1)
  h = fe.redo(h)
  assert.equal(h.present.tables.length, 2)
  assert.equal(fe.fitZoom(0, 0, base().layout), 1)
  assert.equal(fe.fitZoom(624, 424, base().layout), 1)
})

for (const [name, fn] of queue) { await fn(); n++; console.log(`ok ${n} - ${name}`) }
console.log(`\n${n} passed`)
