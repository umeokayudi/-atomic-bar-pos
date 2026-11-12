/** Supply orders: numbers, consolidation, price reasons, receiving check, bar queue, billing data, purchase gap. */
import assert from 'node:assert/strict'
import {
  assignNumbers, orderCode, tokyoYear, consolidateLines, mergedCount, priceLineError, sameDayOrders, receivingRows,
  barQueue, arrivedOn, billingMissing, purchaseGap, withGapReason, gapReasonOf, trackStatus, cleanTrackPatch, shortLines,
} from '../src/lib/orderTrack.js'
import { receivedTimeline } from '../src/lib/drinkSupply.js'

let n = 0
const test = (name, fn) => { fn(); n++; console.log('ok', name) }

test('numbers: oldest first, per Tokyo year, continue the highest, never reuse', () => {
  const orders = [
    { id: 'b', criado_em: '2026-11-10T03:00:00Z' },
    { id: 'a', criado_em: '2026-11-09T03:00:00Z' },
    { id: 'c', criado_em: '2026-12-31T16:00:00Z' }, // 2027-01-01 01:00 Tokyo
    { id: 'old', criado_em: '2026-01-01T00:00:00Z' },
  ]
  const out = assignNumbers(orders, [{ id: 'old', numero: 141, ano: '2026' }])
  assert.deepEqual(out, [
    { id: 'a', numero: 142, ano: '2026' },
    { id: 'b', numero: 143, ano: '2026' },
    { id: 'c', numero: 1, ano: '2027' },
  ])
  assert.equal(orderCode({ numero: 142, ano: '2026' }), 'ORD-2026-0142')
  assert.equal(orderCode({}), '')
  assert.equal(tokyoYear('2026-12-31T15:30:00Z'), '2027')
  assert.equal(assignNumbers(orders, [...out, { id: 'old', numero: 141, ano: '2026' }]).length, 0)
})

test('consolidation joins same product+unit+price, keeps notes', () => {
  const lines = [
    { produto_id: 'p1', qtd: 2, unidade: 'bottle', preco: 1000, nota: 'cold' },
    { produto_id: 'p1', qtd: '3', unidade: 'bottle', preco: 1000, nota: 'box' },
    { produto_id: 'p1', qtd: 1, unidade: 'case', preco: 1000 },
    { produto_id: 'p2', qtd: 0, unidade: 'bottle', preco: 500 },
  ]
  const c = consolidateLines(lines)
  assert.equal(c.length, 2)
  assert.equal(c[0].qtd, 5)
  assert.equal(c[0].nota, 'cold · box')
  assert.equal(mergedCount(lines), 1)
})

test('price different from catalog needs a reason', () => {
  assert.equal(priceLineError({ preco: 1000 }, 1000), null)
  assert.equal(priceLineError({ preco: 900 }, 1000), 'priceReason')
  assert.equal(priceLineError({ preco: 900, preco_motivo: 'promo' }, 1000), null)
  assert.equal(priceLineError({ preco: 0 }, 0), 'noPrice')
})

test('same-day orders for a bar (not cancelled)', () => {
  const ps = [
    { id: 1, bar_id: 'x', status: 'pendente', data_pedido: '2026-11-12' },
    { id: 2, bar_id: 'x', status: 'cancelado', data_pedido: '2026-11-12' },
    { id: 3, bar_id: 'y', status: 'pendente', data_pedido: '2026-11-12' },
    { id: 4, bar_id: 'x', status: 'confirmado', data_pedido: '2026-11-11', data_entrega_prevista: '2026-11-12' },
  ]
  assert.deepEqual(sameDayOrders(ps, 'x', '2026-11-12').map(p => p.id), [1, 4])
})

test('receiving rows: expected × received × diff', () => {
  const items = [{ id: 'i1', produto_id: 'p1', qtd: 6, produtos: { nome: 'Gin' } }, { id: 'i2', produto_id: 'p2', qtd: 2, nome: 'Rum' }]
  const half = receivingRows(items, { i1: '5' })
  assert.equal(half.done, false)
  assert.equal(half.rows[0].diff, -1)
  const all = receivingRows(items, { i1: 6, i2: 3 })
  assert.equal(all.done, true)
  assert.equal(all.ok, false)
  assert.equal(all.over.length, 1)
  assert.equal(receivingRows(items, { i1: 6, i2: 2 }).ok, true)
})

test('bar queue: to receive / received / short', () => {
  const pedidos = [
    { id: 'o1', status: 'confirmado', pedidos_itens: [{ produto_id: 'p1' }] },
    { id: 'o2', status: 'confirmado', pedidos_itens: [{ produto_id: 'p2' }] },
    { id: 'o3', status: 'entregue', pedidos_itens: [] },
    { id: 'o4', status: 'cancelado', pedidos_itens: [] },
  ]
  const tracks = { o2: { recebimento: { em: '2026-11-12T09:00:00Z', linhas: [{ id: 'x', nome: 'Rum', esperado: 4, recebido: 3 }] } } }
  const stock = [{ id: 'p1', nome: 'Gin', hasCount: true, stock: 0 }, { id: 'p9', nome: 'Vodka', hasCount: true, stock: -1 }, { id: 'p8', hasCount: false, stock: 0 }]
  const q = barQueue(pedidos, tracks, stock)
  assert.deepEqual(q.toReceive.map(p => p.id), ['o1'])
  assert.deepEqual(q.received.map(p => p.id), ['o2', 'o3'])
  assert.equal(q.short.length, 3)
  assert.equal(q.short[0].falta, 1)
  assert.equal(q.short.find(s => s.produto_id === 'p1').onOrder, true)
  assert.equal(q.short.find(s => s.produto_id === 'p9').onOrder, false)
  assert.deepEqual(arrivedOn(pedidos, tracks, '2026-11-12').map(p => p.id), ['o2'])
  assert.equal(shortLines(tracks.o2).length, 1)
})

test('status: on the way is a step of confirmed', () => {
  assert.equal(trackStatus({ status: 'confirmado' }, { saiu_em: 'x' }), 'a_caminho')
  assert.equal(trackStatus({ status: 'confirmado' }, {}), 'confirmado')
  assert.equal(trackStatus({ status: 'entregue' }, { saiu_em: 'x' }), 'entregue')
})

test('billing data before the first invoice', () => {
  assert.deepEqual(billingMissing(null), ['email', 'prazo', 'limite'])
  assert.deepEqual(billingMissing({ email_cobranca: 'a@b.jp', prazo_dias: 0, limite_credito: 300000 }), [])
  assert.deepEqual(billingMissing({ email_cobranca: 'bad', prazo_dias: 30, limite_credito: 0 }), ['email', 'limite'])
})

test('purchase gap: points explain themselves, anything else needs a reason', () => {
  assert.equal(purchaseGap({ subtotal: 10000, total_pago: 10000, desconto_pontos: 500 }).needsReason, false)
  const g = purchaseGap({ subtotal: 10000, total_pago: 10800 })
  assert.equal(g.needsReason, true)
  assert.equal(g.unexplained, 800)
  assert.equal(purchaseGap({ subtotal: 10000, total_pago: 0 }).needsReason, false)
  const obs = withGapReason('Costco run', 'tax 8%')
  assert.equal(obs, 'Costco run [Difference: tax 8%]')
  assert.equal(gapReasonOf(obs), 'tax 8%')
  assert.equal(withGapReason(obs, 'tax 10%'), 'Costco run [Difference: tax 10%]')
})

test('track patch keeps only allowed fields', () => {
  const p = cleanTrackPatch({ prioridade: 'x', nota: 'hi', numero: 9, historico: [], linhas: { a: { unidade: 'case', preco_catalogo: '1200.4', foo: 1 } } })
  assert.deepEqual(Object.keys(p).sort(), ['linhas', 'nota', 'prioridade'])
  assert.equal(p.prioridade, 'normal')
  assert.deepEqual(p.linhas.a, { unidade: 'case', nota: null, preco_catalogo: 1200, preco_motivo: null })
})

test('received timeline shows orders the bar counted before JBM closed them', () => {
  const pedidos = [{ id: 'abcdef12-0000', status: 'confirmado', data_pedido: '2026-11-10', pedidos_itens: [] }]
  const rows = receivedTimeline({ pedidos, notes: [], counted: new Map([['abcdef12-0000', '2026-11-12']]) })
  assert.equal(rows.length, 1)
  assert.equal(rows[0].kind, 'counted')
  assert.equal(rows[0].date, '2026-11-12')
  assert.equal(receivedTimeline({ pedidos, notes: [] }).length, 0)
})

console.log(`${n} tests passed`)
