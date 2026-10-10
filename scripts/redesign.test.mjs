import assert from 'node:assert/strict'
import { HQ_AREAS, HQ_ADMIN_TABS, aiModuleForTab, groupTabs, pathForTab, tabFromPath } from '../src/lib/navigation.js'
import {
  buildClientRows, campaignLift, campaignRow, clientSignals, invoiceOwed, kpiDelta, planProgress, sortClientRows, validateCampaign,
} from '../src/lib/growth.js'
import { buildCatalog, searchCatalog, toggleFavorite } from '../src/lib/posCatalog.js'
import { buildSaleArgs, commitSaleAtomic } from '../src/lib/posCommit.js'
import { planSaveRows, pendingToLines, splitEvenly, tableState, tabMoney, validateMoves } from '../src/lib/comandas.js'
import { resolveItemPrice } from '../src/lib/atomicPos.js'
import * as fe from '../src/lib/floorEditor.js'
import { moveItem, resolveLayout, serializeLayout } from '../src/lib/dashboardLayoutCore.js'
import { deltaPct, niceMax, shortNum } from '../src/lib/chartMath.js'
import { staffDayCsv, staffDayReport } from '../src/lib/staffDayReport.js'
import { drinkPhotoPath, fitSize } from '../src/lib/drinkPhoto.js'
import { greetingPart } from '../src/lib/greeting.js'
import { vipRentals } from '../src/lib/vipRooms.js'
import { goalGuide, goalHours, personalGoalSource } from '../src/lib/goalDefinitions.js'
import { notificationToOrder, openForStaff, orderStats, orderToNotification } from '../src/lib/staffOrders.js'
import { cartAdd, cartBump, cartTotals } from '../src/lib/quickCart.js'
import { seatSpots } from '../src/lib/floor3d.js'
import { areaOpen, hashPin, pinMatches, publicLock, signUnlock, validPin, verifyUnlock } from '../api/_barVault.js'
import { areaForTab } from '../src/lib/vault.js'
import { fixedMonthCost, paymentAgenda } from '../src/lib/barClose.js'
import { openOrders, receivedByProduct, receivedTimeline, restockSuggestions, supplyOverview } from '../src/lib/drinkSupply.js'

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

test('dashboard layout: saved order wins, new cards append, defaults hide', () => {
  const widgets = [{ id: 'a', size: 'full' }, { id: 'b', size: 'half' }, { id: 'c', size: 'half', defaultHidden: true }]
  const fresh = resolveLayout(widgets, null)
  assert.deepEqual(fresh.map(i => [i.id, i.hidden, i.size]), [['a', false, 'full'], ['b', false, 'half'], ['c', true, 'half']])
  const saved = { order: ['b', 'a', 'gone'], hidden: ['a'], sizes: { b: 'full' } }
  const items = resolveLayout(widgets, saved)
  assert.deepEqual(items.map(i => i.id), ['b', 'a', 'c'])
  assert.equal(items[0].size, 'full')
  assert.equal(items[1].hidden, true)
  assert.equal(items[2].hidden, true, 'a card added after saving keeps its default')
  const moved = moveItem(items, 2, 0)
  assert.deepEqual(moved.map(i => i.id), ['c', 'b', 'a'])
  assert.equal(moveItem(items, 0, 9), items)
  assert.deepEqual(serializeLayout(moved).order, ['c', 'b', 'a'])
})

test('chart math: nice axis, short numbers, change vs previous', () => {
  assert.equal(niceMax(87000), 100000)
  assert.equal(niceMax(1200), 2000)
  assert.equal(niceMax(0), 1)
  assert.equal(shortNum(2500000), '2.5M')
  assert.equal(shortNum(25000), '25k')
  assert.equal(shortNum(1200), '1.2k')
  assert.equal(deltaPct(112, 100), 12)
  assert.equal(deltaPct(50, 0), null)
})

test('daily staff report: shifts, open shift until now, late/absent, sales by name or id', () => {
  const r = staffDayReport({
    night: '2026-10-09',
    staff: [{ id: 'a', nome: 'Ana', salario_hora: 1200 }, { id: 'b', nome: 'Bia', salario_hora: 1100 }, { id: 'c', nome: 'Caio' }, { id: 'd', nome: 'Duda', ativo: false }],
    punches: [
      { staff_id: 'a', tipo: 'in', punched_at: '2026-10-09T10:00:00.000Z' },
      { staff_id: 'a', tipo: 'out', punched_at: '2026-10-09T16:00:00.000Z' },
      { staff_id: 'b', tipo: 'in', punched_at: '2026-10-09T12:00:00.000Z' },
      { staff_id: 'a', tipo: 'in', punched_at: '2026-10-08T10:00:00.000Z' },
    ],
    tickets: [
      { obs: 'Cast: Ana', total: 5000, criado_em: '2026-10-09T13:00:00.000Z' },
      { obs: 'Cast: Someone|b', total: 3000, criado_em: '2026-10-09T14:00:00.000Z' },
      { obs: '', total: 2000, criado_em: '2026-10-09T13:30:00.000Z' },
      { obs: 'Cast: Ana', total: 9000, criado_em: '2026-10-08T13:00:00.000Z' },
    ],
    sheet: { late: [{ id: 'b' }], absent: [{ id: 'c' }] },
    now: '2026-10-09T15:00:00.000Z',
  })
  const by = Object.fromEntries(r.rows.map(x => [x.id, x]))
  assert.equal(by.d, undefined, 'inactive staff is left out')
  assert.deepEqual([by.a.status, by.a.firstIn, by.a.lastOut, by.a.hours, by.a.lateHours], ['done', '19:00', '01:00', 6, 3])
  assert.equal(by.a.pay, 3 * 1200 + Math.round(3 * 1200 * 1.25))
  assert.deepEqual([by.a.tickets, by.a.sales], [1, 5000], 'other nights do not count')
  assert.deepEqual([by.b.status, by.b.late, by.b.hours, by.b.lateHours, by.b.sales], ['working', true, 3, 2, 3000])
  assert.equal(by.c.status, 'absent')
  assert.deepEqual([r.totals.people, r.totals.unassigned, r.totals.tickets], [2, 1, 3])
  assert.equal(r.rows[0].id, 'b', 'people working now come first')
  const csv = staffDayCsv(r).split('\n')
  assert.equal(csv.length, 4)
  assert.match(csv[2], /^2026-10-09,Ana,,done,,19:00,01:00,6,3,/)
})

test('drink photo: fit inside 800px without upscaling, safe storage path', () => {
  assert.deepEqual(fitSize(4000, 3000), { width: 800, height: 600 })
  assert.deepEqual(fitSize(300, 500), { width: 300, height: 500 })
  assert.equal(drinkPhotoPath('bar-1', 'Gin Tônic!', 5), 'bar-1/5-gin-tonic.jpg')
  assert.equal(drinkPhotoPath('../x', '', 5), 'x/5-drink.jpg')
})

test('welcome greeting follows Tokyo time', () => {
  assert.equal(greetingPart(new Date('2026-10-10T00:00:00Z')), 'morning')
  assert.equal(greetingPart(new Date('2026-10-10T05:00:00Z')), 'afternoon')
  assert.equal(greetingPart(new Date('2026-10-10T10:00:00Z')), 'evening')
  assert.equal(greetingPart(new Date('2026-10-10T16:00:00Z')), 'night')
})

test('VIP room uses: links tickets to visits, keeps loose room tickets, flags under-minimum', () => {
  const rooms = [{ id: 'r1', nome: 'VIP 1', capacidade: 6 }, { id: 'r2', nome: 'VIP 2', capacidade: 4 }]
  const visits = [
    { id: 'v1', space_id: 'r1', status: 'done', party_size: 4, inicio: '2026-10-09T12:00:00Z', fim: '2026-10-09T14:00:00Z', host_nome: 'Aiko', bar_guests: { nome: 'Tanaka' } },
    { id: 'v2', space_id: 'r2', status: 'seated', party_size: 2, inicio: '2026-10-09T15:00:00Z', fim: null },
    { id: 'v3', space_id: 'x', status: 'done', party_size: 2, inicio: '2026-10-09T15:00:00Z', fim: '2026-10-09T16:00:00Z' },
  ]
  const sales = [
    { id: 's1', total: 30000, space_id: 'r1', visit_id: 'v1', criado_em: '2026-10-09T13:50:00Z', obs: 'RoomMin: 10000' },
    { id: 's2', total: 6000, space_id: 'r1', visit_id: null, criado_em: '2026-10-09T14:10:00Z', obs: '' },
    { id: 's3', total: 8000, space_id: 'r2', visit_id: null, criado_em: '2026-10-09T15:30:00Z', obs: 'RoomMin: 10000' },
    { id: 's4', total: 5000, space_id: 'r2', visit_id: null, criado_em: '2026-10-08T12:00:00Z', obs: '' },
  ]
  const r = vipRentals({ rooms, visits, sales, from: '2026-10-08', to: '2026-10-09', now: new Date('2026-10-09T16:00:00Z') })
  const by = Object.fromEntries(r.rows.map(x => [x.id, x]))
  assert.deepEqual([by.v1.spend, by.v1.tickets, by.v1.minutes, by.v1.perHour, by.v1.guest], [36000, 2, 120, 18000, 'Tanaka'], 'ticket rung 10 min after leaving still belongs to the visit')
  assert.deepEqual([by.v2.open, by.v2.minutes, by.v2.spend, by.v2.minimum], [true, 60, 8000, 10000])
  assert.equal(by['sale:s4'].kind, 'ticket')
  assert.equal(r.rows.length, 3, 'visits in other spaces are not VIP uses')
  assert.deepEqual([r.totals.uses, r.totals.spend, r.totals.belowMin, r.totals.open], [3, 49000, 1, 1])
})

test('goal guide: targets, progress and the hours used in the definitions', () => {
  const rows = goalGuide({ noite: { sales: 90000, goal: 150000, pct: 60 }, lucro: { profit: 1000, goal: 0, pct: null } }, { noite: 150000, abre: 19, fecha: 4 })
  assert.deepEqual(rows.map(r => r.id), ['noite', 'hora', 'semana', 'turno', 'lucro', 'mes', 'pessoa'])
  assert.deepEqual([rows[0].target, rows[0].current, rows[0].pct], [150000, 90000, 60])
  assert.equal(rows[4].target, 0)
  assert.deepEqual(goalHours({ abre: 19, fecha: 4 }), { abre: '19:00', fecha: '04:00', corta: '00:00' })
  assert.equal(personalGoalSource({ source: 'pos' }), 'sales')
  assert.equal(personalGoalSource({ source: 'drink_back' }), 'drinkBack')
  assert.equal(personalGoalSource({}), 'manual')
})

test('staff orders: urgent first, overdue count, bell fallback round trip', () => {
  const now = Date.parse('2026-10-10T12:00:00Z')
  const orders = [
    { id: 'a', status: 'sent', prioridade: 'normal', criado_em: '2026-10-10T10:00:00Z' },
    { id: 'b', status: 'seen', prioridade: 'urgent', criado_em: '2026-10-10T11:00:00Z', due_at: '2026-10-10T11:30:00Z' },
    { id: 'c', status: 'done', prioridade: 'urgent', criado_em: '2026-10-10T09:00:00Z' },
    { id: 'd', status: 'cancelled', prioridade: 'normal', criado_em: '2026-10-10T09:00:00Z' },
  ]
  assert.deepEqual(openForStaff(orders).map(o => o.id), ['b', 'a'])
  assert.deepEqual(orderStats(orders, now), { sent: 1, seen: 1, done: 1, overdue: 1, open: 2 })
  const n = orderToNotification({ to: { id: 'u1' }, mensagem: 'Ice to VIP 1', prioridade: 'urgent', fromNome: 'Boss' })
  assert.deepEqual([n.user_id, n.tipo, n.lida], ['u1', 'ordem', false])
  const back = notificationToOrder({ ...n, id: 7, criado_em: '2026-10-10T11:00:00Z' })
  assert.deepEqual([back.id, back.prioridade, back.from_nome, back.status, back.mensagem], ['n:7', 'urgent', 'Boss', 'sent', 'Ice to VIP 1'])
})

test('staff quick cart uses the till line shape', () => {
  const item = { key: 'd-1', id: '1', kind: 'drink', nome: 'Highball', categoria: 'Whisky', preco_venda: 800 }
  let cart = cartAdd([], item)
  cart = cartAdd(cart, item)
  assert.deepEqual([cart.length, cart[0].qtd, cart[0].drink_menu_id, cart[0].preco_unitario], [1, 2, '1', 800])
  assert.deepEqual(pendingToLines(cart)[0].qtd, 2)
  assert.deepEqual(cartTotals(cart), { items: 2, total: 1600 })
  assert.deepEqual(cartBump(cart, 'd-1', -2), [])
})

test('3D floor seats: count follows capacity, counters seat one side', () => {
  assert.equal(seatSpots('round', 100, 100, 4).length, 4)
  assert.equal(seatSpots('rect', 160, 100, 0).length, 0)
  const bar = seatSpots('bar', 200, 60, 4)
  assert.ok(bar.every(s => s.y > 60), 'counter seats sit in front of the counter')
  assert.equal(seatSpots('square', 80, 80, 99).length, 16, 'capped')
})

test('floor plan save without the migration: keeps ids, maps new sectors, drops removed rows', () => {
  let n = 0
  const rows = planSaveRows({
    layoutId: 'L', sectors: [{ id: 's1', nome: 'VIP', ordem: 0 }, { key: 'tmp-a', nome: 'Terrace', ordem: 1 }],
    tables: [{ id: 't1', nome: '1', forma: 'round', capacidade: 4, sector_id: 's1' }, { nome: 'Wall', forma: 'wall', sector_key: 'tmp-a' }],
  }, { barId: 'B', oldSectorIds: ['s1', 's9'], oldTableIds: ['t1', 't8'], makeId: () => `new${++n}` })
  assert.deepEqual(rows.sectors.map(x => [x.id, x.bar_id, x.layout_id]), [['s1', 'B', 'L'], ['new1', 'B', 'L']])
  assert.deepEqual(rows.tables.map(x => [x.id, x.sector_id, x.capacidade]), [['t1', 's1', 4], ['new2', 'new1', 0]])
  assert.ok(!('sector_key' in rows.tables[1]))
  assert.deepEqual([rows.dropSectors, rows.dropTables], [['s9'], ['t8']])
  const st = fe.addTable(fe.addTable({ layout: { largura: 900, altura: 500 }, tables: [{ id: 'a', nome: '1', forma: 'square', x: 0, y: 0, largura: 90, altura: 90 }], sectors: [] }, 'wall', { nome: 'Wall' }), 'square')
  assert.equal(st.tables.at(-1).nome, '2', 'walls do not break table numbering')
  assert.equal(st.tables[1].altura, 16, 'thin walls are allowed')
  assert.deepEqual(fe.validateLayout(fe.addTable(st, 'wall', { nome: 'Wall' })), [], 'two walls may share a name')
})

test('drink supply: one list of what arrived, open orders late first, restock skips what is on order', () => {
  const pedidos = [
    { id: 'aaaaaaaa-1', status: 'entregue', data_pedido: '2026-10-01', total_estimado: 9000, pedidos_itens: [{ id: 'i1', qtd: 3, preco_unitario: 3000, produtos: { nome: 'Gin' } }] },
    { id: 'bbbbbbbb-2', status: 'entregue', data_pedido: '2026-10-03', data_entrega_prevista: '2026-10-04', total_estimado: 5000, pedidos_itens: [] },
    { id: 'cccccccc-3', status: 'confirmado', data_pedido: '2026-10-08', data_entrega_prevista: '2026-10-12', pedidos_itens: [{ id: 'i2', produto_id: 'p1', qtd: 6 }] },
    { id: 'dddddddd-4', status: 'pendente', data_pedido: '2026-10-02', data_entrega_prevista: '2026-10-05', pedidos_itens: [] },
    { id: 'eeeeeeee-5', status: 'cancelado', data_pedido: '2026-09-20', pedidos_itens: [] },
  ]
  const notes = [{ id: 'n1', data: '2026-10-02', total: 9900, obs: 'Auto: order aaaaaaaa', vendas_itens: [{ id: 'v1', qtd: 3, preco_unitario: 3300, produtos: { nome: 'Gin' } }] }]
  const rows = receivedTimeline({ pedidos, notes })
  assert.deepEqual(rows.map(r => [r.kind, r.date]), [['order', '2026-10-04'], ['note', '2026-10-02'], ['cancelled', '2026-09-20']])
  assert.equal(rows[1].order.id, 'aaaaaaaa-1', 'the note is joined to its order, which is not listed twice')
  assert.equal(receivedTimeline({ pedidos, notes, month: '2026-09' }).length, 1)
  assert.deepEqual(openOrders(pedidos, '2026-10-10').map(p => [p.id, p.late]), [['dddddddd-4', true], ['cccccccc-3', false]])
  const restock = restockSuggestions([
    { id: 'p1', nome: 'Gin', hasCount: true, stock: 1, minimo: 6, preco_venda: 3000 },
    { id: 'p2', nome: 'Rum', hasCount: true, stock: 0, minimo: 4, preco_venda: 2500 },
    { id: 'p3', nome: 'Beer', hasCount: true, stock: 20, minimo: 4 },
  ], pedidos)
  assert.deepEqual(restock.map(r => [r.produto_id, r.qtd]), [['p2', 8]], 'gin is already on an open order')
  const o = supplyOverview({ pedidos, notes, restock, today: '2026-10-10', month: '2026-10' })
  assert.deepEqual([o.toOrder, o.onTheWay, o.late, o.nextArrival, o.receivedCount, o.receivedTotal], [1, 2, 1, '2026-10-12', 2, 14900])
  assert.deepEqual(receivedByProduct(rows), [{ nome: 'Gin', qtd: 3, total: 9900 }])
})

test('bar costs: power counts in its own month, dated bills land on their pay date', () => {
  const registry = [
    { id: 'r', kind: 'aluguel', nome: 'Realty', amount: 180000, vence_dia: 25, metodo: 'transfer' },
    { id: 'e1', kind: 'energia', nome: 'Tokyo Power', amount: 32000, month_key: '2026-10', data_pagamento: '2026-10-20', metodo: 'debit' },
    { id: 'e0', kind: 'energia', nome: 'Tokyo Power', amount: 29000, month_key: '2026-09' },
    { id: 'v1', kind: 'variavel', nome: 'Repair', amount: 18000, month_key: '2026-10', data_pagamento: '2026-10-15' },
    { id: 'v2', kind: 'variavel', nome: 'Glasses', amount: 5000, month_key: '2026-10' },
  ]
  const c = fixedMonthCost(registry, null, '2026-10')
  assert.deepEqual([c.rent, c.energy, c.variable], [180000, 32000, 23000])
  const items = paymentAgenda({ registry, today: '2026-10-10' })
  const byId = Object.fromEntries(items.map(i => [i.id, i]))
  assert.deepEqual([byId.e1.date, byId.e1.amount, byId.e1.tab], ['2026-10-20', 32000, 'variavel'])
  assert.ok(!byId.energia, 'no undated power left over')
  assert.deepEqual([byId.v1.date, byId.variavel.amount], ['2026-10-15', 5000])
  assert.deepEqual([byId.aluguel.metodo, byId.aluguel.tab], ['transfer', 'fixo'])
})

test('owner PIN: salted, never public, unlock token bound to bar, user and time', () => {
  assert.ok(validPin('1234') && validPin('12345678') && !validPin('123') && !validPin('12a4'))
  const a = hashPin('2580')
  const b = hashPin('2580')
  assert.notEqual(a.hash, b.hash, 'salted')
  const row = { pin_hash: a.hash, pin_salt: a.salt, areas: ['money'], minutes: 15 }
  assert.ok(pinMatches('2580', row) && !pinMatches('2581', row) && !pinMatches('', row))
  const pub = publicLock(row)
  assert.deepEqual(pub, { enabled: true, hasPin: true, areas: ['money'], minutes: 15 })
  assert.ok(!JSON.stringify(pub).includes(a.hash) && !JSON.stringify(pub).includes(a.salt))
  const now = Date.now()
  const { token } = signUnlock({ barId: 'B', uid: 'U', minutes: 15, now })
  assert.ok(verifyUnlock(token, { barId: 'B', uid: 'U' }))
  assert.equal(verifyUnlock(token, { barId: 'B2', uid: 'U' }), null, 'other bar')
  assert.equal(verifyUnlock(token, { barId: 'B', uid: 'X' }), null, 'other user')
  assert.equal(verifyUnlock(token, { barId: 'B', uid: 'U', now: now + 16 * 60000 }), null, 'expired')
  const [p, body, sig] = token.split('.')
  const forged = Buffer.from(JSON.stringify({ b: 'B', u: 'U', exp: now + 9e9 })).toString('base64url')
  assert.equal(verifyUnlock(`${p}.${forged}.${sig}`, { barId: 'B', uid: 'U' }), null, 'tampered')
  assert.ok(body)
  const req = tok => ({ headers: tok ? { 'x-bar-unlock': tok } : {} })
  assert.equal(areaOpen(req(), row, 'money', { barId: 'B', uid: 'U' }), false)
  assert.equal(areaOpen(req(token), row, 'money', { barId: 'B', uid: 'U' }), true)
  assert.equal(areaOpen(req(), row, 'payroll', { barId: 'B', uid: 'U' }), true, 'payroll not locked here')
  assert.equal(areaOpen(req(), null, 'money', { barId: 'B' }), true, 'no PIN set')
  assert.deepEqual(['cartao', 'fechamento', 'salarios', 'staff', 'pedidos'].map(areaForTab), ['money', 'money', 'payroll', 'payroll', null])
})

for (const [name, fn] of queue) { await fn(); n++; console.log(`ok ${n} - ${name}`) }
console.log(`\n${n} passed`)
